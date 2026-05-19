// Parse the ICC 2026 A/D CTF scoreboard API format into the normalized snapshot
// shape consumed by metrics.js / emitSnapshot().
//
// Caller is responsible for maintaining prevServices across calls so that
// per-tick flag and score deltas can be derived from cumulative API totals.
//
// Input:  body of GET /api/scoreboard/table/{round}
//         plus { round, observedAt, prevServices }
//
// Output: { tick, observedAt, teams, nextPrevServices }
//   teams[] shape matches parse.js parseScoreboard() output.
//
// prevServices shape:
//   Map<team_id_string, Map<service_shortname, { stolen, lost, attackerScore, victimScore }>>

const EXIT_OK = 101;
const EXIT_TIMEOUT = 104;

function deriveStatus(checks) {
  if (!checks || checks.length === 0) return null;
  if (checks.some((c) => c.exitCode === EXIT_TIMEOUT)) return 'DOWN';
  if (checks.every((c) => c.exitCode === EXIT_OK)) return 'UP';
  return 'PARTIAL';
}

function splitShortname(shortname) {
  const match = /^(.+?)[-_](\d+)$/.exec(shortname || '');
  if (!match) return { family: shortname || '', instance: '' };
  return { family: match[1], instance: match[2] };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function parseIccTable(payload, { round, observedAt = new Date(), prevServices = new Map() } = {}) {
  if (!payload || !Array.isArray(payload.scoreboard)) {
    throw new Error('parseIccTable: payload.scoreboard missing or not an array');
  }

  const tick = Number.isFinite(round) ? round : -1;
  const teams = [];
  const nextPrevServices = new Map();

  for (const entry of payload.scoreboard) {
    if (!entry || typeof entry !== 'object') continue;

    const team_id = String(entry.teamId ?? entry.shortname);
    const name = String(entry.name ?? entry.shortname);

    const prevTeamSvcs = prevServices.get(team_id) || new Map();
    const nextTeamSvcs = new Map();

    const services = [];
    let offense_total = 0;
    let defense_total = 0;

    for (const svc of entry.services || []) {
      if (!svc || typeof svc !== 'object') continue;

      const { family, instance } = splitShortname(svc.shortname);
      const attackerScore = num(svc.attackerScore);
      const victimScore = num(svc.victimScore);
      const stolen = num(svc.stolen);
      const lost = num(svc.lost);
      const svcScore = num(svc.score);

      const prev = prevTeamSvcs.get(svc.shortname);
      const flags_gained_tick = prev ? Math.max(0, stolen - prev.stolen) : 0;
      const flags_lost_tick = prev ? Math.max(0, lost - prev.lost) : 0;
      const offense_tick = prev ? Math.max(0, attackerScore - prev.attackerScore) : 0;
      const defense_tick = prev ? Math.min(0, victimScore - prev.victimScore) : 0;

      offense_total += attackerScore;
      defense_total += victimScore;

      nextTeamSvcs.set(svc.shortname, { stolen, lost, attackerScore, victimScore });

      services.push({
        service_name: svc.shortname,
        service_family: family,
        service_instance: instance,
        offense_total: attackerScore,
        offense_tick,
        defense_total: victimScore,
        defense_tick,
        service_total: svcScore,
        service_tick: 0,
        flags_gained: stolen,
        flags_lost: lost,
        flags_gained_tick,
        flags_lost_tick,
        current_status: deriveStatus(svc.checks),
        up_ticks: num(svc.successfulChecks),
      });
    }

    nextPrevServices.set(team_id, nextTeamSvcs);

    teams.push({
      team_id,
      name,
      score: num(entry.score),
      offense_total,
      offense_tick: 0,
      defense_total,
      defense_tick: 0,
      service_total: num(entry.score) - offense_total - defense_total,
      service_tick: 0,
      services,
    });
  }

  return { tick, observedAt, teams, nextPrevServices };
}
