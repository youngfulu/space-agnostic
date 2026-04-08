#!/usr/bin/env node
/**
 * Generate image list from the Artsy folder (web-displayable files only).
 * Updates public/script.js with the new array. Paths are relative to Artsy (e.g. Project/file.png).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const WEB_IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg'];
const ARTSY_DIR = path.join(projectRoot, 'Artsy');

const THUMB_DIR_NAME = 'thumb';

function getWebImagePaths(dir, baseDir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory() && (e.name === THUMB_DIR_NAME || e.name.startsWith('0_'))) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      results.push(...getWebImagePaths(full, baseDir));
    } else {
      const ext = path.extname(e.name).toLowerCase();
      if (WEB_IMAGE_EXT.includes(ext)) {
        const relative = path.relative(baseDir, full);
        const normalized = relative.split(path.sep).join('/');
        results.push(normalized);
      }
    }
  }
  return results;
}

function main() {
  if (!fs.existsSync(ARTSY_DIR)) {
    console.error('Artsy folder not found at', ARTSY_DIR);
    process.exit(1);
  }

  const baseDir = ARTSY_DIR;
  const files = getWebImagePaths(ARTSY_DIR, baseDir);
  console.log(`Scanned Artsy: ${files.length} web images`);

  const sorted = Array.from(new Set(files)).sort();
  console.log(`Total unique web-displayable images: ${sorted.length}`);

  const scriptPath = path.join(projectRoot, 'public', 'script.js');
  let scriptContent = fs.readFileSync(scriptPath, 'utf8');

  const arrayStart = 'const imagePaths = [';
  const startIdx = scriptContent.indexOf(arrayStart);
  if (startIdx === -1) {
    console.error('Could not find "const imagePaths = [" in script.js');
    process.exit(1);
  }
  const afterStart = startIdx + arrayStart.length;
  const endIdx = scriptContent.indexOf('];', afterStart);
  if (endIdx === -1) {
    console.error('Could not find "];" closing imagePaths in script.js');
    process.exit(1);
  }

  const lines = sorted.map((p) => `    '${p.replace(/'/g, "\\'")}'`);
  const newBlock = arrayStart + '\n' + lines.join(',\n') + '\n];';
  const newScript =
    scriptContent.slice(0, startIdx) + newBlock + scriptContent.slice(endIdx + 2);
  fs.writeFileSync(scriptPath, newScript);
  console.log('Updated public/script.js with new imagePaths.');
}

main();
