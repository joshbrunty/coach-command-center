import { LIVE_SNAPSHOT_ID } from './icc-api-client.js';

const ICC_CATEGORY_MAP = {
  'binary exploitation': 'pwn',
  'cryptography': 'crypto',
  'forensics': 'forensics',
  'miscellaneous': 'misc',
  'reverse engineering': 're',
  'sponsor': 'misc',
  'web exploitation': 'web',
};

export const ICC_RECOMMENDATIONS = {
  start_now: { label: 'START NOW', color: '#10b981' },
  triage: { label: 'TRIAGE ONLY', color: '#06b6d4' },
  park_ai: { label: 'PARK UNTIL AI', color: '#a855f7' },
  drop: { label: 'DROP UNLESS NEAR-SOLVED', color: '#ef4444' },
};

function mapIccCategory(name) {
  const key = String(name || '').toLowerCase().trim();
  return ICC_CATEGORY_MAP[key] || 'misc';
}

function scoreboardGaps(standings, teamId) {
  if (!Array.isArray(standings) || teamId == null) {
    return { ourRank: null, ourScore: null, gapAbove: null, gapBelow: null };
  }
  const sorted = [...standings].sort((a, b) => (a.place ?? 99) - (b.place ?? 99));
  const idx = sorted.findIndex(t => t.team_id === teamId);
  if (idx < 0) {
    return { ourRank: null, ourScore: null, gapAbove: null, gapBelow: null };
  }
  const us = sorted[idx];
  const above = idx > 0 ? sorted[idx - 1] : null;
  const below = idx < sorted.length - 1 ? sorted[idx + 1] : null;
  const ourScore = Number(us.score ?? 0);
  return {
    ourRank: us.place ?? idx + 1,
    ourScore,
    gapAbove: above ? Math.max(0, Number(above.score ?? 0) - ourScore) : null,
    gapBelow: below ? Math.max(0, ourScore - Number(below.score ?? 0)) : null,
    teams: standings,
  };
}

export function buildSnapshotFromIccBundle(bundle) {
  const teamId = bundle.me?.team_id;
  const standings = bundle.scoreboard || [];
  const scoreboard = scoreboardGaps(standings, teamId);
  const importedAt = bundle.fetchedAt || Date.now();

  const challenges = (bundle.challengesSolves || []).map(ch => {
    const solves = ch.solves || [];
    const usaSolve = teamId != null ? solves.find(s => s.team_id === teamId) : null;
    const maxPoints = Number(ch.human_resistance_points ?? ch.points ?? 0) || Number(ch.points ?? 0);
    const currentPoints = Number(ch.points ?? 0);
    return {
      platformId: String(ch.challenge_id),
      platformSource: 'icc',
      title: ch.title,
      category: mapIccCategory(ch.category),
      currentPoints,
      maxPoints,
      solveCount: solves.length,
      ourSolved: Boolean(usaSolve),
      rankImpact: null,
      iccCategory: ch.category,
      attemptsRemaining: ch.attempts_remaining,
    };
  });

  return {
    id: LIVE_SNAPSHOT_ID,
    source: 'icc',
    importedAt,
    challengeCount: challenges.length,
    adapter: {
      source: 'icc',
      mode: 'live-proxy',
      normalizedAt: importedAt,
      apiRoute: '/api/icc/bundle',
    },
    competition: bundle.competition || null,
    feed: bundle.feed || [],
    timeline: bundle.timeline || null,
    me: bundle.me || null,
    scoreboard,
    challenges,
  };
}

export function computeIccRecommendation(challenge, ctx = {}) {
  if (challenge.status === 'solved' || challenge.platformSolved) return null;

  const solveCount = Number(challenge.platformSolveCount ?? 0);
  const points = Number(challenge.platformPoints ?? challenge.points ?? 0);
  const maxPoints = Number(challenge.platformMaxPoints ?? points);
  const decayed = maxPoints > 0 && points < maxPoints * 0.85;
  const nearSolved = challenge.captainConfidence === 'near-solved';
  const comp = ctx.competition;
  const nowSec = Math.floor(Date.now() / 1000);
  const beforeRu = comp?.robot_uprising ? nowSec < comp.robot_uprising : (ctx.phase?.phase === 'locked');
  const hasSpecialist = (ctx.fit?.available?.length ?? 0) > 0;
  const cat = challenge.category;
  const aiFriendly = cat === 'misc' || cat === 'ai';
  const reasons = [];

  if (solveCount >= 2 || decayed) {
    if (nearSolved) {
      reasons.push(decayed ? 'Points already decaying' : 'Multiple public solves');
      reasons.push('Captain marked near-solved — finish or drop quickly');
      return { key: 'triage', reasons };
    }
    if (decayed) reasons.push(`Value dropped (${points} vs ${maxPoints} max)`);
    if (solveCount >= 2) reasons.push(`${solveCount} teams solved — heavy decay risk`);
    return { key: 'drop', reasons };
  }

  if (solveCount === 1 && !challenge.platformSolved) {
    reasons.push('One team solved — first blood likely gone');
    if (beforeRu && hasSpecialist && !aiFriendly) {
      reasons.push('Specialist available before Robot Uprising');
      return { key: 'start_now', reasons };
    }
    reasons.push('Confirm path before committing more time');
    return { key: 'triage', reasons };
  }

  if (beforeRu) {
    if (aiFriendly) {
      reasons.push('Low HR priority — likely better after Robot Uprising');
      return { key: 'park_ai', reasons };
    }
    if (hasSpecialist && points >= 400) {
      reasons.push(`Untouched ${points}pt challenge`);
      reasons.push('Specialist available in play intel');
      return { key: 'start_now', reasons };
    }
    reasons.push('Untouched — confirm assignee in coach meeting');
    return { key: 'triage', reasons };
  }

  if (aiFriendly) {
    reasons.push('Robot Uprising active — AI-assisted lane');
    return { key: 'start_now', reasons };
  }
  reasons.push('Post-RU — decide human finish vs AI assist');
  return { key: 'triage', reasons };
}

function fmtHms(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function buildIccAlerts(bundle) {
  const alerts = [];
  const nowSec = Math.floor(Date.now() / 1000);
  const comp = bundle.competition;
  const teamId = bundle.me?.team_id;
  const standings = bundle.scoreboard || [];
  const us = standings.find(t => t.team_id === teamId);

  if (us) {
    const rank = us.place != null ? `#${us.place}` : 'unranked';
    alerts.push({
      severity: 'info',
      message: `Team USA · ${rank} · ${Number(us.score ?? 0).toLocaleString()} pts`,
    });
  }

  if (comp?.robot_uprising) {
    const sec = comp.robot_uprising - nowSec;
    if (sec > 0) {
      alerts.push({
        severity: sec < 3600 ? 'warn' : 'info',
        message: `Robot Uprising in ${fmtHms(sec)} — lock HR-value 500s before AI phase`,
      });
    } else {
      alerts.push({ severity: 'info', message: 'Robot Uprising phase active' });
    }
  }

  if (comp?.scoreboard_freeze) {
    const sec = comp.scoreboard_freeze - nowSec;
    if (sec > 0 && sec < 7200) {
      alerts.push({
        severity: 'warn',
        message: `Scoreboard freeze in ${fmtHms(sec)}`,
      });
    }
  }

  const categoryActivity = new Map();
  for (const ev of (bundle.feed || []).slice(0, 30)) {
    if (ev.event_type !== 'solve' && ev.event_type !== 'first_blood') continue;
    const cat = ev.category || 'unknown';
    categoryActivity.set(cat, (categoryActivity.get(cat) || 0) + 1);
  }
  for (const [cat, count] of [...categoryActivity.entries()].sort((a, b) => b[1] - a[1])) {
    if (count >= 2) {
      alerts.push({
        severity: 'warn',
        message: `${cat} heating up — ${count} recent feed events (decay risk)`,
      });
    }
  }

  for (const ch of bundle.challengesSolves || []) {
    const solves = ch.solves?.length || 0;
    const pts = Number(ch.points ?? 0);
    const max = Number(ch.human_resistance_points ?? pts);
    if (solves >= 2 || (max > 0 && pts < max * 0.85)) {
      alerts.push({
        severity: 'warn',
        message: `${ch.title} · ${solves} solve${solves === 1 ? '' : 's'} · ${pts} pts now (${ch.category})`,
      });
    }
  }

  for (const ev of (bundle.feed || []).slice(0, 8)) {
    if (ev.team_id === teamId) continue;
    if (ev.event_type === 'first_blood' || ev.event_type === 'solve') {
      alerts.push({
        severity: ev.event_type === 'first_blood' ? 'warn' : 'info',
        message: ev.message || `${ev.team_name} activity on ${ev.challenge_title || 'challenge'}`,
      });
    }
  }

  const seen = new Set();
  return alerts.filter(a => {
    if (seen.has(a.message)) return false;
    seen.add(a.message);
    return true;
  }).slice(0, 12);
}

export function iccRecommendationScoreBoost(rec) {
  if (!rec) return 0;
  switch (rec.key) {
    case 'start_now': return 85;
    case 'triage': return 25;
    case 'park_ai': return -35;
    case 'drop': return -95;
    default: return 0;
  }
}
