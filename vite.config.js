import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

const IMG_SOURCE = path.resolve(process.cwd(), 'Artsy');
const THUMB_SOURCE = path.resolve(process.cwd(), 'thumb');
/** GitHub Pages serves /docs on the target branch — build must land there, not repo root. */
const BUILD_OUT_DIR = 'docs';

export default defineConfig(({ command }) => {
  const isProd = command === 'build';
  const base = isProd ? '/space-agnostic/' : '/';
  return {
  base,
  plugins: [
      react(),
      // Dev: serve Artsy at /img/; thumb from project root "thumb" at /img/thumb/
      {
        name: 'serve-img-folder',
        configureServer(server) {
          server.middlewares.use('/img', (req, res, next) => {
            let raw = (req.url || '').split('?')[0].replace(/^\//, '');
            if (raw.startsWith('img/')) raw = raw.slice(4); else if (raw.startsWith('img')) raw = raw.slice(3).replace(/^\//, '') || '';
            const segments = raw.split('/').map(s => {
              try { return decodeURIComponent(s.replace(/%2523/g, '%23')); } catch { return s; }
            });
            const urlPath = segments.join(path.sep).replace(/%23/g, '#');
            const thumbPrefix = /^thumb[/\\]/;
            let filePath;
            const relPath = urlPath.replace(/^thumb[/\\]?/, '');
            if (thumbPrefix.test(urlPath) && fs.existsSync(THUMB_SOURCE)) {
              filePath = path.join(THUMB_SOURCE, relPath);
              if (!path.resolve(filePath).startsWith(path.resolve(THUMB_SOURCE))) return next();
              if (!fs.existsSync(filePath) && fs.existsSync(IMG_SOURCE)) {
                const fp = path.join(IMG_SOURCE, relPath);
                if (fs.existsSync(fp)) filePath = fp;
              }
            } else {
              if (!fs.existsSync(IMG_SOURCE)) return next();
              filePath = path.join(IMG_SOURCE, urlPath);
              if (!path.resolve(filePath).startsWith(path.resolve(IMG_SOURCE))) return next();
            }
            filePath = path.normalize(path.resolve(filePath));
            if (!fs.existsSync(filePath)) {
              res.statusCode = 404;
              res.end();
              return;
            }
            const stat = fs.statSync(filePath);
            if (!stat.isFile()) {
              res.statusCode = 404;
              res.end();
              return;
            }
            fs.readFile(filePath, (err, data) => {
              if (err) return next();
              const ext = path.extname(filePath).toLowerCase();
              const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
              res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
              res.end(data);
            });
          });
        },
      },
      // Build: copy Artsy + thumb to dist/img
      {
        name: 'copy-img-to-dist',
        closeBundle() {
          try {
            const outDir = path.resolve(process.cwd(), BUILD_OUT_DIR);
            const imgDest = path.join(outDir, 'img');
            // Keep original names (including #) so URL-encoded paths match: browser requests
            // .../thumb/2gis%20%20%23spatial/... → server decodes to "2gis  #spatial" → matches folder
            const SKIP_EXT = new Set(['.tiff', '.psd', '.mov', '.mp4', '.avi', '.heic', '.heif', '.raw', '.cr2', '.nef', '.arw', '.bmp', '.pdf']);
            function copyRecursive(src, dest) {
              fs.mkdirSync(dest, { recursive: true });
              for (const e of fs.readdirSync(src, { withFileTypes: true })) {
                if (e.name === '.DS_Store') continue;
                const s = path.join(src, e.name);
                const d = path.join(dest, e.name);
                if (e.isDirectory()) copyRecursive(s, d);
                else if (!SKIP_EXT.has(path.extname(e.name).toLowerCase())) fs.copyFileSync(s, d);
              }
            }
            if (fs.existsSync(IMG_SOURCE)) copyRecursive(IMG_SOURCE, imgDest);
            if (fs.existsSync(THUMB_SOURCE)) copyRecursive(THUMB_SOURCE, path.join(imgDest, 'thumb'));
          } catch (err) {
            console.warn('copy-img-to-dist:', err.message);
          }
        },
      },
    ],
    root: '.',
    publicDir: 'public',
    build: {
      outDir: BUILD_OUT_DIR,
      emptyOutDir: true,
      assetsDir: 'assets',
    },
  };
});
