#!/usr/bin/env node
/**
 * Generate thumbnails from Artsy/ for the grid. Output: thumb/<same path as under Artsy/>.
 * Max width 480px; aspect ratio preserved.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const IMAGE_DIRS = [path.join(projectRoot, 'Artsy')];

const THUMB_DIR_NAME = 'thumb';
const MAX_WIDTH = 480;
const JPEG_QUALITY = 82;
const PNG_QUALITY = 80;

function getAllImagePaths(dir, base = dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === THUMB_DIR_NAME) continue; // skip thumb output
      results.push(...getAllImagePaths(full, base));
    } else {
      const ext = path.extname(e.name).toLowerCase();
      if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
        results.push(full);
      }
    }
  }
  return results;
}

async function main() {
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    console.error('sharp not installed. Run: npm install');
    process.exit(1);
  }

  let imageDir = null;
  for (const d of IMAGE_DIRS) {
    if (fs.existsSync(d)) {
      imageDir = d;
      break;
    }
  }
  if (!imageDir) {
    console.error('Artsy folder not found.');
    process.exit(1);
  }

  // Output to project root thumb/ (same relative path as under final images)
  const thumbBase = path.join(projectRoot, THUMB_DIR_NAME);
  const files = getAllImagePaths(imageDir);
  console.log(`Generating thumbnails (max width ${MAX_WIDTH}px) from ${path.relative(projectRoot, imageDir)}`);
  console.log(`Output: ${path.relative(projectRoot, thumbBase)}`);
  console.log(`Total images: ${files.length}\n`);

  let done = 0;
  let errors = 0;
  for (const filePath of files) {
    const rel = path.relative(imageDir, filePath);
    const thumbPath = path.join(thumbBase, rel);
    const thumbDir = path.dirname(thumbPath);
    const ext = path.extname(filePath).toLowerCase();

    try {
      fs.mkdirSync(thumbDir, { recursive: true });
      const img = sharp(filePath);
      const meta = await img.metadata();
      const w = meta.width || 0;
      const h = meta.height || 0;
      if (w <= 0 || h <= 0) {
        console.warn('  skip (no size):', rel);
        continue;
      }
      const needResize = w > MAX_WIDTH;
      let pipeline = img;
      if (needResize) {
        pipeline = pipeline.resize(MAX_WIDTH, null, { withoutEnlargement: true });
      }
      if (['.jpg', '.jpeg'].includes(ext)) {
        await pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toFile(thumbPath);
      } else if (ext === '.png') {
        await pipeline.png({ quality: PNG_QUALITY, compressionLevel: 9 }).toFile(thumbPath);
      } else if (ext === '.webp') {
        await pipeline.webp({ quality: 82 }).toFile(thumbPath);
      } else if (ext === '.gif') {
        await pipeline.gif().toFile(thumbPath);
      } else {
        fs.copyFileSync(filePath, thumbPath);
      }
      done++;
      if (done % 20 === 0) console.log(`  ${done}/${files.length} ...`);
    } catch (err) {
      errors++;
      console.warn('  ✗', rel, err.message);
    }
  }

  console.log(`\nDone: ${done} thumbnails written, ${errors} errors.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
