import Database from 'better-sqlite3';
import { parseScoreboard } from '../parse.js';
import { emitSnapshot, metrics } from '../metrics.js';

const SOURCE = 'sqlite';

export function startSqliteAdapter({
  path,
  intervalSeconds,
  replayRate,
  tickLengthSeconds,
  ourTeamName,
  logger,
}) {
  if (!path) {
    throw new Error('SCOREBOARD_SQLITE_PATH is required for SCOREBOARD_SOURCE=sqlite');
  }

  let db;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
  } catch (err) {
    throw new Error(`sqlite adapter: cannot open ${path}: ${err.message}`);
  }

  const selectAfter = db.prepare(
    'select tick, time, data from scoreboard_history where tick > ? order by tick asc',
  );
  const selectMax = db.prepare('select max(tick) as max_tick from scoreboard_history');

  let lastEmittedTick = -1;
  let stopped = false;

  function emitRow(row) {
    let payload;
    try {
      payload = JSON.parse(row.data);
    } catch (err) {
      metrics.exporter_errors_total.inc({ source: SOURCE, kind: 'json_parse' });
      logger.warn(`sqlite adapter: tick ${row.tick} json parse failed: ${err.message}`);
      return;
    }
    const observedAt = row.time ? new Date(row.time) : new Date();
    let snapshot;
    try {
      snapshot = parseScoreboard(payload, { observedAt });
    } catch (err) {
      metrics.exporter_errors_total.inc({ source: SOURCE, kind: 'parse' });
      logger.warn(`sqlite adapter: tick ${row.tick} parse failed: ${err.message}`);
      return;
    }
    emitSnapshot(snapshot, { ourTeamName, tickLengthSeconds, source: SOURCE });
    logger.info({
      msg: 'tick observed',
      source: SOURCE,
      tick: snapshot.tick,
      teams: snapshot.teams.length,
      replayRate,
    });
    lastEmittedTick = snapshot.tick;
  }

  async function loop() {
    // On startup, replay the entire DB so dashboards have history immediately.
    const initial = selectAfter.all(-1);
    if (replayRate === 'realtime' && initial.length > 1) {
      logger.info({
        msg: 'sqlite adapter: initial backfill (realtime)',
        rows: initial.length,
        tickLengthSeconds,
      });
      for (const row of initial) {
        if (stopped) return;
        emitRow(row);
        await new Promise((r) => setTimeout(r, tickLengthSeconds * 1000));
      }
    } else {
      logger.info({ msg: 'sqlite adapter: initial backfill (fast)', rows: initial.length });
      for (const row of initial) emitRow(row);
    }

    while (!stopped) {
      try {
        const max = selectMax.get();
        const maxTick = (max && max.max_tick) ?? -1;
        if (maxTick > lastEmittedTick) {
          const rows = selectAfter.all(lastEmittedTick);
          for (const row of rows) {
            if (stopped) break;
            emitRow(row);
            if (replayRate === 'realtime') {
              await new Promise((r) => setTimeout(r, tickLengthSeconds * 1000));
            }
          }
        }
      } catch (err) {
        metrics.exporter_errors_total.inc({ source: SOURCE, kind: 'sql' });
        logger.warn(`sqlite adapter: query failed: ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, intervalSeconds * 1000));
    }
  }

  loop().catch((err) => logger.error(`sqlite adapter: loop crashed: ${err.stack || err}`));

  return {
    stop() {
      stopped = true;
      try {
        db.close();
      } catch (err) {
        logger.warn(`sqlite adapter: close failed: ${err.message}`);
      }
    },
  };
}
