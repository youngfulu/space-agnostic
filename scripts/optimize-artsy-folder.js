#!/usr/bin/env node
/**
 * Resize + compress one Artsy subfolder for web.
 * - Content: long edge ≤1100px, target ~100–200KB (JPEG).
 * - Banner-like (wide / very large): long edge ≤2200–2400px, target ~200–500KB.
 * - Hard cap: 1MB. mozjpeg, chroma 4:4:4.
 * Opaque PNG/WebP → JPEG. Alpha: try PNG; if still too large vs target → flatten on #000 → JPEG.
 * GIF: thumbnail only.
 *
 * Usage: node scripts/optimize-artsy-folder.js "Spectral veawings"
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const ARTSY = path.join(projectRoot, 'Artsy');
const THUMB_DIR_NAME = 'thumb';
const HARD_MAX_BYTES = 1024 * 1024;
const THUMB_MAX = 480;
const THUMB_JPEG_Q = 82;
const THUMB_PNG_Q = 80;

function pickProfile(width, height) {
  const r = width / height;
  const isWideBanner = width >= 1600 && r >= 1.35;
  const isHuge = width >= 2800 || height >= 2800;
  if (isWideBanner || isHuge) {
    return { maxEdge: 2400, softTarget: 420 * 1024 };
  }
  if (width >= 1400 && r >= 1.2) {
    return { maxEdge: 2200, softTarget: 380 * 1024 };
  }
  return { maxEdge: 1100, softTarget: 140 * 1024 };
}

function collectImages(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.name === '.DS_Store') continue;
    if (e.name === THUMB_DIR_NAME || e.name === '2prcss') continue;
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory()) out.push(...collectImages(full));
    else if (/\.(jpe?g|png|webp|gif)$/i.test(e.name)) out.push(full);
  }
  return out;
}

async function optimizeFile(sm, filePath) {
  const sharpMod = sm;
  const ext = path.extname(filePath).toLowerCase();
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
    return { skipped: true, reason: 'format' };
  }

  const meta0 = await sharpMod(filePath, { sequentialRead: true, limitInputPixels: false }).metadata();
  const w0 = meta0.width || 0;
  const h0 = meta0.height || 0;
  if (w0 <= 0 || h0 <= 0) return { skipped: true, reason: 'no size' };

  const hasAlpha = !!meta0.hasAlpha;
  const { maxEdge, softTarget } = pickProfile(w0, h0);
  const dir = path.dirname(filePath);
  const base = path.basename(filePath, ext);
  const tmp = path.join(dir, `.opt-${process.pid}-${base}`);
  const longEdge = Math.max(w0, h0);
  const needsResize = longEdge > maxEdge;

  if (hasAlpha) {
    let prep = sharpMod(filePath, { sequentialRead: true, limitInputPixels: false }).rotate();
    if (needsResize) {
      prep = prep.resize({
        width: maxEdge,
        height: maxEdge,
        fit: 'inside',
        withoutEnlargement: true,
        kernel: sharpMod.kernel.lanczos3,
      });
    }
    const outPng = path.join(dir, `${base}.png`);
    const pngBuf = await prep.clone().png({ compressionLevel: 9, adaptiveFiltering: true, effort: 10 }).toBuffer();
    const keepPng = pngBuf.length <= HARD_MAX_BYTES && pngBuf.length <= softTarget * 2.2;

    if (keepPng) {
      const tmpPath = `${tmp}.png`;
      fs.writeFileSync(tmpPath, pngBuf);
      if (filePath !== outPng && fs.existsSync(outPng)) fs.unlinkSync(outPng);
      fs.renameSync(tmpPath, outPng);
      if (filePath !== outPng && fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return { ok: true, out: outPng, format: 'png', bytes: pngBuf.length };
    }

    const flatBuf = await prep.flatten({ background: { r: 0, g: 0, b: 0 } }).toBuffer();
    const outJpg = path.join(dir, `${base}.jpg`);
    let quality = 88;
    let lastBuf = null;
    for (let i = 0; i < 14; i++) {
      lastBuf = await sharpMod(flatBuf, { limitInputPixels: false })
        .jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' })
        .toBuffer();
      const sz = lastBuf.length;
      if (sz <= HARD_MAX_BYTES && sz <= softTarget * 1.45) break;
      if (sz <= HARD_MAX_BYTES && quality <= 74) break;
      quality -= 2;
      if (quality < 68) {
        quality = 68;
        break;
      }
    }
    if (lastBuf.length > HARD_MAX_BYTES) {
      let q = 72;
      while (lastBuf.length > HARD_MAX_BYTES && q >= 58) {
        lastBuf = await sharpMod(flatBuf, { limitInputPixels: false })
          .jpeg({ quality: q, mozjpeg: true, chromaSubsampling: '4:4:4' })
          .toBuffer();
        q -= 3;
      }
    }
    const tmpJpg = `${tmp}.jpg`;
    fs.writeFileSync(tmpJpg, lastBuf);
    if (fs.existsSync(outJpg)) fs.unlinkSync(outJpg);
    if (fs.existsSync(outPng)) fs.unlinkSync(outPng);
    fs.renameSync(tmpJpg, outJpg);
    if (filePath !== outJpg && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return { ok: true, out: outJpg, format: 'jpeg', bytes: fs.statSync(outJpg).size };
  }

  let resizedBuf;
  {
    let chain = sharpMod(filePath, { sequentialRead: true, limitInputPixels: false }).rotate();
    if (needsResize) {
      chain = chain.resize({
        width: maxEdge,
        height: maxEdge,
        fit: 'inside',
        withoutEnlargement: true,
        kernel: sharpMod.kernel.lanczos3,
      });
    }
    resizedBuf = await chain.toBuffer();
  }

  const outJpg = path.join(dir, `${base}.jpg`);
  let quality = 88;
  let lastBuf = null;
  for (let i = 0; i < 14; i++) {
    lastBuf = await sharpMod(resizedBuf, { sequentialRead: true, limitInputPixels: false })
      .jpeg({
        quality,
        mozjpeg: true,
        chromaSubsampling: '4:4:4',
      })
      .toBuffer();
    const sz = lastBuf.length;
    if (sz <= HARD_MAX_BYTES && sz <= softTarget * 1.4) break;
    if (sz <= HARD_MAX_BYTES && quality <= 74) break;
    quality -= 2;
    if (quality < 68) {
      quality = 68;
      break;
    }
  }

  if (lastBuf.length > HARD_MAX_BYTES) {
    let q = 72;
    while (lastBuf.length > HARD_MAX_BYTES && q >= 58) {
      lastBuf = await sharpMod(resizedBuf, { sequentialRead: true, limitInputPixels: false })
        .jpeg({ quality: q, mozjpeg: true, chromaSubsampling: '4:4:4' })
        .toBuffer();
      q -= 3;
    }
  }

  const tmpJpg = `${tmp}.jpg`;
  fs.writeFileSync(tmpJpg, lastBuf);
  if (fs.existsSync(outJpg)) fs.unlinkSync(outJpg);
  fs.renameSync(tmpJpg, outJpg);
  if (filePath !== outJpg && fs.existsSync(filePath)) fs.unlinkSync(filePath);

  return { ok: true, out: outJpg, format: 'jpeg', bytes: fs.statSync(outJpg).size };
}

async function writeThumb(sharpMod, artsyPath, thumbRoot) {
  const rel = path.relative(ARTSY, artsyPath);
  const ext = path.extname(artsyPath).toLowerCase();

  let destRel = rel;
  if (ext === '.webp') destRel = rel.replace(/\.webp$/i, '.jpg');
  if (ext === '.png') {
    const m = await sharpMod(artsyPath, { sequentialRead: true }).metadata();
    if (!m.hasAlpha) destRel = rel.replace(/\.png$/i, '.jpg');
  }

  const dest = path.join(thumbRoot, destRel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  if (ext === '.gif') {
    await sharpMod(artsyPath, { animated: true, limitInputPixels: false })
      .resize(THUMB_MAX, THUMB_MAX, { fit: 'inside', withoutEnlargement: true })
      .gif()
      .toFile(dest);
    return dest;
  }

  const meta = await sharpMod(artsyPath, { sequentialRead: true }).metadata();
  const commonResize = {
    width: THUMB_MAX,
    height: THUMB_MAX,
    fit: 'inside',
    withoutEnlargement: true,
    kernel: sharpMod.kernel.lanczos3,
  };

  if (ext === '.png' && meta.hasAlpha) {
    await sharpMod(artsyPath, { sequentialRead: true, limitInputPixels: false })
      .resize(commonResize)
      .png({ quality: THUMB_PNG_Q, compressionLevel: 9 })
      .toFile(dest);
    return dest;
  }

  const jpgDest = dest.endsWith('.jpg') || dest.endsWith('.jpeg') ? dest : dest.replace(/\.[^.]+$/, '.jpg');
  await sharpMod(artsyPath, { sequentialRead: true, limitInputPixels: false })
    .resize(commonResize)
    .jpeg({
      quality: THUMB_JPEG_Q,
      mozjpeg: true,
      chromaSubsampling: '4:4:4',
    })
    .toFile(jpgDest);

  if (jpgDest !== dest && fs.existsSync(dest) && fs.statSync(dest).isFile()) {
    try {
      fs.unlinkSync(dest);
    } catch (_) {}
  }
  return jpgDest;
}

async function main() {
  const rawArg = process.argv[2];
  if (!rawArg) {
    console.error('Usage: node scripts/optimize-artsy-folder.js "<folder-under-Artsy>"');
    process.exit(1);
  }
  const folderAbs = path.normalize(
    path.isAbsolute(rawArg) ? rawArg : path.join(ARTSY, rawArg.replace(/^Artsy\/?/i, '')),
  );
  if (!folderAbs.startsWith(path.resolve(ARTSY))) {
    console.error('Path must be under Artsy/');
    process.exit(1);
  }
  if (!fs.existsSync(folderAbs)) {
    console.error('Not found:', folderAbs);
    process.exit(1);
  }

  let sharpMod;
  try {
    sharpMod = (await import('sharp')).default;
  } catch {
    console.error('sharp not installed. Run: npm install');
    process.exit(1);
  }

  const thumbRoot = path.join(projectRoot, THUMB_DIR_NAME);
  const initial = collectImages(folderAbs);
  console.log(`Optimize ${initial.length} images under:\n ${folderAbs}\n`);

  for (const filePath of initial) {
    const rel = path.relative(ARTSY, filePath);
    const ext = path.extname(filePath).toLowerCase();
    try {
      if (ext === '.gif') {
        console.log('[thumb only]', rel);
        const t = await writeThumb(sharpMod, filePath, thumbRoot);
        console.log('  →', path.relative(projectRoot, t));
        continue;
      }
      console.log('[optimize]', rel);
      const r = await optimizeFile(sharpMod, filePath);
      if (r.skipped) console.log('  skip:', r.reason);
      else console.log('  →', r.format, path.basename(r.out), `${(r.bytes / 1024).toFixed(0)} KB`);
    } catch (err) {
      console.error('  ✗', rel, err.message);
    }
  }

  const after = collectImages(folderAbs);
  console.log('\nThumbnails…');
  for (const filePath of after) {
    const rel = path.relative(ARTSY, filePath);
    try {
      const t = await writeThumb(sharpMod, filePath, thumbRoot);
      console.log(' ', path.relative(projectRoot, t));
    } catch (err) {
      console.error('  ✗', rel, err.message);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
