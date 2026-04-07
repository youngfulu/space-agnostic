#!/usr/bin/env node
/**
 * Compress images in Artsy/ for the grid. Runs before build (prebuild) or via npm run compress-images.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const IMAGE_DIRS = [path.join(projectRoot, 'Artsy')];

const JPEG_QUALITY = 82;
const PNG_QUALITY = 80;

function getAllImagePaths(dir, base = dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      results.push(...getAllImagePaths(full, base));
    } else {
      const ext = path.extname(e.name).toLowerCase();
      if (['.jpg', '.jpeg', '.png'].includes(ext)) {
        results.push(full);
      }
    }
  }
  return results;
}

async function compressFile(filePath) {
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    console.warn('sharp not installed; run npm install. Skipping compression.');
    return { skipped: true, reason: 'no-sharp' };
  }

  const ext = path.extname(filePath).toLowerCase();
  const stat = fs.statSync(filePath);
  const originalSize = stat.size;

  try {
    let buffer;
    const img = sharp(filePath);
    const meta = await img.metadata();

    if (['.jpg', '.jpeg'].includes(ext)) {
      buffer = await img
        .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
        .toBuffer();
    } else if (ext === '.png') {
      buffer = await img
        .png({ quality: PNG_QUALITY, compressionLevel: 9 })
        .toBuffer();
    } else {
      return { skipped: true, reason: 'format' };
    }

    const newSize = buffer.length;
    if (newSize < originalSize) {
      fs.writeFileSync(filePath, buffer);
      return { compressed: true, originalSize, newSize };
    }
    return { skipped: true, reason: 'already-small', originalSize, newSize };
  } catch (err) {
    return { error: err.message };
  }
}

async function main() {
  console.log('Space Agnostic — image compression (Artsy)\n');

  let total = 0;
  let compressed = 0;
  let errors = 0;

  for (const imageDir of IMAGE_DIRS) {
    if (!fs.existsSync(imageDir)) continue;
    const files = getAllImagePaths(imageDir);
    const relDir = path.relative(projectRoot, imageDir);
    console.log(`Directory: ${relDir} (${files.length} images)`);

    for (const filePath of files) {
      total++;
      const rel = path.relative(projectRoot, filePath);
      const result = await compressFile(filePath);
      if (result.compressed) {
        compressed++;
        console.log(`  ✓ ${rel} (${result.originalSize} → ${result.newSize} bytes)`);
      } else if (result.error) {
        errors++;
        console.log(`  ✗ ${rel}: ${result.error}`);
      }
      // skip logging "already-small" to reduce noise
    }
  }

  console.log(`\nDone: ${compressed} compressed, ${total} total, ${errors} errors.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
