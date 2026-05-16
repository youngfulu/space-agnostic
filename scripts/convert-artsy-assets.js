#!/usr/bin/env node
/**
 * Convert non-web assets under Artsy/ to web-friendly formats alongside originals (no deletion by default).
 * - PDF → JPEG slides (export_pdf_to_jpeg.py); if slides already exist, skip. Original PDF is kept unless
 *   ARTSY_DELETE_SOURCES=1.
 * - HEIC/HEIF/TIFF/BMP → JPEG same basename (EXIF orient only via sharp / ffmpeg — no resize or crop).
 * - MP4/MOV/M4V/WEBM/AVI/MKV → companion `{basename}.gif` if missing (moderate web GIF: tune ARTSY_GIF_*).
 *   Videos kept unless ARTSY_DELETE_VIDEOS=1.
 * - Set ARTSY_OVERWRITE=1 to replace existing JPEG/GIF outputs. Default skips when output already exists.
 * - Set ARTSY_DELETE_SOURCES=1 to remove originals after successful conversion (off by default).
 * - One encode at a time; ARTSY_COOLDOWN_MS between jobs (default 500).
 * - ARTSY_ONLY=relative/path/under/Artsy to limit scope.
 * - AVIF: unchanged (already web).
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
const SWIFT_TRANSCODE = path.join(__dirname, 'transcode_video_mac.swift');

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

function shouldDeleteVideos() {
  return String(process.env.ARTSY_DELETE_VIDEOS || '').trim() === '1';
}

function shouldDeleteSources() {
  return String(process.env.ARTSY_DELETE_SOURCES || '').trim() === '1';
}

function shouldOverwrite() {
  return String(process.env.ARTSY_OVERWRITE || '').trim() === '1';
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

function envNum(name, def) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : def;
}

const COOLDOWN_RAW = process.env.ARTSY_COOLDOWN_MS;
const COOLDOWN_MS =
  COOLDOWN_RAW === undefined || COOLDOWN_RAW === ''
    ? 500
    : Math.max(0, Number(COOLDOWN_RAW) || 0);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function gentleCooldown() {
  if (COOLDOWN_MS > 0) await sleep(COOLDOWN_MS);
}

/** Single-threaded, quiet ffmpeg (easier on RAM/GPU when many clips). */
function ffmpegGlobalArgs() {
  return ['-hide_banner', '-loglevel', 'error', '-threads', '1'];
}

/** GIF from video: moderate size/quality for web (override with ARTSY_GIF_*). */
function gifPaletteFilterForVideo() {
  const w = envNum('ARTSY_GIF_MAX_WIDTH', 720);
  const fps = envNum('ARTSY_GIF_FPS', 8);
  const colors = Math.min(256, Math.max(32, envNum('ARTSY_GIF_COLORS', 200)));
  return `fps=${fps},scale=${w}:-2:flags=lanczos:force_divisible_by=2,split[s0][s1];[s0]palettegen=max_colors=${colors}:reserve_transparent=0:stats_mode=single[p];[s1][p]paletteuse=dither=bayer:bayer_scale=2`;
}

/** Single-frame sources (poster / still grab). */
function gifPaletteFilterForStill() {
  const w = envNum('ARTSY_GIF_MAX_WIDTH', 720);
  const defStill = envNum('ARTSY_GIF_STILL_COLORS', 200);
  const colors = Math.min(256, Math.max(32, defStill));
  return `scale=${w}:-2:flags=lanczos:force_divisible_by=2,split[s0][s1];[s0]palettegen=max_colors=${colors}:reserve_transparent=0:stats_mode=single[p];[s1][p]paletteuse=dither=bayer:bayer_scale=2`;
}

function ffprobeDuration(file) {
  const tryProbe = (extraBeforeFile) =>
    execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-analyzeduration',
        '10M',
        '-probesize',
        '10M',
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

/** Web-oriented GIF: one job, limited length, small palette (see ARTSY_GIF_*). */
function ffmpegVideoToGif(videoPath, outGif) {
  const maxSec = envNum('ARTSY_GIF_MAX_SEC', 15);
  const dur = ffprobeDuration(videoPath);
  const tOut = dur != null && dur > 0 ? Math.min(dur, maxSec) : maxSec;
  const args = [
    ...ffmpegGlobalArgs(),
    '-y',
    '-i',
    videoPath,
    '-t',
    String(tOut),
    '-lavfi',
    gifPaletteFilterForVideo(),
    '-loop',
    '0',
    outGif,
  ];
  execFileSync('ffmpeg', args, { stdio: 'pipe', maxBuffer: 8 * 1024 * 1024 });
}

function tmpMp4File() {
  return path.join(os.tmpdir(), `artsy-${crypto.randomBytes(8).toString('hex')}.mp4`);
}

function tryTranscodeWithAvfoundationMac(videoPath, maxSec) {
  if (process.platform !== 'darwin') return null;
  if (!fs.existsSync(SWIFT_TRANSCODE)) return null;
  const tmp = tmpMp4File();
  try {
    execFileSync('swift', [SWIFT_TRANSCODE, videoPath, tmp, String(maxSec)], { stdio: 'pipe' });
    return fs.existsSync(tmp) ? tmp : null;
  } catch (e) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch (_) {}
    return null;
  }
}

/** macOS fallback: one frame → short looping GIF when ffmpeg cannot decode video. */
function staticGifFromStillMac(videoPath, outGif) {
  const tmp = tmpJpgFile();
  try {
    execFileSync('swift', [SWIFT_FRAME, videoPath, tmp], { stdio: 'pipe' });
    execFileSync(
      'ffmpeg',
      [
        ...ffmpegGlobalArgs(),
        '-y',
        '-i',
        tmp,
        '-frames:v',
        '1',
        '-lavfi',
        gifPaletteFilterForStill(),
        '-loop',
        '0',
        outGif,
      ],
      { stdio: 'pipe', maxBuffer: 8 * 1024 * 1024 },
    );
  } finally {
    if (fs.existsSync(tmp)) {
      try {
        fs.unlinkSync(tmp);
      } catch (_) {}
    }
  }
}

/** Still-frame GIF from an existing poster JPG (small, web-safe). */
function gifFromPosterJpg(posterJpg, outGif) {
  execFileSync(
    'ffmpeg',
    [
      ...ffmpegGlobalArgs(),
      '-y',
      '-i',
      posterJpg,
      '-frames:v',
      '1',
      '-lavfi',
      gifPaletteFilterForStill(),
      '-loop',
      '0',
      outGif,
    ],
    { stdio: 'pipe', maxBuffer: 8 * 1024 * 1024 },
  );
}

/** HEIC / HEIF via ffmpeg (libvips often lacks newer HEIC codecs). */
function ffmpegHeicToJpg(heicPath, outJpg) {
  const tmp = tmpJpgFile();
  try {
    execFileSync(
      'ffmpeg',
      [...ffmpegGlobalArgs(), '-y', '-i', heicPath, '-frames:v', '1', '-q:v', '1', tmp],
      { stdio: 'pipe', maxBuffer: 8 * 1024 * 1024 },
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

  let files = walkFiles(ARTSY);
  // Safety guard: do not batch-convert Artsy unless explicitly requested.
  // Default behavior is "single target only" via ARTSY_ONLY.
  const allowAll = String(process.env.ARTSY_ALLOW_ALL || '').trim() === '1';
  const only = String(process.env.ARTSY_ONLY || '').trim().replace(/^\/+/, '');
  if (!allowAll && !only) {
    console.error(
      [
        'Refusing to convert the whole Artsy/ tree by default.',
        'Set ARTSY_ONLY=relative/path/under/Artsy to convert a single folder/file,',
        'or set ARTSY_ALLOW_ALL=1 if you REALLY intend to convert everything.',
      ].join('\n'),
    );
    process.exit(2);
  }
  if (only) {
    const prefix = only;
    files = files.filter((f) => {
      const rel = path.relative(ARTSY, f);
      return rel === prefix || rel.startsWith(prefix + path.sep);
    });
    console.log(`ARTSY_ONLY=${prefix} → ${files.length} files\n`);
  }
  const byExt = (exts) => files.filter((f) => exts.includes(path.extname(f).toLowerCase()));

  const pdfs = byExt(['.pdf']);
  const heics = byExt(['.heic', '.heif']);
  const tiffs = byExt(['.tif', '.tiff']);
  const bmps = byExt(['.bmp']);
  const videos = byExt(['.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv']);

  for (const hp of heics) {
    const out = path.join(path.dirname(hp), `${stem(hp)}.jpg`);
    if (fs.existsSync(out) && path.resolve(hp) !== path.resolve(out) && !shouldOverwrite()) {
      console.log('[heic skip, jpg exists]', path.relative(ARTSY, hp));
      await gentleCooldown();
      continue;
    }
    try {
      console.log('[heic → jpg ffmpeg]', path.relative(ARTSY, hp));
      ffmpegHeicToJpg(hp, out);
      if (shouldDeleteSources() && path.resolve(hp) !== path.resolve(out)) fs.unlinkSync(hp);
      await gentleCooldown();
    } catch (e) {
      console.log('  ffmpeg HEIC failed, try sharp…', e.message);
      try {
        if (fs.existsSync(out) && path.resolve(hp) !== path.resolve(out)) {
          if (!shouldOverwrite()) {
            await gentleCooldown();
            continue;
          }
          fs.unlinkSync(out);
        }
        await sharpMod(hp, { sequentialRead: true, limitInputPixels: false })
          .rotate()
          .jpeg({ quality: 93, mozjpeg: true, chromaSubsampling: '4:4:4' })
          .toFile(out + '.tmp');
        fs.renameSync(out + '.tmp', out);
        if (shouldDeleteSources() && path.resolve(hp) !== path.resolve(out)) fs.unlinkSync(hp);
        await gentleCooldown();
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
        console.log('[pdf skip, slides already exported]', path.relative(ARTSY, pdfPath));
        await gentleCooldown();
        continue;
      }
      console.log('[pdf → jpg slides]', path.relative(ARTSY, pdfPath));
      runPdfExport(pdfPath);
      if (shouldDeleteSources()) fs.unlinkSync(pdfPath);
      await gentleCooldown();
    } catch (e) {
      console.error('  ✗', pdfPath, e.message);
      await gentleCooldown();
    }
  }

  for (const p of [...tiffs, ...bmps]) {
    const ext = path.extname(p);
    const out = path.join(path.dirname(p), `${stem(p)}.jpg`);
    if (fs.existsSync(out) && path.resolve(out) !== path.resolve(p) && !shouldOverwrite()) {
      console.log(`[${ext} skip, jpg exists]`, path.relative(ARTSY, p));
      await gentleCooldown();
      continue;
    }
    try {
      console.log(`[${ext} → jpg]`, path.relative(ARTSY, p));
      if (fs.existsSync(out) && path.resolve(out) !== path.resolve(p) && shouldOverwrite()) fs.unlinkSync(out);
      await sharpMod(p, { sequentialRead: true, limitInputPixels: false })
        .rotate()
        .jpeg({ quality: 93, mozjpeg: true, chromaSubsampling: '4:4:4' })
        .toFile(out + '.tmp');
      fs.renameSync(out + '.tmp', out);
      if (shouldDeleteSources() && path.resolve(p) !== path.resolve(out)) fs.unlinkSync(p);
      await gentleCooldown();
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
      const outGif = path.join(dir, `${s}.gif`);
      if (gifSameStemExists(dir, s) && !shouldOverwrite()) {
        console.log('[video keep, gif exists]', path.relative(ARTSY, vp));
        await gentleCooldown();
        continue;
      }
      if (gifSameStemExists(dir, s) && shouldOverwrite() && fs.existsSync(outGif)) {
        fs.unlinkSync(outGif);
      }
      console.log('[video → gif]', path.relative(ARTSY, vp));
      try {
        ffmpegVideoToGif(vp, outGif);
      } catch (e1) {
        if (process.platform === 'darwin') {
          // Some iPhone MP4s have boxes ffmpeg can't parse; try AVFoundation transcode first.
          const maxSec = envNum('ARTSY_GIF_MAX_SEC', 15);
          const transcoded = tryTranscodeWithAvfoundationMac(vp, maxSec);
          if (transcoded) {
            try {
              console.log('  ffmpeg read failed, AVFoundation transcode → gif…');
              ffmpegVideoToGif(transcoded, outGif);
            } finally {
              try {
                fs.unlinkSync(transcoded);
              } catch (_) {}
            }
          } else if (fs.existsSync(SWIFT_FRAME)) {
            console.log('  ffmpeg gif failed, still-frame GIF fallback…', e1.message);
            staticGifFromStillMac(vp, outGif);
          } else {
            throw e1;
          }
        } else {
          throw e1;
        }
      }
      if (shouldDeleteVideos()) fs.unlinkSync(vp);
      await gentleCooldown();
    } catch (e) {
      try {
        const outGif = path.join(path.dirname(vp), `${stem(vp)}.gif`);
        if (fs.existsSync(outGif)) fs.unlinkSync(outGif);
      } catch (_) {}
      console.error('  ✗', vp, e.message);
      await gentleCooldown();
    }
  }

  // If videos were deleted previously but posters remain, at least create looping GIFs from posters.
  const posters = files.filter((f) => /_poster\.jpg$/i.test(f));
  for (const poster of posters) {
    const dir = path.dirname(poster);
    const base = stem(poster).replace(/_poster$/i, '');
    const outGif = path.join(dir, `${base}.gif`);
    if (fs.existsSync(outGif) && !shouldOverwrite()) continue;

    // Only do this when the source video is absent (otherwise above pass creates a real GIF).
    const hasVideo = ['.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv'].some((ext) =>
      fs.existsSync(path.join(dir, `${base}${ext}`)),
    );
    if (hasVideo) continue;

    try {
      console.log('[poster → gif]', path.relative(ARTSY, poster));
      gifFromPosterJpg(poster, outGif);
      await gentleCooldown();
    } catch (e) {
      try {
        if (fs.existsSync(outGif)) fs.unlinkSync(outGif);
      } catch (_) {}
      console.error('  ✗', poster, e.message);
      await gentleCooldown();
    }
  }

  console.log('\nDone. AVIF left as-is (web format). Run: npm run web-images');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
