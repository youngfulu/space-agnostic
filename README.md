# space-agnostic

Vite + React **shell** that mounts the legacy canvas/grid experience from classic `script.js` / `about.js`, with correct **`base`** handling for GitHub Pages (`/space-agnostic/` vs local `/`).

## Stack

- React 18, Vite 5 (`package.json`)
- Image tooling scripts: `compress-images`, `generate-image-list`, `generate-thumbnails`, Artsy-oriented optimizers

## Commands

```bash
npm install
npm run dev      # local dev server
npm run build    # production build (runs thumbnail generation hooks when configured)
```

## Relationship to `web folio/`

Both are portfolio-facing sites but **separate git repositories**. Keep animation/layout experiments here from drifting into unrelated domains — see **`WEB_PROJECT_SCOPE.md`**.

## Documentation

- Implementation notes live alongside scripts under `scripts/`.
- For personal admin or music-tech patch notes, use sibling folders under `~/Desktop/dev/` per `PROJECTS_INDEX.md`.
