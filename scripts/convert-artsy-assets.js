#!/usr/bin/env node
/**
 * Convert non-web raster assets under Artsy/ to web-friendly formats and remove sources.
 * - PDF → JPEG slides (see export_pdf_to_jpeg.py; if slides already exist, PDF is removed only).
 * - HEIC/HEIF/TIFF/BMP → JPEG (same basename).
 * - MP4/MOV/M4V/WEBM/AVI/MKV → if a GIF with the same basename exists, video is deleted only;
 *   otherwise `{basename}.gif` via ffmpeg (fps 8, max width 480, palette; first ARTSY_GIF_MAX_SEC
 *   seconds only, default 20). If ffmpeg fails (e.g. odd containers), macOS: one still via
 *   AVFoundation then a short looping GIF.
 * - AVIF: no conversion (already web); ensure pipelines list it.
 * Skips: thumb/, 2prcss/, .txt, dotfiles.
 *
 * Requires: ffmpeg/ffprobe in PATH, Python venv with PyMuPDF (auto-created in .venv-pdf).
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { execFileSync, spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const ARTSY = path.join(projectRoot, 'Artsy');
const VENV = path.join(projectRoot, '.venv-pdf');
const VENV_PY = path.join(VENV, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python3');
const PDF_SCRIPT = path.join(__dirname, 'export_pdf_to_jpeg.py');
const SWIFT_FRAME = path.join(__dirname, 'extract_video_frame_mac.swift');

const SKIP_DIRS = new Set(['thumb', '2prcss']);

function walkFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.DS_Store' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walkFiles(full, acc);
    } else acc.push(full);
  }
  return acc;
}

function stem(name) {
  return path.basename(name, path.extname(name));
}

function pdfSlidesAlreadyExist(dir, base) {
  const prefix = `${base} — slide `;
  try {
    return fs.readdirSync(dir).some((n) => n.startsWith(prefix) && /\.(png|jpe?g|webp)$/i.test(n));
  } catch {
    return false;
  }
}

function gifSameStemExists(dir, videoStem) {
  try {
    return fs.readdirSync(dir).some((n) => stem(n) === videoStem && /\.gif$/i.test(n));
  } catch {
    return false;
  }
}

function ensurePdfVenv() {
  if (fs.existsSync(VENV_PY)) return;
  console.log('Creating .venv-pdf + PyMuPDF…');
  execFileSync('python3', ['-m', 'venv', VENV], { stdio: 'inherit', cwd: projectRoot });
  execFileSync(VENV_PY, ['-m', 'pip', 'install', '-q', 'pymupdf'], { stdio: 'inherit' });
}

function runPdfExport(pdfPath) {
  ensurePdfVenv();
  const r = spawnSync(VENV_PY, [PDF_SCRIPT, pdfPath], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error((r.stderr || r.stdout || 'pdf export failed').trim());
  }
}

function tmpJpgFile() {
  return path.join(os.tmpdir(), `artsy-${crypto.randomBytes(8).toString('hex')}.jpg`);
}

function ffprobeDuration(file) {
  const tryProbe = (extraBeforeFile) =>
    execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-analyzeduration',
        '100M',
        '-probesize',
        '100M',
        ...extraBeforeFile,
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        file,
      ],
      { encoding: 'utf8' },
    ).trim();
  let out;
  try {
    out = tryProbe([]);
  } catch {
    return null;
  }
  const d = parseFloat(out, 10);
  return Number.isFinite(d) && d > 0 ? d : null;
}

/** Web-oriented GIF: limited length, 480px wide, palette. */
function ffmpegVideoToGif(videoPath, outGif) {
  const maxSec = Number(process.env.ARTSY_GIF_MAX_SEC || 20);
  const dur = ffprobeDuration(videoPath);
  const tOut = dur != null && dur > 0 ? Math.min(dur, maxSec) : maxSec;
  const args = ['-y', '-i', videoPath, '-t', String(tOut)];
  args.push(
    '-lavfi',
    'fps=8,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen=reserve_transparent=0:stats_mode=single[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3',
    '-loop',
    '0',
    outGif,
  );
  execFileSync('ffmpeg', args, { stdio: 'pipe' });
}

/** macOS fallback: one frame → short looping GIF when ffmpeg cannot decode video. */
function staticGifFromStillMac(videoPath, outGif) {
  const tmp = tmpJpgFile();
  try {
    execFileSync('swift', [SWIFT_FRAME, videoPath, tmp], { stdio: 'pipe' });
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-loop',
        '1',
        '-i',
        tmp,
        '-t',
        '2',
        '-lavfi',
        'scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse',
        '-loop',
        '0',
        outGif,
      ],
      { stdio: 'pipe' },
    );
  } finally {
    if (fs.existsSync(tmp)) {
      try {
        fs.unlinkSync(tmp);
      } catch (_) {}
    }
  }
}

/** HEIC / HEIF via ffmpeg (libvips often lacks newer HEIC codecs). */
function ffmpegHeicToJpg(heicPath, outJpg) {
  const tmp = tmpJpgFile();
  try {
    execFileSync(
      'ffmpeg',
      ['-y', '-i', heicPath, '-frames:v', '1', '-q:v', '2', tmp],
      { stdio: 'pipe' },
    );
    if (fs.existsSync(outJpg)) fs.unlinkSync(outJpg);
    fs.renameSync(tmp, outJpg);
  } finally {
    if (fs.existsSync(tmp)) {
      try {
        fs.unlinkSync(tmp);
      } catch (_) {}
    }
  }
}

async function main() {
  let sharpMod;
  try {
    sharpMod = (await import('sharp')).default;
  } catch {
    console.error('Install deps: npm install');
    process.exit(1);
  }

  const files = walkFiles(ARTSY);
  const byExt = (exts) => files.filter((f) => exts.includes(path.extname(f).toLowerCase()));

  const pdfs = byExt(['.pdf']);
  const heics = byExt(['.heic', '.heif']);
  const tiffs = byExt(['.tif', '.tiff']);
  const bmps = byExt(['.bmp']);
  const videos = byExt(['.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv']);

  for (const hp of heics) {
    const out = path.join(path.dirname(hp), `${stem(hp)}.jpg`);
    try {
      console.log('[heic → jpg ffmpeg]', path.relative(ARTSY, hp));
      ffmpegHeicToJpg(hp, out);
      if (path.resolve(hp) !== path.resolve(out)) fs.unlinkSync(hp);
    } catch (e) {
      console.log('  ffmpeg HEIC failed, try sharp…', e.message);
      try {
        if (fs.existsSync(out)) fs.unlinkSync(out);
        await sharpMod(hp, { sequentialRead: true, limitInputPixels: false })
          .rotate()
          .jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: '4:4:4' })
          .toFile(out + '.tmp');
        fs.renameSync(out + '.tmp', out);
        if (path.resolve(hp) !== path.resolve(out)) fs.unlinkSync(hp);
      } catch (e2) {
        try {
          if (fs.existsSync(out + '.tmp')) fs.unlinkSync(out + '.tmp');
        } catch (_) {}
        console.error('  ✗', hp, e2.message);
      }
    }
  }

  for (const pdfPath of pdfs) {
    const dir = path.dirname(pdfPath);
    const base = stem(pdfPath);
    try {
      if (pdfSlidesAlreadyExist(dir, base)) {
        fs.unlinkSync(pdfPath);
        console.log('[pdf remove, slides exist]', path.relative(ARTSY, pdfPath));
        continue;
      }
      console.log('[pdf → jpg slides]', path.relative(ARTSY, pdfPath));
      runPdfExport(pdfPath);
      fs.unlinkSync(pdfPath);
    } catch (e) {
      console.error('  ✗', pdfPath, e.message);
    }
  }

  for (const p of [...tiffs, ...bmps]) {
    const ext = path.extname(p);
    const out = path.join(path.dirname(p), `${stem(p)}.jpg`);
    try {
      console.log(`[${ext} → jpg]`, path.relative(ARTSY, p));
      if (fs.existsSync(out) && path.resolve(out) !== path.resolve(p)) fs.unlinkSync(out);
      await sharpMod(p, { sequentialRead: true, limitInputPixels: false })
        .rotate()
        .jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: '4:4:4' })
        .toFile(out + '.tmp');
      fs.renameSync(out + '.tmp', out);
      if (path.resolve(p) !== path.resolve(out)) fs.unlinkSync(p);
    } catch (e) {
      try {
        if (fs.existsSync(out + '.tmp')) fs.unlinkSync(out + '.tmp');
      } catch (_) {}
      console.error('  ✗', p, e.message);
    }
  }

  for (const vp of videos) {
    const dir = path.dirname(vp);
    const s = stem(vp);
    try {
      if (gifSameStemExists(dir, s)) {
        fs.unlinkSync(vp);
        console.log('[video remove, gif exists]', path.relative(ARTSY, vp));
        continue;
      }
      const outGif = path.join(dir, `${s}.gif`);
      console.log('[video → gif]', path.relative(ARTSY, vp));
      try {
        ffmpegVideoToGif(vp, outGif);
      } catch (e1) {
        if (process.platform === 'darwin' && fs.existsSync(SWIFT_FRAME)) {
          console.log('  ffmpeg gif failed, still-frame GIF fallback…', e1.message);
          staticGifFromStillMac(vp, outGif);
        } else {
          throw e1;
        }
      }
      fs.unlinkSync(vp);
    } catch (e) {
      try {
        const outGif = path.join(path.dirname(vp), `${stem(vp)}.gif`);
        if (fs.existsSync(outGif)) fs.unlinkSync(outGif);
      } catch (_) {}
      console.error('  ✗', vp, e.message);
    }
  }

  console.log('\nDone. AVIF left as-is (web format). Run: npm run web-images');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
