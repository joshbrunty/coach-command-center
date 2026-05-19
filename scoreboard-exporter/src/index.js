import express from 'express';
import { registry, metrics, snapshotState } from './metrics.js';
import { startHttpAdapter } from './adapters/http.js';
import { startSqliteAdapter } from './adapters/sqlite.js';

const env = process.env;

const SOURCE = (env.SCOREBOARD_SOURCE || 'sqlite').toLowerCase();
const PORT = Number(env.EXPORTER_PORT || 9101);
const OUR_TEAM_NAME = env.OUR_TEAM_NAME || 'Team USA';
const TICK_LENGTH_SECONDS = Number(env.GAME_TICK_LENGTH_SECONDS || 120);
const HTTP_URL = env.SCOREBOARD_HTTP_URL || '';
const HTTP_POLL = Number(env.SCOREBOARD_HTTP_POLL_INTERVAL_SECONDS || 120);
const HTTP_TIMEOUT_MS = Number(env.SCOREBOARD_HTTP_TIMEOUT_MS || 4000);
const SQLITE_PATH = env.SCOREBOARD_SQLITE_PATH || '/data/setup_data/scoreboard_history_setup.db';
const SQLITE_POLL = Number(env.SCOREBOARD_SQLITE_POLL_INTERVAL_SECONDS || 5);
const REPLAY_RATE = (env.REPLAY_RATE || 'fast').toLowerCase();

const logger = {
  info(payload) {
    if (typeof payload === 'string') console.log(JSON.stringify({ level: 'info', msg: payload }));
    else console.log(JSON.stringify({ level: 'info', ...payload }));
  },
  warn(msg) {
    console.warn(JSON.stringify({ level: 'warn', msg }));
  },
  error(msg) {
    console.error(JSON.stringify({ level: 'error', msg }));
  },
};

logger.info({ msg: 'starting scoreboard-exporter', source: SOURCE, ourTeam: OUR_TEAM_NAME, port: PORT });

let adapter;
if (SOURCE === 'http') {
  adapter = startHttpAdapter({
    url: HTTP_URL,
    intervalSeconds: HTTP_POLL,
    timeoutMs: HTTP_TIMEOUT_MS,
    ourTeamName: OUR_TEAM_NAME,
    tickLengthSeconds: TICK_LENGTH_SECONDS,
    logger,
  });
} else if (SOURCE === 'sqlite') {
  adapter = startSqliteAdapter({
    path: SQLITE_PATH,
    intervalSeconds: SQLITE_POLL,
    replayRate: REPLAY_RATE,
    tickLengthSeconds: TICK_LENGTH_SECONDS,
    ourTeamName: OUR_TEAM_NAME,
    logger,
  });
} else {
  logger.error(`Unknown SCOREBOARD_SOURCE: ${SOURCE} (expected 'http' or 'sqlite')`);
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');

app.get('/metrics', async (_req, res, next) => {
  try {
    res.set('Content-Type', registry.contentType);
    res.send(await registry.metrics());
  } catch (err) {
    next(err);
  }
});

app.get('/healthz', (_req, res) => {
  const st = snapshotState();
  res.json({
    ok: true,
    source: SOURCE,
    our_team: OUR_TEAM_NAME,
    last_tick: st.lastTick,
    team_count: st.teamCount,
    tick_length_seconds: TICK_LENGTH_SECONDS,
  });
});

app.get('/', (_req, res) => {
  res.type('text/plain').send(
    [
      'scoreboard-exporter',
      `source=${SOURCE}`,
      `our_team=${OUR_TEAM_NAME}`,
      'endpoints: /metrics, /healthz',
    ].join('\n'),
  );
});

const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info({ msg: 'http listening', port: PORT });
});

function shutdown(signal) {
  logger.info({ msg: 'shutting down', signal });
  try {
    adapter?.stop?.();
  } catch (err) {
    logger.warn(`adapter stop failed: ${err.message}`);
  }
  server.close(() => process.exit(0));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
