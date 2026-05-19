# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project Intent

Coach Command Center is a live CTF coaching dashboard for multiple coaches collaborating during an active event. It is meant to be useful while people are actively operating it, so favor changes that keep the app running, preserve existing data, and improve the speed of iteration.

The current stack is intentionally small:

- React + Vite frontend.
- A single large React app in `coach-command-center.jsx`.
- `src/storage-client.js`, which provides the browser-facing `window.storage` adapter.
- Express API in `server/index.js`.
- Postgres for shared durable storage.
- Docker Compose profiles for production-like serving and live development.

## Default Development Workflow

Use Docker Compose as the default development environment unless the user asks otherwise.

```bash
docker compose --profile dev up -d
```

Primary development URLs:

- Frontend: `http://localhost:5173`
- API health: `http://localhost:3000/health`
- Tailnet frontend on this host: `http://cyberteam:5173`
- Tailnet API health on this host: `http://cyberteam:3000/health`

Useful checks:

```bash
docker compose --profile dev ps
docker compose --profile dev logs --tail=100
curl -fsS http://127.0.0.1:3000/health
curl -fsSI http://127.0.0.1:5173
curl -fsS 'http://127.0.0.1:5173/api/storage?prefix=&shared=true'
```

The dev containers bind-mount the repo:

- Frontend edits should hot reload through Vite.
- `server/index.js` runs under Node watch mode.
- Changes to `vite.config.js`, `package.json`, Docker files, or environment wiring may require restarting the relevant container.

Use targeted restarts:

```bash
docker compose --profile dev restart web-dev
docker compose --profile dev restart api-dev
```

Do not run destructive data commands such as `docker compose down -v` unless the user explicitly asks to reset application data.

## Validation

There is currently no dedicated test suite. For most code changes, run the narrowest meaningful validation:

```bash
npm run build
```

When the dev stack is relevant, also verify:

```bash
curl -fsS http://127.0.0.1:3000/health
curl -fsS 'http://127.0.0.1:5173/api/storage?prefix=&shared=true'
```

For UI changes, use the running Vite dev server and verify the affected path in the browser when possible. If browser verification is not possible, say so clearly.

## Repository Map

- `coach-command-center.jsx`: Main React application, state handling, UI components, PDF/JSON export helpers, challenge and roster workflows.
- `src/main.jsx`: React entrypoint. Imports `src/storage-client.js` before rendering the app.
- `src/storage-client.js`: Browser storage facade. All app persistence should continue to go through `window.storage` unless deliberately refactoring storage.
- `src/app.css`: Global app styling.
- `server/index.js`: Express storage API and Postgres schema migration.
- `docker-compose.yml`: `dev` and `prod` service definitions.
- `Dockerfile`: Production build stages for API and Caddy-served frontend.
- `ops/caddy/Caddyfile`: Production web server and `/api` reverse proxy.
- `.env.example`: Documented environment defaults.
- `.env`: Local configuration. Treat as uncommitted local state and do not expose secrets from it.

## Architecture Boundaries

Respect the current storage contract:

- The frontend talks to `window.storage`.
- `window.storage` talks to `/api/storage`.
- The API stores string values in Postgres under a namespace plus key.
- The React app owns JSON serialization for challenges, roster, and settings.
- Each competition should have its own database namespace via `APP_NAMESPACE`.

Important storage keys in `coach-command-center.jsx`:

- Challenge records use the `challenge:` prefix.
- Roster is stored under `team-roster`.
- Event settings are stored under `event-settings`.
- Storage is currently shared by default.

The `event-settings` shape (after the commit-3 migration):

```js
{
  eventName: string,
  competitionDay: 'jeopardy',   // always jeopardy now
  startTime: number | null,     // Unix ms
  durationHours: number,        // total event length
  useLockedPhase: boolean,      // false = single flat timer
  lockedPhaseHours: number,     // only used when useLockedPhase=true
  lockedPhaseLabel: string,     // display name for locked phase
  openPhaseLabel: string,       // display name for open phase
  subsUsed: number,
  // hrHours / ruHours kept during migration window, can be removed after next event
}
```

When changing persisted shapes, add migration logic near the existing `migrate` or `migrateRoster` helpers. Do not assume old event data can be thrown away unless the user has explicitly said the branch is disposable.

Flags and notes are currently visible to everyone with access to the app on the tailnet. Do not add roles, private notes, or permissions without asking first.

## Frontend Guidance

Keep UI changes consistent with the existing tactical dashboard style:

- Dark theme, compact information density, high-contrast status colors.
- Existing category, difficulty, status, and phase vocabulary should remain stable unless the user asks to redesign the model.
- Optimize for keyboard-heavy live entry, big-screen wall display, and mobile/tablet use together. Avoid improving one mode in a way that makes another obviously worse.
- Prefer small, local component changes inside `coach-command-center.jsx` over broad rewrites.
- Avoid splitting the large app file only as a cleanup task during unrelated feature work. Split it only when it directly lowers risk for the requested change.
- Keep existing keyboard, modal, and export flows working when modifying related UI.

The coach app is jeopardy-only. The optional locked-phase feature supports ICC 2026's Human Resistance / Robot Uprising AI-usage rules; for other jeopardy events leave the locked phase off.

Use React patterns already present in the file:

- Functional components and hooks.
- Derived data via `useMemo` where it avoids repeated list computation.
- Stable callbacks via `useCallback` where they are passed through the component tree.
- Simple object literals for domain vocabularies.

Do not add a new state management library, router, UI kit, CSS framework, or build tool without asking first.

## API and Data Guidance

The Express API is intentionally minimal. Preserve these properties unless the user asks for a deeper backend:

- Health check at `/health`.
- Storage routes under `/api/storage`.
- Parameterized SQL through `pg`.
- Startup migration in `migrate()`.
- Graceful shutdown on `SIGTERM` and `SIGINT`.

If adding API endpoints:

- Keep them under `/api`.
- Validate request bodies before writing to Postgres.
- Return JSON errors with useful status codes.
- Preserve the Vite dev proxy and Caddy production proxy behavior.

If changing database schema:

- Make migrations idempotent.
- Assume existing `postgres_data` may contain useful live event data.
- Avoid reset-based instructions unless the user explicitly chooses that path.

## Docker and Tailnet Guidance

This repo is being used for rapid live development over a tailnet. Preserve that use case.

Current priority is rapid tailnet-only development. Do not spend effort hardening the production profile unless the user explicitly changes that priority.

The Vite dev server must remain reachable from tailnet hostnames. `vite.config.js` currently uses `server.allowedHosts` for:

- `localhost`
- `127.0.0.1`
- `cyberteam`
- `cyberteam.taild9d01.ts.net`
- `100.75.227.120`

If the Tailscale hostname or IP changes, update `server.allowedHosts` and restart `web-dev`.

Keep development services bound through Docker-published ports unless the user asks to lock them down. For public or hostile networks, prefer Tailscale, SSH tunnels, or firewall allowlists over exposing dev ports broadly.

## Security and Secrets

- Never print or commit `.env` secrets.
- Prefer `.env.example` for documenting new configuration.
- Do not add secrets to `docker-compose.yml`, source files, or docs.
- Be careful with stored challenge data: flags, notes, operators, and event timing may be sensitive.
- Do not add telemetry, external analytics, or third-party network calls without asking.

## Dependency Guidance

Dependencies are currently minimal and use `latest` in `package.json`. Before adding a dependency, ask whether the added long-term maintenance cost is justified.

Good reasons to add a dependency:

- It removes meaningful security risk.
- It replaces substantial brittle code.
- It is needed for a user-requested capability.

Weak reasons:

- Cosmetic cleanup.
- Replacing a small helper.
- Introducing a large framework for a narrow interaction.

## Code Style

Follow the style already present:

- ES modules.
- Single quotes.
- Semicolons.
- JSX in `.jsx` files.
- Keep comments sparse and useful.
- Prefer readable local helpers over clever abstraction.
- Preserve existing domain language unless intentionally changing product behavior.

When touching large sections of `coach-command-center.jsx`, minimize unrelated formatting churn. The file is large, so small diffs matter.

## Git and Change Hygiene

- Check current changes before broad edits.
- Do not revert user changes unless explicitly instructed.
- Do not commit unless the user explicitly asks.
- Keep edits scoped to the requested outcome.
- Mention any validation that was not run.

## When To Ask The User

Ask before:

- Resetting or deleting Docker volumes or Postgres data.
- Changing persisted data semantics.
- Adding authentication or access control.
- Adding dependencies, frameworks, or major file restructuring.
- Changing the visual language of the dashboard.
- Exposing services beyond the tailnet or changing network posture.
- Making production deployment assumptions.

Good questions for the project owner:

- What should the next competition namespace be called?
- Which current workflow is most painful for multiple coaches editing at the same time?
- Which data is most important to preserve during rapid iteration: challenges, roster, settings, solved history, notes, or all of it?
- Are there event-specific terms, categories, or phases that should replace the defaults?

## Preferred Agent Behavior

Start by understanding the running system, then make the smallest useful change. For live-development issues, verify with Docker Compose and HTTP checks. For UI work, verify in the browser when possible. For data changes, preserve existing records and explain migration behavior.

When uncertain, choose the path that keeps the app available for the current event and ask the user before making irreversible changes.
