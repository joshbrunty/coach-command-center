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

### Observability profile

A separate `obs` profile brings up Prometheus, Grafana, and the
`scoreboard-exporter` for the ICC 2026 scoreboard. It is independent of `dev`
and `prod` and can run alongside them on the same host.

```bash
docker compose --profile obs up -d --build
```

- Grafana: `http://localhost:3001` (auto-loads the `Scoreboard` dashboard)
- Prometheus: `http://localhost:9090`
- Exporter: `http://localhost:9101/metrics`, `/healthz`

The exporter defaults to `SCOREBOARD_SOURCE=sqlite` and replays
`grafana/setup_data/scoreboard_history_setup.db`. To switch to live data:

```bash
# .env
SCOREBOARD_SOURCE=http
SCOREBOARD_HTTP_URL=https://scoreboard.example/icc-2026.json
SCOREBOARD_HTTP_POLL_INTERVAL_SECONDS=120

docker compose --profile obs up -d scoreboard-exporter
```

Do not mix the `obs` Postgres or Grafana volumes with the coach app's
`postgres_data` volume; they are separate (`prometheus_data`, `grafana_data`).

Hot reload in `obs` (same idea as `dev`):

- `scoreboard-exporter/` is bind-mounted and runs `node --watch`.
- `prometheus-config-reloader` watches `ops/prometheus/prometheus.yml` and POSTs to `/-/reload`.
- Grafana dashboard JSON under `ops/grafana/dashboards/` is re-provisioned every 5 s.

Restart `grafana` after editing datasource provisioning only.

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

## ICC 2026 Scoreboard API Reference

The live event scoreboard is at `https://icc2026.cybersecnatlab.it`. It exposes
three JSON endpoints used by the `scoreboard-exporter`. The exporter's HTTP
adapter polls these automatically when `SCOREBOARD_SOURCE=http`. This section
documents the raw API so agents can query or extend it directly.

### `GET /api/status`

Returns contest configuration and the current round numbers. Call this first to
discover which round to fetch data for.

```
https://icc2026.cybersecnatlab.it/api/status
```

Response fields of interest:

| Field | Type | Meaning |
|---|---|---|
| `currentRound` | integer | Round currently running (not yet scored) |
| `scoreboardRound` | integer | Most recent fully-scored round — use this as the tick |
| `roundTime` | integer (seconds) | Tick length (120 s for ICC 2026) |
| `freezeRound` | integer | Round at which the scoreboard freezes |
| `start` / `end` | ISO 8601 | Contest window |
| `teams[]` | array | `{ id, name, shortname, nop, guest }` for every team |
| `services[]` | array | `{ name, shortname, vulnboxId }` for every service |

`nop` teams are the organiser's NPC/dummy teams. `vulnboxId === -1` means the
service is not yet released.

### `GET /api/scoreboard/table/{round}`

Per-team, per-service snapshot for a given round. Fetch with
`scoreboardRound` from `/api/status`.

```
https://icc2026.cybersecnatlab.it/api/scoreboard/table/17
```

Top-level keys:

- `services[]` — same as in `/api/status` plus `attackers`, `victims`, and
  optional `firstBlood` for the round.
- `scoreboard[]` — one entry per team, sorted by position.

Each `scoreboard` entry:

| Field | Type | Meaning |
|---|---|---|
| `position` | integer | Leaderboard rank this round |
| `teamId` | integer | Stable numeric team ID |
| `name` | string | Full display name, e.g. `"Team Europe"` |
| `shortname` | string | Slug, e.g. `"europe"` |
| `nop` / `guest` | boolean | NPC / observer flags |
| `score` | float | Final leaderboard score (post-SLA) |
| `services[]` | array | Per-service breakdown (see below) |
| `ad.score` | float | Same as `score` — canonical A/D total |

Each `services` entry within a scoreboard team:

| Field | Type | Meaning |
|---|---|---|
| `shortname` | string | e.g. `"BoomThrow-1"` |
| `score` | float | Gross service score before SLA penalty |
| `stolen` | integer | **Cumulative** flags stolen by this team from others |
| `lost` | integer | **Cumulative** flags stolen from this team |
| `attackerScore` | float | **Cumulative** offense points earned |
| `victimScore` | float | **Cumulative** defense points lost (negative or zero) |
| `successfulChecks` | integer | Ticks where all checker actions passed |
| `totalChecks` | integer | Total ticks checked so far |
| `checks[]` | array | Latest checker result per action (see below) |

The actual service contribution to the team score is:
`score × (successfulChecks / totalChecks)` (or `score` when `totalChecks == 0`).

Each `checks` element:

| Field | Values | Meaning |
|---|---|---|
| `action` | `PUT_FLAG`, `GET_FLAG`, `CHECK_SLA` | Checker action type |
| `exitCode` | `101` = OK, `104` = timeout | Last result for this action |
| `stdout` | string | Checker output (may be empty) |

Deriving service status from `checks`:
- All three actions `exitCode === 101` → **UP**
- Any action `exitCode === 104` → **DOWN** (checker timeout)
- Mixed / other codes → **PARTIAL**
- Empty `checks` array (service not yet released) → **N/A**

### `GET /api/scoreboard/chart/{round}`

Score history array for every team from tick 0 through the given round.
Useful for time-series panels or reconstructing historical rank.

```
https://icc2026.cybersecnatlab.it/api/scoreboard/chart/17
```

Response:

```json
{
  "rounds": 17,
  "teams": [
    {
      "shortname": "europe",
      "nop": false,
      "guest": false,
      "score": [45000, 45000, ..., 46803.58]
    }
  ]
}
```

`score[i]` is the team's total leaderboard score at the end of round `i`.
`score[0]` is always the starting value (45 000 for ICC 2026 with 9 services at
5 000 each).

### How the Exporter Uses These Endpoints

The `scoreboard-exporter` HTTP adapter (`scoreboard-exporter/src/adapters/http.js`)
polls on every `SCOREBOARD_HTTP_POLL_INTERVAL_SECONDS` interval:

1. Fetches `/api/status` → reads `scoreboardRound` and `roundTime`.
2. If `scoreboardRound` has not changed since the last poll, skips step 3.
3. Fetches `/api/scoreboard/table/{scoreboardRound}`.
4. Passes the response to `src/parse-icc.js` `parseIccTable()`, which
   normalises it into the snapshot shape consumed by `src/metrics.js`.
5. Calls `emitSnapshot()` which sets all Prometheus gauges.

`SCOREBOARD_HTTP_URL` should be set to the base origin
(`https://icc2026.cybersecnatlab.it`). Pasting the full scoreboard page URL
also works — the adapter strips the path automatically.

### Field Mapping: API → Prometheus Metrics

| Prometheus metric | Source |
|---|---|
| `team_total_score` | `entry.score` |
| `team_offense_total` | sum of `svc.attackerScore` across services |
| `team_defense_total` | sum of `svc.victimScore` across services |
| `team_service_total` | `entry.score − offense − defense` |
| `team_flags_gained_total` | `svc.stolen` (cumulative) |
| `team_flags_lost_total` | `svc.lost` (cumulative) |
| `team_flags_gained_delta` | `svc.stolen − prev_stolen` (per-round diff) |
| `team_flags_lost_delta` | `svc.lost − prev_lost` (per-round diff) |
| `team_service_status` | derived from `svc.checks` exit codes (UP=3, PARTIAL=1, DOWN=−1, N/A=−2) |
| `team_service_up_ticks` | `svc.successfulChecks` |
| `our_total_score` | `entry.score` where `entry.name == OUR_TEAM_NAME` |
| `game_current_tick` | `status.scoreboardRound` |
| `game_tick_length_seconds` | `status.roundTime` |

Delta metrics (`_delta`) are zero on the first observation of a round and
accurate from the second observation onward, because they require a prior
round's snapshot for comparison.

## Preferred Agent Behavior

Start by understanding the running system, then make the smallest useful change. For live-development issues, verify with Docker Compose and HTTP checks. For UI work, verify in the browser when possible. For data changes, preserve existing records and explain migration behavior.

When uncertain, choose the path that keeps the app available for the current event and ask the user before making irreversible changes.
