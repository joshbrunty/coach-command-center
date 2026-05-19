import client from 'prom-client';
import { statusToNumeric } from './parse.js';

export const registry = new client.Registry();

client.collectDefaultMetrics({ register: registry, prefix: 'exporter_' });

const teamLabels = ['team', 'team_id'];
const teamServiceLabels = ['team', 'team_id', 'service_name', 'service_family', 'service_instance'];
const ourServiceLabels = ['service_name', 'service_directory', 'service_family', 'service_instance'];

function gauge(name, help, labelNames) {
  const g = new client.Gauge({ name, help, labelNames, registers: [registry] });
  return g;
}

export const metrics = {
  // Existing dashboard vocabulary -- preserved.
  team_total_score: gauge('team_total_score', 'Canonical leaderboard score per team', teamLabels),
  team_delta_score: gauge('team_delta_score', 'Per-tick change in team_total_score (set when tick advances)', teamLabels),
  team_flags_gained_delta: gauge('team_flags_gained_delta', 'Flags gained this tick per team per service', teamServiceLabels),
  team_flags_lost_delta: gauge('team_flags_lost_delta', 'Flags lost this tick per team per service', teamServiceLabels),
  team_service_status: gauge('team_service_status', 'Service status (UP=3, PARTIAL=1, DOWN=-1, unknown=-2)', teamServiceLabels),

  our_total_score: gauge('our_total_score', 'Canonical leaderboard score for our team', []),
  our_delta_score: gauge('our_delta_score', 'Per-tick delta for our team', []),
  our_flags_gained_delta: gauge('our_flags_gained_delta', 'Flags gained this tick by our team, per service', ourServiceLabels),
  our_flags_lost_delta: gauge('our_flags_lost_delta', 'Flags lost this tick by our team, per service', ourServiceLabels),
  our_service_status: gauge('our_service_status', 'Service status for our team', ourServiceLabels),

  game_current_tick: gauge('game_current_tick', 'Latest observed scoreboard tick', []),
  game_tick_length_seconds: gauge('game_tick_length_seconds', 'Configured tick length in seconds', []),
  game_seconds_to_next_tick: gauge('game_seconds_to_next_tick', 'Best-effort seconds until next tick boundary', []),

  // New: component breakdown -- offense / defense / service streams.
  team_offense_total: gauge('team_offense_total', 'Cumulative offense points per team', teamLabels),
  team_defense_total: gauge('team_defense_total', 'Cumulative defense points per team (typically negative)', teamLabels),
  team_service_total: gauge('team_service_total', 'Cumulative service/SLA bank per team', teamLabels),
  team_offense_delta: gauge('team_offense_delta', 'Per-tick offense delta per team', teamLabels),
  team_defense_delta: gauge('team_defense_delta', 'Per-tick defense delta per team', teamLabels),
  team_service_delta: gauge('team_service_delta', 'Per-tick service/SLA delta per team', teamLabels),

  // New: per-team per-service counters and stats.
  team_flags_gained_total: gauge('team_flags_gained_total', 'Total flags gained per team per service', teamServiceLabels),
  team_flags_lost_total: gauge('team_flags_lost_total', 'Total flags lost per team per service', teamServiceLabels),
  team_service_score: gauge('team_service_score', 'Service score for a service per team', teamServiceLabels),
  team_service_up_ticks: gauge('team_service_up_ticks', 'Number of ticks this service was UP per team', teamServiceLabels),
  team_service_offense_delta: gauge('team_service_offense_delta', 'Per-tick offense delta for a service per team', teamServiceLabels),
  team_service_defense_delta: gauge('team_service_defense_delta', 'Per-tick defense delta for a service per team', teamServiceLabels),

  // Exporter health / observability.
  exporter_last_tick: gauge('exporter_last_tick', 'Last tick observed by the exporter', ['source']),
  exporter_last_emit_unix: gauge('exporter_last_emit_unix', 'Wall-clock seconds at last emission', ['source']),
  exporter_errors_total: new client.Counter({
    name: 'exporter_errors_total',
    help: 'Errors encountered while fetching/parsing the scoreboard',
    labelNames: ['source', 'kind'],
    registers: [registry],
  }),
};

// Track previous totals per team to derive per-tick deltas from totals; also
// remember the last-seen tick so we can detect advances.
const state = {
  lastTick: -1,
  lastByTeam: new Map(), // team_id -> { score, offense_total, defense_total, service_total }
};

function makeOurLabels(svc, ourTeamName) {
  return {
    service_name: svc.service_name,
    service_directory: svc.service_family,
    service_family: svc.service_family,
    service_instance: svc.service_instance,
  };
}

function makeTeamLabels(team) {
  return { team: team.name, team_id: team.team_id };
}

function makeTeamServiceLabels(team, svc) {
  return {
    team: team.name,
    team_id: team.team_id,
    service_name: svc.service_name,
    service_family: svc.service_family,
    service_instance: svc.service_instance,
  };
}

function clearOurSeriesIfTeamMissing(ourTeamName, teams) {
  const found = teams.some((t) => t.name === ourTeamName);
  if (!found) {
    metrics.our_total_score.reset();
    metrics.our_delta_score.reset();
    metrics.our_flags_gained_delta.reset();
    metrics.our_flags_lost_delta.reset();
    metrics.our_service_status.reset();
  }
}

export function emitSnapshot(snapshot, { ourTeamName, tickLengthSeconds, source }) {
  const { tick, observedAt, teams } = snapshot;
  const tickAdvanced = tick > state.lastTick;

  metrics.game_current_tick.set(tick);
  metrics.game_tick_length_seconds.set(tickLengthSeconds);
  // The next-tick countdown is best-effort; we recompute it on every emit so it
  // refreshes between scrapes for the Time-To-Next-Tick stat panel.
  const elapsedSinceTick = Math.max(0, (Date.now() - observedAt.getTime()) / 1000);
  const remaining = Math.max(0, tickLengthSeconds - elapsedSinceTick);
  metrics.game_seconds_to_next_tick.set(Math.min(remaining, tickLengthSeconds));

  metrics.exporter_last_tick.set({ source }, tick);
  metrics.exporter_last_emit_unix.set({ source }, Math.floor(Date.now() / 1000));

  clearOurSeriesIfTeamMissing(ourTeamName, teams);

  for (const team of teams) {
    const tlabels = makeTeamLabels(team);

    metrics.team_total_score.set(tlabels, team.score);
    metrics.team_offense_total.set(tlabels, team.offense_total);
    metrics.team_defense_total.set(tlabels, team.defense_total);
    metrics.team_service_total.set(tlabels, team.service_total);

    if (tickAdvanced) {
      const prev = state.lastByTeam.get(team.team_id);
      if (prev) {
        metrics.team_delta_score.set(tlabels, team.score - prev.score);
        metrics.team_offense_delta.set(tlabels, team.offense_total - prev.offense_total);
        metrics.team_defense_delta.set(tlabels, team.defense_total - prev.defense_total);
        metrics.team_service_delta.set(tlabels, team.service_total - prev.service_total);
      } else {
        // First sighting of this team: emit a zero delta so PromQL queries don't
        // see a missing series gap.
        metrics.team_delta_score.set(tlabels, 0);
        metrics.team_offense_delta.set(tlabels, 0);
        metrics.team_defense_delta.set(tlabels, 0);
        metrics.team_service_delta.set(tlabels, 0);
      }
    }

    for (const svc of team.services) {
      const tslabels = makeTeamServiceLabels(team, svc);
      metrics.team_flags_gained_delta.set(tslabels, svc.flags_gained_tick);
      metrics.team_flags_lost_delta.set(tslabels, svc.flags_lost_tick);
      metrics.team_service_status.set(tslabels, statusToNumeric(svc.current_status));
      metrics.team_flags_gained_total.set(tslabels, svc.flags_gained);
      metrics.team_flags_lost_total.set(tslabels, svc.flags_lost);
      metrics.team_service_score.set(tslabels, svc.service_total);
      metrics.team_service_up_ticks.set(tslabels, svc.up_ticks);
      metrics.team_service_offense_delta.set(tslabels, svc.offense_tick);
      metrics.team_service_defense_delta.set(tslabels, svc.defense_tick);
    }

    if (team.name === ourTeamName) {
      metrics.our_total_score.set(team.score);
      if (tickAdvanced) {
        const prev = state.lastByTeam.get(team.team_id);
        metrics.our_delta_score.set(prev ? team.score - prev.score : 0);
      }
      for (const svc of team.services) {
        const ols = makeOurLabels(svc, ourTeamName);
        metrics.our_flags_gained_delta.set(ols, svc.flags_gained_tick);
        metrics.our_flags_lost_delta.set(ols, svc.flags_lost_tick);
        metrics.our_service_status.set(ols, statusToNumeric(svc.current_status));
      }
    }
  }

  if (tickAdvanced) {
    state.lastTick = tick;
    state.lastByTeam.clear();
    for (const t of teams) {
      state.lastByTeam.set(t.team_id, {
        score: t.score,
        offense_total: t.offense_total,
        defense_total: t.defense_total,
        service_total: t.service_total,
      });
    }
  }
}

export function snapshotState() {
  return { lastTick: state.lastTick, teamCount: state.lastByTeam.size };
}
