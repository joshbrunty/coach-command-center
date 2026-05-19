// HTTP adapter for the ICC 2026 A/D CTF scoreboard.
//
// Poll strategy:
//   1. GET {baseUrl}/api/status        -> learn scoreboardRound and roundTime
//   2. GET {baseUrl}/api/scoreboard/table/{scoreboardRound}
//                                      -> per-team per-service snapshot
//
// Only re-fetches the table when scoreboardRound advances.
// Per-tick flag/score deltas are derived by diffing consecutive rounds.

import { parseIccTable } from '../parse-icc.js';
import { emitSnapshot, metrics } from '../metrics.js';

const SOURCE = 'http';

function stripTrailingPath(url) {
  // Accept either the base origin ("https://host") or a full URL like
  // "https://host/scoreboard" — normalise to just the origin + any top-level
  // path prefix that is NOT an API path so callers can paste the scoreboard
  // page URL directly into .env without editing.
  try {
    const u = new URL(url);
    // Drop any path components that look like the scoreboard UI page.
    // Keep only origin (scheme + host + port).
    return u.origin;
  } catch {
    // Fallback: strip trailing slash.
    return url.replace(/\/$/, '');
  }
}

export function startHttpAdapter({
  url,
  intervalSeconds,
  timeoutMs,
  ourTeamName,
  tickLengthSeconds: configuredTickLength,
  logger,
}) {
  if (!url) {
    throw new Error('SCOREBOARD_HTTP_URL is required for SCOREBOARD_SOURCE=http');
  }

  const baseUrl = stripTrailingPath(url);
  const statusUrl = `${baseUrl}/api/status`;

  let lastRoundFetched = -1;
  let prevServices = new Map();
  let stopped = false;

  async function fetchJson(targetUrl) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(targetUrl, { signal: controller.signal });
      if (!res.ok) {
        metrics.exporter_errors_total.inc({ source: SOURCE, kind: `http_${res.status}` });
        logger.warn(`http adapter: non-200 from ${targetUrl}: ${res.status}`);
        return null;
      }
      return await res.json();
    } catch (err) {
      metrics.exporter_errors_total.inc({ source: SOURCE, kind: err.name || 'error' });
      logger.warn(`http adapter: fetch failed for ${targetUrl}: ${err.message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchOnce() {
    const status = await fetchJson(statusUrl);
    if (!status) return;

    const scoreboardRound = status.scoreboardRound;
    if (typeof scoreboardRound !== 'number') {
      logger.warn('http adapter: status.scoreboardRound missing');
      return;
    }

    // Use the API's roundTime when available; fall back to config.
    const tickLengthSeconds =
      typeof status.roundTime === 'number' && status.roundTime > 0
        ? status.roundTime
        : configuredTickLength;

    // Skip re-fetching the table if the round has not advanced.
    if (scoreboardRound === lastRoundFetched) return;

    const tableUrl = `${baseUrl}/api/scoreboard/table/${scoreboardRound}`;
    const table = await fetchJson(tableUrl);
    if (!table) return;

    let snapshot;
    try {
      const result = parseIccTable(table, {
        round: scoreboardRound,
        observedAt: new Date(),
        prevServices,
      });
      snapshot = result;
      prevServices = result.nextPrevServices;
    } catch (err) {
      metrics.exporter_errors_total.inc({ source: SOURCE, kind: 'parse' });
      logger.warn(`http adapter: parse failed for round ${scoreboardRound}: ${err.message}`);
      return;
    }

    emitSnapshot(snapshot, { ourTeamName, tickLengthSeconds, source: SOURCE });
    logger.info({
      msg: 'tick observed',
      source: SOURCE,
      tick: snapshot.tick,
      teams: snapshot.teams.length,
      scoreboardRound,
    });
    lastRoundFetched = scoreboardRound;
  }

  async function loop() {
    while (!stopped) {
      await fetchOnce();
      if (stopped) break;
      await new Promise((r) => setTimeout(r, intervalSeconds * 1000));
    }
  }

  loop().catch((err) => logger.error(`http adapter: loop crashed: ${err.stack || err}`));

  return {
    stop() {
      stopped = true;
    },
  };
}
