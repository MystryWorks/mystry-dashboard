# Project instructions

## Workspace and prerequisites

- The root `package.json` uses npm workspaces for `apps/*` and `packages/*`.
- Require Node.js **>= 22**. Java must be available as `java` on `PATH`.

## Setup and development

Run these in order; build shared before starting either app:

```bash
npm install
npm run build -w @mmd/shared
copy .env.example .env    # Windows, optional; use cp on Linux/macOS
```

Then use two terminals:

```bash
npm run dev:server
npm run dev:web
```

Focused workspace commands are `npm run dev -w @mmd/server`, `npm run build -w @mmd/server`, `npm run dev -w @mmd/web`, and `npm run build -w @mmd/web`.

## Packages and serving

- `@mmd/shared` (`packages/shared`) owns shared types/interfaces; source exports are in `packages/shared/src/index.ts` and build to `packages/shared/dist/`.
- `@mmd/server` (`apps/server`) owns the API, processes, files, and deployment; entrypoint: `apps/server/src/index.ts`.
- `@mmd/web` (`apps/web`) is the management UI; `src/App.tsx` contains its route/sidebar layout.
- Dev Vite listens on `127.0.0.1:5173`, proxying `/api` to `http://127.0.0.1:3000` and `/ws` to the backend WebSocket. Production uses:

  ```bash
  npm run build
  npm start
  ```

  The server then hosts `apps/web/dist` and defaults to `http://127.0.0.1:3000`.

## Environment and runtime paths

- The server loads the repository-root `.env`. `.env.example` defines `HOST=127.0.0.1`, `PORT=3000`, `JWT_SECRET`, `SETUP_TOKEN`, and `DATA_DIR=data`; replace the secrets in production, and keep `JWT_SECRET` and `SETUP_TOKEN` different.
- File downloads default to `MAX_CONCURRENT_FILE_DOWNLOADS=4`; when all download slots are occupied, the file API returns 429. `FILE_DOWNLOAD_IDLE_TIMEOUT_MS=60000` closes idle downloads and releases their resources.
- `DATA_DIR` may be relative to the repository root or an absolute path. With the default, runtime data is `data/panel.db`, `data/instances/`, `data/cache/cores/`, and `data/uploads/`; instances always use `DATA_DIR/instances/<id>`. `data/` is gitignored and generated at runtime.
- Build output includes `apps/server/dist/` and `apps/web/dist/`; the server starts from `apps/server/dist/index.js`.

## Change constraints and validation

- Add shared request/response types in `packages/shared` first（必要时同步 `schemas.ts` 中的 JSON Schema），then rebuild `@mmd/shared` before server/web changes can consume them.
- Instance file operations must use the existing path validation in `file-service` / `apps/server/src/utils/path.ts`; do not use unvalidated paths.
- Standalone typecheck: `npm run typecheck`（需先构建 `@mmd/shared`）。There is no repository lint or business test suite beyond `npm run test:security -w @mmd/server`. Manually check `GET /api/health`, login/setup, instance create/deploy/start, console WebSocket output and commands, file listing and `server.properties` read/write, then run `npm run build` and confirm `npm start` opens the integrated page. Deployment/import tasks may remain `pending` while queued; keep displaying their status until completion or failure.
- There is no migration framework: schema changes require manually handling existing `panel.db` or writing a one-off migration script.
- User-facing copy and code comments use Chinese.
- Never commit `.env`, `data/`, secrets, or machine-specific absolute paths.
