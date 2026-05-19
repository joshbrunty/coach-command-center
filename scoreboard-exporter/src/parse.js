// Normalize an ICC 2026 scoreboard payload into a flat shape the metrics
// emitter can iterate over without re-parsing nested objects.
//
// Input shape (one tick):
//   { tick: number,
//     teams: { <team_id>: { team_id, name, score, scores: {...}, services: {...} } } }
//
// Output shape:
//   { tick: number,
//     observedAt: Date,
//     teams: [{
//       team_id, name, score,
//       offense_total, offense_tick,
//       defense_total, defense_tick,
//       service_total, service_tick,
//       services: [{
//         service_name, service_family, service_instance,
//         offense_total, offense_tick,
//         defense_total, defense_tick,
//         service_total, service_tick,
//         flags_gained, flags_lost,
//         flags_gained_tick, flags_lost_tick,
//         current_status, up_ticks
//       }]
//     }] }

const STATUS_TO_NUMERIC = {
  UP: 3,
  PARTIAL: 1,
  DOWN: -1,
};

export function statusToNumeric(status) {
  if (status === null || status === undefined) return -2;
  const key = String(status).toUpperCase();
  return key in STATUS_TO_NUMERIC ? STATUS_TO_NUMERIC[key] : -2;
}

function splitServiceName(name) {
  const match = /^([A-Za-z]+)(?:[-_]?(\d+))?$/.exec(name);
  if (!match) return { family: name, instance: '' };
  return { family: match[1], instance: match[2] || '' };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function parseScoreboard(payload, { observedAt = new Date() } = {}) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('parseScoreboard: payload is not an object');
  }
  const teamsObj = payload.teams;
  if (!teamsObj || typeof teamsObj !== 'object') {
    throw new Error('parseScoreboard: payload.teams missing');
  }

  const tick = Number.isFinite(payload.tick) ? payload.tick : -1;

  const teams = [];
  for (const [team_id, t] of Object.entries(teamsObj)) {
    if (!t || typeof t !== 'object') continue;
    const scores = t.scores || {};
    const services = [];
    const svcMap = t.services || {};
    for (const [service_name, sv] of Object.entries(svcMap)) {
      if (!sv || typeof sv !== 'object') continue;
      const { family, instance } = splitServiceName(service_name);
      services.push({
        service_name,
        service_family: family,
        service_instance: instance,
        offense_total: num(sv.offense_total),
        offense_tick: num(sv.offense_tick),
        defense_total: num(sv.defense_total),
        defense_tick: num(sv.defense_tick),
        service_total: num(sv.service_total),
        service_tick: num(sv.service_tick),
        flags_gained: num(sv.flags_gained),
        flags_lost: num(sv.flags_lost),
        flags_gained_tick: num(sv.flags_gained_tick),
        flags_lost_tick: num(sv.flags_lost_tick),
        current_status: sv.current_status ?? null,
        up_ticks: num(sv.up_ticks),
      });
    }
    teams.push({
      team_id: String(t.team_id ?? team_id),
      name: String(t.name ?? team_id),
      score: num(t.score),
      offense_total: num(scores.offense_total),
      offense_tick: num(scores.offense_tick),
      defense_total: num(scores.defense_total),
      defense_tick: num(scores.defense_tick),
      service_total: num(scores.service_total),
      service_tick: num(scores.service_tick),
      services,
    });
  }

  return { tick, observedAt, teams };
}
