import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { fetchIccStatus, fetchIccBundle } from './src/icc-api-client.js';
import {
  buildSnapshotFromIccBundle,
  buildIccAlerts,
  computeIccRecommendation,
  ICC_RECOMMENDATIONS,
  iccRecommendationScoreBoost,
} from './src/icc-sync.js';
import {
  Plus, X, Search, Clock, Check, Users, Flag, Star, Trash2, Tag,
  ExternalLink, AlertCircle, Award, Activity, Terminal, RefreshCw,
  Hash, ChevronRight, Download, Crosshair, Radio, Zap, Lock,
  UserCheck, UserX, ArrowLeftRight, Coffee, Target, AlertTriangle,
  Cpu, ShieldAlert, Play, Square, TimerReset, BatteryWarning,
  FileText, FileJson
} from 'lucide-react';

// ============================================================
// CONSTANTS
// ============================================================

const CATEGORIES = {
  re:        { label: 'REVERSE',   color: '#a855f7' },
  forensics: { label: 'FORENSICS', color: '#06b6d4' },
  web:       { label: 'WEB',       color: '#f97316' },
  pwn:       { label: 'PWN',       color: '#ef4444' },
  crypto:    { label: 'CRYPTO',    color: '#3b82f6' },
  ai:        { label: 'AI/ML',     color: '#ec4899' },
  hardware:  { label: 'HARDWARE',  color: '#84cc16' },
  misc:      { label: 'MISC',      color: '#94a3b8' },
};

const DIFFICULTIES = {
  easy:   { label: 'EASY',   color: '#10b981', dots: 1 },
  medium: { label: 'MEDIUM', color: '#f59e0b', dots: 2 },
  hard:   { label: 'HARD',   color: '#ef4444', dots: 3 },
};

const STATUSES = {
  unsolved:      { label: 'UNCLAIMED', color: '#64748b' },
  'in-progress': { label: 'ENGAGED',   color: '#f59e0b' },
  stuck:         { label: 'STUCK',     color: '#dc2626' },
  solved:        { label: 'SOLVED',    color: '#10b981' },
};

const RESOURCE_NEEDS = {
  none:       { label: 'NO EXTRA RESOURCE', color: '#64748b' },
  operator:   { label: 'ADD OPERATOR',      color: '#f59e0b' },
  specialist: { label: 'CATEGORY SPECIALIST', color: '#d4a843' },
  rest:       { label: 'REST / ROTATE',     color: '#06b6d4' },
  tooling:    { label: 'TOOLING / INFRA',   color: '#a855f7' },
  drop:       { label: 'DROP CANDIDATE',    color: '#ef4444' },
};

const COACH_DECISIONS = {
  watch:          { label: 'WATCH',               color: '#94a3b8' },
  continue:       { label: 'KEEP WORKING',        color: '#10b981' },
  add_resource:   { label: 'ADD RESOURCE',        color: '#f59e0b' },
  swap_resource:  { label: 'SWAP RESOURCE',       color: '#06b6d4' },
  phase_priority: { label: 'PHASE PRIORITY',      color: '#d4a843' },
  park:           { label: 'PARK',                color: '#a855f7' },
  drop:           { label: 'DROP',                color: '#ef4444' },
};

const EXPERIENCE_LEVELS = {
  novice:   { label: 'NOVICE',   color: '#94a3b8' },
  solid:    { label: 'SOLID',    color: '#06b6d4' },
  strong:   { label: 'STRONG',   color: '#10b981' },
  expert:   { label: 'EXPERT',   color: '#d4a843' },
};

const AVAILABILITY_STATUSES = {
  available: { label: 'AVAILABLE', color: '#10b981' },
  loaded:    { label: 'LOADED',    color: '#f59e0b' },
  fatigued:  { label: 'FATIGUED',  color: '#ef4444' },
  resting:   { label: 'RESTING',   color: '#06b6d4' },
};

const CAPTAIN_CONFIDENCE = {
  unknown:     { label: 'UNKNOWN',     color: '#64748b', weight: 0 },
  low:         { label: 'LOW',         color: '#ef4444', weight: 20 },
  medium:      { label: 'MEDIUM',      color: '#f59e0b', weight: 45 },
  high:        { label: 'HIGH',        color: '#10b981', weight: 70 },
  'near-solved': { label: 'NEAR-SOLVED', color: '#d4a843', weight: 90 },
};

const PHASE_SOLVE_CONFIDENCE = {
  unknown:           { label: 'UNKNOWN',           color: '#64748b', weight: 0 },
  unlikely:          { label: 'UNLIKELY',          color: '#ef4444', weight: 15 },
  possible:          { label: 'POSSIBLE',          color: '#f59e0b', weight: 45 },
  likely:            { label: 'LIKELY',            color: '#10b981', weight: 70 },
  'yes-if-resourced': { label: 'YES IF RESOURCED', color: '#d4a843', weight: 65 },
};

const SORT_OPTIONS = [
  { value: 'updated',    label: 'Recent update' },
  { value: 'created',    label: 'Date added' },
  { value: 'points',     label: 'Points (high → low)' },
  { value: 'difficulty', label: 'Difficulty' },
  { value: 'title',      label: 'Title (A→Z)' },
  { value: 'status',     label: 'Status' },
];

const COMP_DAYS = {
  jeopardy: { label: 'JEOPARDY', color: '#d4a843', icon: '◆' },
};

const DEFAULT_HR_HOURS = 7;
const DEFAULT_RU_HOURS = 2;
const DEFAULT_DURATION_HOURS = 9;
const MAX_SUBS_PER_DAY = 2;
const STALE_THRESHOLD_MS = 30 * 60 * 1000;
const LOCK_WARN_MS = 60 * 60 * 1000;
const LOCK_URGENT_MS = 30 * 60 * 1000;
const HR_DECAY_POINTS = {
  1: 500,
  2: 339,
  3: 230,
  4: 156,
  5: 106,
  6: 72,
  7: 50,
};

// ============================================================
// HELPERS
// ============================================================

const uid = () => `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const fmtCountdown = (ms) => {
  if (ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const fmtRelative = (ts) => {
  if (!ts) return 'never';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
};

function getPhase(settings, now = Date.now()) {
  const start = settings.startTime;
  if (!start) return { phase: 'pending', elapsed: 0, totalMs: 0 };

  const useLockedPhase = settings.useLockedPhase ?? false;

  if (!useLockedPhase) {
    const totalMs = (settings.durationHours ?? DEFAULT_DURATION_HOURS) * 3600_000;
    const elapsed = now - start;
    if (elapsed < 0) return { phase: 'scheduled', startsIn: -elapsed, elapsed: 0, totalMs };
    if (elapsed >= totalMs) return { phase: 'ended', elapsed: totalMs, totalMs };
    return { phase: 'in-progress', elapsed, totalMs,
      phaseElapsed: elapsed, phaseTotal: totalMs, phaseRemaining: totalMs - elapsed };
  }

  // Locked-phase mode
  const lockedMs = (settings.lockedPhaseHours ?? DEFAULT_HR_HOURS) * 3600_000;
  const totalMs = (settings.durationHours ?? DEFAULT_DURATION_HOURS) * 3600_000;
  const openMs = totalMs - lockedMs;
  const lockedEndsAt = start + lockedMs;
  const elapsed = now - start;
  if (elapsed < 0) return { phase: 'scheduled', startsIn: -elapsed, elapsed: 0, totalMs, lockedMs, openMs, lockedEndsAt };
  if (elapsed >= totalMs) return { phase: 'ended', elapsed: totalMs, totalMs, lockedMs, openMs, lockedEndsAt };
  if (elapsed < lockedMs) {
    return { phase: 'locked', elapsed, totalMs, lockedMs, openMs, lockedEndsAt,
      phaseElapsed: elapsed, phaseTotal: lockedMs, phaseRemaining: lockedMs - elapsed };
  }
  return { phase: 'open', elapsed, totalMs, lockedMs, openMs, lockedEndsAt,
    phaseElapsed: elapsed - lockedMs, phaseTotal: openMs, phaseRemaining: totalMs - elapsed };
}

function solvedPhase(challenge, settings) {
  if (challenge.status !== 'solved' || !challenge.solvedAt || !settings.startTime) return null;
  if (!(settings.useLockedPhase ?? false)) return null;
  const lockedMs = (settings.lockedPhaseHours ?? DEFAULT_HR_HOURS) * 3600_000;
  const lockedEndsAt = settings.startTime + lockedMs;
  return challenge.solvedAt <= lockedEndsAt ? 'locked' : 'open';
}

function solvedLockState(challenge, settings, now = Date.now()) {
  const solvedIn = solvedPhase(challenge, settings);
  if (solvedIn !== 'locked') return solvedIn;
  const lockedMs = (settings.lockedPhaseHours ?? DEFAULT_HR_HOURS) * 3600_000;
  const lockedEndsAt = settings.startTime + lockedMs;
  return now < lockedEndsAt ? 'pending' : 'locked';
}

function normalizeTimestampMs(ts) {
  if (ts == null || ts === '') return null;
  const n = Number(ts);
  if (Number.isFinite(n) && n > 0) return n < 1_000_000_000_000 ? n * 1000 : n;
  const parsed = Date.parse(ts);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSolverRecord(solver) {
  if (!solver) return null;
  const username = String(solver.username || solver.name || '').trim();
  const userId = solver.userId ?? solver.user_id ?? null;
  if (!username && userId == null) return null;
  return {
    username,
    userId,
    source: solver.source || 'manual',
    solvedAt: normalizeTimestampMs(solver.solvedAt ?? solver.timestamp),
    teamId: solver.teamId ?? solver.team_id ?? null,
    teamName: solver.teamName || solver.team_name || '',
    points: solver.points ?? null,
  };
}

function normalizePublicSolveRecord(solve) {
  if (!solve) return null;
  return {
    teamId: solve.teamId ?? solve.team_id ?? null,
    teamName: solve.teamName || solve.team_name || '',
    userId: solve.userId ?? solve.user_id ?? null,
    username: solve.username || '',
    timestamp: normalizeTimestampMs(solve.timestamp),
    points: Number(solve.points ?? 0) || 0,
    isFirstBlood: Boolean(solve.isFirstBlood ?? solve.is_first_blood),
    source: solve.source || 'icc',
  };
}

function solverFromLegacySolvedBy(challenge) {
  if (!Array.isArray(challenge.solvedBy) || challenge.solvedBy.length !== 1) return null;
  return normalizeSolverRecord({
    username: challenge.solvedBy[0],
    source: 'legacy',
    solvedAt: challenge.solvedAt || null,
  });
}

function solverDisplayName(challenge) {
  const solver = normalizeSolverRecord(challenge?.solver) || solverFromLegacySolvedBy(challenge || {});
  return solver?.username || (solver?.userId != null ? `user ${solver.userId}` : '');
}

function normalizedChallengeTitle(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function isMeaningful(value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function newestBy(records, predicate = null) {
  const list = predicate ? records.filter(predicate) : records;
  if (!list.length) return null;
  return [...list].sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))[0];
}

function mergeUniqueStrings(records, field) {
  const set = new Set();
  records.forEach((r) => (r[field] || []).forEach((v) => {
    const s = String(v || '').trim();
    if (s) set.add(s);
  }));
  return [...set];
}

function mergeMeetingHistory(records) {
  const seen = new Set();
  const merged = [];
  records.forEach((r) => {
    (r.meetingHistory || []).forEach((m) => {
      const id = m?.id || `${m?.createdAt || ''}:${m?.challengeId || ''}:${m?.summary || ''}`;
      if (!seen.has(id)) {
        seen.add(id);
        merged.push(m);
      }
    });
  });
  return merged.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).slice(-20);
}

function mergePlatformSolves(records) {
  const seen = new Set();
  const merged = [];
  records.forEach((r) => {
    (r.platformSolves || []).map(normalizePublicSolveRecord).filter(Boolean).forEach((s) => {
      const key = `${s.teamId ?? ''}|${s.userId ?? ''}|${s.username ?? ''}|${s.timestamp ?? ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(s);
      }
    });
  });
  return merged.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
}

function mergeChallengeGroup(group) {
  const records = group.map(migrate);
  const latest = newestBy(records) || records[0];
  const latestIcc = newestBy(records, r => r.platformSource === 'icc');
  const latestWithPlatform = newestBy(records, r => isMeaningful(r.platformId) || isMeaningful(r.platformPoints) || isMeaningful(r.platformSolveCount));
  const platformAnchor = latestIcc || latestWithPlatform || latest;
  const latestSolver = newestBy(records, r => Boolean(normalizeSolverRecord(r.solver)));
  const iccSolver = newestBy(records, r => normalizeSolverRecord(r.solver)?.source === 'icc');
  const projectedSolved = records.some(r => r.status === 'solved');
  const platformSolved = records.some(r => r.platformSolved);
  const solves = mergePlatformSolves(records);
  const solver = normalizeSolverRecord((iccSolver || latestSolver || {}).solver) || null;
  const solvedAtCandidates = records.map(r => r.solvedAt).filter(Boolean);
  const solvedAt = solver?.solvedAt || (solvedAtCandidates.length ? Math.max(...solvedAtCandidates) : null);
  const status = platformSolved ? 'solved' : (projectedSolved ? 'solved' : latest.status || 'unsolved');
  const manualFields = ['flag', 'notes', 'url', 'captainProgress', 'captainTimeSpentMinutes', 'captainConfidence', 'phaseSolveConfidence', 'resourceAskCategory', 'resourceAskName', 'resourceNeed', 'coachDecision'];
  const merged = {
    ...latest,
    id: latest.id,
    title: platformAnchor.title || latest.title || '',
    category: platformAnchor.category || latest.category || 'misc',
    difficulty: latest.difficulty || 'medium',
    points: platformAnchor.points ?? latest.points ?? 0,
    createdAt: Math.min(...records.map(r => r.createdAt || Date.now())),
    updatedAt: Math.max(...records.map(r => r.updatedAt || r.createdAt || 0)),
    platformId: platformAnchor.platformId || '',
    platformSource: platformAnchor.platformSource || '',
    platformPoints: platformAnchor.platformPoints ?? latest.platformPoints ?? null,
    platformMaxPoints: platformAnchor.platformMaxPoints ?? latest.platformMaxPoints ?? null,
    platformSolveCount: Math.max(...records.map(r => Number(r.platformSolveCount ?? 0) || 0), solves.length) || null,
    platformSolves: solves,
    platformSolved,
    status,
    solvedAt: status === 'solved' ? solvedAt : null,
    solver,
    solvedBy: mergeUniqueStrings(records, 'solvedBy'),
    assignees: mergeUniqueStrings(records, 'assignees'),
    tags: mergeUniqueStrings(records, 'tags'),
    meetingHistory: mergeMeetingHistory(records),
    starred: records.some(r => Boolean(r.starred)),
    hintsUsed: Math.max(...records.map(r => Number(r.hintsUsed || 0))),
    lastMeetingAt: Math.max(...records.map(r => Number(r.lastMeetingAt || 0))) || null,
  };
  manualFields.forEach((field) => {
    const newest = newestBy(records, r => isMeaningful(r[field]));
    merged[field] = newest ? newest[field] : merged[field];
  });
  if (merged.solver?.username && !merged.solvedBy.includes(merged.solver.username)) {
    merged.solvedBy = [...merged.solvedBy, merged.solver.username];
  }
  return migrate(merged);
}

function canonicalizeChallenges(challenges = []) {
  const groups = [];
  const pidMap = new Map();
  const titleMap = new Map();
  const keyForPid = (c) => {
    const pid = String(c.platformId || '').trim();
    return pid ? `pid:${pid.toLowerCase()}` : '';
  };
  const keyForTitle = (c) => {
    const t = normalizedChallengeTitle(c.title);
    return t ? `title:${t}` : '';
  };
  const canMergeByTitle = (incoming, existing) => {
    const inPid = String(incoming.platformId || '').trim().toLowerCase();
    const exPid = String(existing.platformId || '').trim().toLowerCase();
    return !(inPid && exPid && inPid !== exPid);
  };
  challenges.map(migrate).forEach((ch) => {
    const pidKey = keyForPid(ch);
    const titleKey = keyForTitle(ch);
    let group = pidKey ? pidMap.get(pidKey) : null;
    if (!group && titleKey) {
      const candidate = titleMap.get(titleKey);
      if (candidate && canMergeByTitle(ch, candidate[0])) group = candidate;
    }
    if (!group) {
      group = [];
      groups.push(group);
    }
    group.push(ch);
    if (pidKey) pidMap.set(pidKey, group);
    if (titleKey) titleMap.set(titleKey, group);
  });
  const deduped = groups.map(mergeChallengeGroup);
  const canonicalIds = new Set(deduped.map(c => c.id));
  const duplicateIds = challenges.map(migrate).map(c => c.id).filter(id => !canonicalIds.has(id));
  return { challenges: deduped, duplicateIds };
}

function operatorMatchesSolver(challenge, operator) {
  const solver = normalizeSolverRecord(challenge?.solver) || solverFromLegacySolvedBy(challenge || {});
  if (!operator) return false;
  const operatorAliases = [
    operator.name,
    operator.iccUsername,
    String(operator.name || '').split('(')[0],
  ].map(v => String(v || '').trim().toLowerCase()).filter(Boolean);
  if (!solver && Array.isArray(challenge?.solvedBy) && challenge.solvedBy.length) {
    const names = challenge.solvedBy.map(v => String(v || '').trim().toLowerCase()).filter(Boolean);
    if (!names.length) return false;
    return operatorAliases.some(alias => names.includes(alias));
  }
  if (!solver) return false;
  const solverUser = String(solver.username || '').toLowerCase();
  const solverId = solver.userId != null ? String(solver.userId) : '';
  const opId = operator.iccUserId != null && operator.iccUserId !== '' ? String(operator.iccUserId) : '';
  return (solverUser && operatorAliases.includes(solverUser))
    || (solverId && ((opId && solverId === opId) || operatorAliases.includes(`user ${solverId}`)));
}

function rosterNameForSolver(solver, roster = []) {
  const normalized = normalizeSolverRecord(solver);
  if (!normalized) return '';
  const match = roster.find(p => operatorMatchesSolver({ solver: normalized }, p));
  return match?.name || '';
}

function pointDecayIntel(challenge) {
  const current = Number(challenge.platformPoints ?? challenge.points ?? 0) || 0;
  const max = Number(challenge.platformMaxPoints ?? current) || 0;
  const solves = Array.isArray(challenge.platformSolves) ? challenge.platformSolves.map(normalizePublicSolveRecord).filter(Boolean) : [];
  solves.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  const lastSolve = solves.length ? solves[solves.length - 1] : null;
  return {
    current,
    max,
    lost: Math.max(0, max - current),
    solveCount: Number(challenge.platformSolveCount ?? solves.length) || 0,
    lastSolve,
  };
}

const newChallenge = (overrides = {}) => ({
  id: uid(), title: '', category: 'misc', difficulty: 'medium', points: 0,
  status: 'unsolved', assignees: [], flag: '', notes: '', url: '', tags: [],
  createdAt: Date.now(), updatedAt: Date.now(), solvedAt: null, solvedBy: [], solver: null,
  starred: false, hintsUsed: 0,
  platformId: '', platformSource: '', platformPoints: null, platformMaxPoints: null,
  platformSolveCount: null, platformSolves: [], platformSolved: false, captainProgress: null, captainTimeSpentMinutes: null,
  captainConfidence: 'unknown', phaseSolveConfidence: 'unknown',
  rankImpact: null, resourceAskCategory: '', resourceAskName: '',
  resourceNeed: 'none', coachDecision: 'watch', lastMeetingAt: null, meetingHistory: [],
  ...overrides,
});

const migrate = (ch) => ({
  ...ch, points: ch.points || 0, tags: ch.tags || [],
  assignees: ch.assignees || [], solvedBy: ch.solvedBy || [],
  solver: normalizeSolverRecord(ch.solver) || solverFromLegacySolvedBy(ch),
  hintsUsed: ch.hintsUsed || 0,
  platformId: ch.platformId || '',
  platformSource: ch.platformSource || '',
  platformPoints: ch.platformPoints ?? null,
  platformMaxPoints: ch.platformMaxPoints ?? null,
  platformSolveCount: ch.platformSolveCount ?? null,
  platformSolves: Array.isArray(ch.platformSolves) ? ch.platformSolves.map(normalizePublicSolveRecord).filter(Boolean) : [],
  platformSolved: ch.platformSolved ?? false,
  captainProgress: ch.captainProgress ?? null,
  captainTimeSpentMinutes: ch.captainTimeSpentMinutes ?? null,
  captainConfidence: ch.captainConfidence || 'unknown',
  phaseSolveConfidence: ch.phaseSolveConfidence || 'unknown',
  rankImpact: ch.rankImpact ?? null,
  resourceAskCategory: ch.resourceAskCategory || '',
  resourceAskName: ch.resourceAskName || '',
  resourceNeed: ch.resourceNeed || 'none',
  coachDecision: ch.coachDecision || 'watch',
  lastMeetingAt: ch.lastMeetingAt ?? null,
  meetingHistory: ch.meetingHistory || [],
});

const migrateRoster = (roster) => {
  if (!Array.isArray(roster)) return [];
  return roster.map(p => typeof p === 'string'
    ? { name: p, status: 'active', subbedOutAt: null, strengths: [], experienceLevel: 'solid', availabilityStatus: 'available', fatigueNote: '', iccUsername: '', iccUserId: '' }
    : { status: 'active', subbedOutAt: null, strengths: [], experienceLevel: 'solid', availabilityStatus: 'available', fatigueNote: '', iccUsername: '', iccUserId: '', ...p });
};

function parseCSVRows(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted && ch === '"' && next === '"') { value += '"'; i += 1; continue; }
    if (ch === '"') { quoted = !quoted; continue; }
    if (!quoted && ch === ',') { row.push(value.trim()); value = ''; continue; }
    if (!quoted && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(value.trim()); value = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
      continue;
    }
    value += ch;
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

const readFirst = (obj, keys) => keys.map(k => obj?.[k]).find(v => v != null && v !== '');

function normalizePlatformChallenge(raw, source = 'manual') {
  const title = String(readFirst(raw, ['title', 'name', 'challenge', 'Challenge', 'Name', 'Title']) || '').trim();
  const id = String(readFirst(raw, ['id', 'challengeId', 'challenge_id', 'slug', 'ID']) || title).trim();
  if (!title && !id) return null;
  const categoryRaw = String(readFirst(raw, ['category', 'Category', 'cat']) || 'misc').toLowerCase().trim();
  const category = Object.keys(CATEGORIES).find(k => categoryRaw.includes(k)) || 'misc';
  const points = Number(readFirst(raw, ['points', 'value', 'score', 'Points', 'Value']) || 0) || 0;
  const solves = Number(readFirst(raw, ['solves', 'solveCount', 'solve_count', 'solved_by_count', 'Solves']) || 0) || 0;
  const rankImpact = Number(readFirst(raw, ['rankImpact', 'rank_impact', 'impact', 'Rank Impact']) || 0) || null;
  const solvedRaw = readFirst(raw, ['ourSolved', 'solved', 'teamSolved', 'Solved', 'status']);
  const solvedText = String(solvedRaw ?? '').toLowerCase();
  const ourSolved = solvedRaw === true || solvedText === 'true' || solvedText === 'yes' || solvedText === 'solved';
  const solverName = String(readFirst(raw, ['solver', 'solvedBy', 'solved_by', 'username', 'Username']) || '').trim();
  const solverId = readFirst(raw, ['solverId', 'solver_id', 'userId', 'user_id']);
  const solvedAt = readFirst(raw, ['solvedAt', 'solved_at', 'timestamp', 'Timestamp']);
  const solver = ourSolved && (solverName || solverId != null)
    ? normalizeSolverRecord({ username: solverName, userId: solverId, source, solvedAt })
    : null;
  return {
    platformId: id || title,
    platformSource: source || 'manual',
    title: title || id,
    category,
    currentPoints: points,
    solveCount: solves,
    rankImpact,
    ourSolved,
    ourSolve: solver,
    solves: [],
    raw,
  };
}

function normalizePlatformScoreboard(raw = {}) {
  const scoreboard = raw.scoreboard || raw.standings || raw.rank || raw.meta || raw;
  const ourRank = Number(readFirst(scoreboard, ['ourRank', 'rank', 'place', 'position', 'Rank']) || 0) || null;
  const ourScore = Number(readFirst(scoreboard, ['ourScore', 'score', 'points', 'Score']) || 0) || null;
  const gapAbove = Number(readFirst(scoreboard, ['gapAbove', 'pointsToNext', 'points_to_next', 'gap_up', 'Gap Above']) || 0) || null;
  const gapBelow = Number(readFirst(scoreboard, ['gapBelow', 'leadOverNext', 'gap_down', 'Gap Below']) || 0) || null;
  const teams = Array.isArray(scoreboard.teams) ? scoreboard.teams : Array.isArray(raw.teams) ? raw.teams : [];
  return { ourRank, ourScore, gapAbove, gapBelow, teams };
}

function parsePlatformImport(text, source = 'metactf') {
  const trimmed = text.trim();
  if (!trimmed) return { challenges: [], scoreboard: null, errors: ['Paste JSON or CSV platform data first.'] };
  try {
    const parsed = JSON.parse(trimmed);
    const list = Array.isArray(parsed) ? parsed : parsed.challenges || parsed.data || parsed.items || [];
    if (!Array.isArray(list)) return { challenges: [], scoreboard: null, errors: ['JSON must be an array or contain a challenges/data/items array.'] };
    return {
      challenges: list.map(item => normalizePlatformChallenge(item, source)).filter(Boolean),
      scoreboard: Array.isArray(parsed) ? null : normalizePlatformScoreboard(parsed),
      errors: [],
    };
  } catch {
    const rows = parseCSVRows(trimmed);
    if (rows.length < 2) return { challenges: [], scoreboard: null, errors: ['CSV import needs a header row and at least one data row.'] };
    const headers = rows[0].map(h => h.trim());
    const challenges = rows.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i]; });
      return normalizePlatformChallenge(obj, source);
    }).filter(Boolean);
    return { challenges, scoreboard: null, errors: [] };
  }
}

function buildPlatformSnapshot({ source, challenges, scoreboard = null }) {
  const importedAt = Date.now();
  return {
    id: `platform-snapshot:${importedAt}`,
    source: source || 'manual',
    importedAt,
    challengeCount: challenges.length,
    adapter: {
      source: source || 'manual',
      mode: source === 'metactf' ? 'swagger-ready' : 'manual-import',
      normalizedAt: importedAt,
      apiRoute: source === 'metactf' ? '/api/platform/metactf/snapshot' : null,
    },
    scoreboard,
    challenges,
  };
}

function applyPlatformSnapshotToChallenges(challenges, snapshot, roster = []) {
  const next = [...canonicalizeChallenges(challenges).challenges];
  snapshot.challenges.forEach(pc => {
    const idx = next.findIndex(c =>
      (pc.platformId && c.platformId === pc.platformId) ||
      c.title.trim().toLowerCase() === pc.title.trim().toLowerCase()
    );
    const existing = idx >= 0 ? next[idx] : null;
    const apiSolver = normalizeSolverRecord(pc.ourSolve);
    const nextSolver = pc.ourSolved ? (apiSolver || existing?.solver || null) : existing?.solver || null;
    const rosterSolverName = apiSolver ? rosterNameForSolver(apiSolver, roster) : '';
    const assignees = rosterSolverName && !(existing?.assignees || []).includes(rosterSolverName)
      ? [...(existing?.assignees || []), rosterSolverName]
      : existing?.assignees || [];
    const patch = {
      title: pc.title,
      category: pc.category,
      points: pc.currentPoints || existing?.points || 0,
      platformId: pc.platformId,
      platformSource: pc.platformSource,
      platformPoints: pc.currentPoints,
      platformMaxPoints: pc.maxPoints ?? existing?.platformMaxPoints ?? pc.currentPoints,
      platformSolveCount: pc.solveCount,
      platformSolves: Array.isArray(pc.solves) ? pc.solves.map(normalizePublicSolveRecord).filter(Boolean) : existing?.platformSolves || [],
      platformSolved: pc.ourSolved,
      rankImpact: pc.rankImpact ?? existing?.rankImpact ?? null,
      assignees,
      status: pc.ourSolved ? 'solved' : existing?.status || 'unsolved',
      solvedAt: pc.ourSolved ? (apiSolver?.solvedAt || existing?.solvedAt || Date.now()) : existing?.solvedAt || null,
      solver: nextSolver,
      solvedBy: pc.ourSolved && nextSolver?.username
        ? [...new Set([...(existing?.solvedBy || []), nextSolver.username])]
        : existing?.solvedBy || [],
    };
    if (idx >= 0) next[idx] = migrate({ ...next[idx], ...patch });
    else next.push(newChallenge(patch));
  });
  return canonicalizeChallenges(next).challenges;
}

// ============================================================
// STORAGE
// ============================================================
const SHARED = true;
const CH_PREFIX = 'challenge:';
const SNAPSHOT_PREFIX = 'platform-snapshot:';
const MEETING_PREFIX = 'meeting:';
const TEAM_KEY = 'team-roster';
const SETTINGS_KEY = 'event-settings';

const DEFAULT_SETTINGS = {
  eventName: 'COACH COMMAND CENTER', competitionDay: 'jeopardy',
  startTime: null,
  durationHours: DEFAULT_DURATION_HOURS,
  useLockedPhase: false,
  lockedPhaseHours: DEFAULT_HR_HOURS,
  lockedPhaseLabel: 'Phase 1',
  openPhaseLabel: 'Phase 2',
  subsUsed: 0,
};

function migrateSettings(raw) {
  const s = { ...DEFAULT_SETTINGS, ...raw };
  // Coerce old A&D competition day
  if (s.competitionDay === 'ad') s.competitionDay = 'jeopardy';
  // Migrate hrHours/ruHours -> locked-phase model
  if ((s.hrHours != null || s.ruHours != null) && s.durationHours === DEFAULT_DURATION_HOURS && !s.useLockedPhase) {
    const hr = s.hrHours ?? DEFAULT_HR_HOURS;
    const ru = s.ruHours ?? DEFAULT_RU_HOURS;
    s.durationHours = hr + ru;
    s.useLockedPhase = true;
    s.lockedPhaseHours = hr;
    s.lockedPhaseLabel = 'Human Resistance';
    s.openPhaseLabel = 'Robot Uprising';
  }
  // hrHours / ruHours kept for one release cycle for safety
  return s;
}

const storage = {
  async listChallenges() {
    try {
      const res = await window.storage.list(CH_PREFIX, SHARED);
      const keys = res?.keys || [];
      const items = await Promise.all(keys.map(async (k) => {
        try { const r = await window.storage.get(k, SHARED); return r ? migrate(JSON.parse(r.value)) : null; }
        catch { return null; }
      }));
      return canonicalizeChallenges(items.filter(Boolean)).challenges;
    } catch (e) { console.error('listChallenges', e); return []; }
  },
  async saveCanonicalChallenges(challenges) {
    const res = await window.storage.list(CH_PREFIX, SHARED).catch(() => ({ keys: [] }));
    const keys = res?.keys || [];
    const stored = await Promise.all(keys.map(async (k) => {
      try {
        const r = await window.storage.get(k, SHARED);
        return r ? migrate(JSON.parse(r.value)) : null;
      } catch {
        return null;
      }
    }));
    const byId = new Map();
    stored.filter(Boolean).forEach((ch) => byId.set(ch.id, ch));
    (challenges || []).map(migrate).forEach((ch) => byId.set(ch.id, ch));
    const { challenges: deduped } = canonicalizeChallenges([...byId.values()]);
    const keepIds = new Set(deduped.map(ch => ch.id));
    const duplicateIds = [...byId.keys()].filter(id => !keepIds.has(id));
    await Promise.all(deduped.map(ch => window.storage.set(`${CH_PREFIX}${ch.id}`, JSON.stringify(ch), SHARED)));
    await Promise.all(duplicateIds.map(id => window.storage.delete(`${CH_PREFIX}${id}`, SHARED).catch(() => null)));
    return deduped;
  },
  async saveChallenge(ch) {
    try { await window.storage.set(`${CH_PREFIX}${ch.id}`, JSON.stringify(ch), SHARED); return true; }
    catch (e) { console.error('saveChallenge', e); return false; }
  },
  async deleteChallenge(id) {
    try { await window.storage.delete(`${CH_PREFIX}${id}`, SHARED); return true; }
    catch (e) { console.error('deleteChallenge', e); return false; }
  },
  async listPlatformSnapshots() {
    try {
      const res = await window.storage.list(SNAPSHOT_PREFIX, SHARED);
      const keys = res?.keys || [];
      const items = await Promise.all(keys.map(async (k) => {
        try { const r = await window.storage.get(k, SHARED); return r ? JSON.parse(r.value) : null; }
        catch { return null; }
      }));
      return items.filter(Boolean).sort((a, b) => (b.importedAt || 0) - (a.importedAt || 0));
    } catch (e) { console.error('listPlatformSnapshots', e); return []; }
  },
  async savePlatformSnapshot(snapshot) {
    try { await window.storage.set(snapshot.id, JSON.stringify(snapshot), SHARED); return true; }
    catch (e) { console.error('savePlatformSnapshot', e); return false; }
  },
  async listMeetings() {
    try {
      const res = await window.storage.list(MEETING_PREFIX, SHARED);
      const keys = res?.keys || [];
      const items = await Promise.all(keys.map(async (k) => {
        try { const r = await window.storage.get(k, SHARED); return r ? JSON.parse(r.value) : null; }
        catch { return null; }
      }));
      return items.filter(Boolean).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } catch (e) { console.error('listMeetings', e); return []; }
  },
  async saveMeeting(meeting) {
    try { await window.storage.set(meeting.id, JSON.stringify(meeting), SHARED); return true; }
    catch (e) { console.error('saveMeeting', e); return false; }
  },
  async getRoster() {
    try { const r = await window.storage.get(TEAM_KEY, SHARED); return r ? migrateRoster(JSON.parse(r.value)) : []; }
    catch { return []; }
  },
  async saveRoster(r) {
    try { await window.storage.set(TEAM_KEY, JSON.stringify(r), SHARED); return true; }
    catch (e) { console.error('saveRoster', e); return false; }
  },
  async getSettings() {
    try {
      const r = await window.storage.get(SETTINGS_KEY, SHARED);
      return r ? migrateSettings(JSON.parse(r.value)) : DEFAULT_SETTINGS;
    } catch { return DEFAULT_SETTINGS; }
  },
  async saveSettings(s) {
    try { await window.storage.set(SETTINGS_KEY, JSON.stringify(s), SHARED); return true; }
    catch (e) { console.error('saveSettings', e); return false; }
  },
  async clearAll() {
    try {
      const res = await window.storage.list('', SHARED);
      const keys = res?.keys || [];
      await Promise.all(keys.map(k => window.storage.delete(k, SHARED).catch(() => null)));
      return true;
    } catch (e) { console.error('clearAll', e); return false; }
  },
};

function numericValue(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function decayPointsForSolveCount(solveCount, fallback = HR_DECAY_POINTS[1]) {
  const n = Math.max(0, Math.ceil(numericValue(solveCount, 0)));
  if (n <= 0) return fallback;
  if (n >= 7) return HR_DECAY_POINTS[7];
  return HR_DECAY_POINTS[n] ?? fallback;
}

function isHrPriorityWindow(phase) {
  return phase?.phase === 'locked' || phase?.phase === 'scheduled';
}

function isAiCleanupWindow(phase) {
  return phase?.phase === 'open';
}

function hrHoursRemaining(phase) {
  if (phase?.phase === 'locked') return Math.max(0, (phase.phaseRemaining || 0) / 3600_000);
  if (phase?.phase === 'scheduled') return Math.max(0, (phase.lockedMs || 0) / 3600_000);
  return 0;
}

function projectedAdditionalHrSolves(publicSolves, phase) {
  if (!isHrPriorityWindow(phase)) return 0;
  const hoursRemaining = hrHoursRemaining(phase);
  if (publicSolves >= 4) return 0;
  if (publicSolves === 3) return hoursRemaining > 1 ? 2 : 1;
  if (publicSolves >= 1) return 1;
  return hoursRemaining > 1.5 ? 1 : 0;
}

function buildHrValueModel(challenge, phase) {
  const trueCurrentPoints = Math.max(0, numericValue(challenge.platformPoints ?? challenge.points ?? 0));
  const publicSolves = Math.max(0, Math.floor(numericValue(challenge.platformSolveCount ?? 0)));
  const usaSolveNumber = publicSolves + 1;
  const currentCeiling = trueCurrentPoints || decayPointsForSolveCount(Math.max(1, publicSolves), HR_DECAY_POINTS[1]);
  const usaNextTable = decayPointsForSolveCount(usaSolveNumber, currentCeiling);
  const usaNextForecast = Math.min(currentCeiling, usaNextTable);
  const extraBeforeLock = projectedAdditionalHrSolves(publicSolves, phase);
  const hrLockSolveCount = usaSolveNumber + extraBeforeLock;
  const hrLockForecast = isHrPriorityWindow(phase)
    ? Math.min(usaNextForecast, decayPointsForSolveCount(hrLockSolveCount, usaNextForecast))
    : null;
  const aiAdditionalSolves = publicSolves >= 4 ? 1 : publicSolves === 3 ? 2 : 3;
  const aiCleanupSolveCount = usaSolveNumber + extraBeforeLock + aiAdditionalSolves;
  const aiCleanupForecast = Math.min(
    usaNextForecast,
    decayPointsForSolveCount(aiCleanupSolveCount, usaNextForecast),
  );
  const lockGain = hrLockForecast == null ? 0 : Math.max(0, hrLockForecast - aiCleanupForecast);

  return {
    trueCurrentPoints,
    publicSolves,
    usaSolveNumber,
    usaNextForecast,
    extraBeforeLock,
    hrLockSolveCount,
    hrLockForecast,
    aiCleanupForecast,
    aiCleanupSolveCount,
    lockGain,
    shouldParkForAi: publicSolves >= 4,
    shouldDiscussPark: publicSolves === 3,
    lowSolveTarget: publicSolves <= 2,
  };
}

function phaseValueRisk(challenge, settings, phase) {
  if (!settings.startTime || !(settings.useLockedPhase ?? false) || !isHrPriorityWindow(phase)) return 0;
  const model = buildHrValueModel(challenge, phase);
  const hoursRemaining = hrHoursRemaining(phase);
  const urgency = hoursRemaining <= 0.5 ? 1 : hoursRemaining <= 1 ? 0.8 : hoursRemaining <= 2 ? 0.55 : 0.3;
  return Math.round((model.lockGain || model.hrLockForecast || 0) * urgency);
}

function confidenceWeight(value, dict) {
  return (dict[value] || dict.unknown).weight;
}

function estimateRankImpact(challenge, snapshot) {
  if (challenge.rankImpact != null) return challenge.rankImpact;
  const points = challenge.platformPoints ?? challenge.points ?? 0;
  const board = snapshot?.scoreboard;
  if (!points || !board) return Math.round(points * 0.12);
  const gapAbove = Number(board.gapAbove || 0);
  const gapBelow = Number(board.gapBelow || 0);
  let impact = Math.round(points * 0.12);
  if (gapAbove > 0) {
    if (points >= gapAbove) impact += 110;
    else if (points >= gapAbove * 0.7) impact += 75;
    else if (points >= gapAbove * 0.4) impact += 45;
  }
  if (gapBelow > 0 && points >= gapBelow) impact += 25;
  return impact;
}

function resourceFitForChallenge(challenge, roster) {
  const active = roster.filter(p => p.status !== 'subbed-out' && p.availabilityStatus !== 'resting');
  const matching = active.filter(p => (p.strengths || []).includes(challenge.category));
  const available = matching.filter(p => p.availabilityStatus !== 'loaded' && p.availabilityStatus !== 'fatigued');
  return { matching, available };
}

function buildInsightForChallenge(challenge, roster, settings, phase, snapshot) {
  const currentPoints = challenge.platformPoints ?? challenge.points ?? 0;
  const progress = Number(challenge.captainProgress ?? 0);
  const timeSpent = Number(challenge.captainTimeSpentMinutes ?? 0);
  const solveCount = Number(challenge.platformSolveCount ?? 0);
  const assigneeCount = challenge.assignees?.length || 0;
  const hrValue = buildHrValueModel(challenge, phase);
  const inHrWindow = isHrPriorityWindow(phase);
  const inAiWindow = isAiCleanupWindow(phase);
  const phaseRisk = phaseValueRisk(challenge, settings, phase);
  const rankImpact = estimateRankImpact(challenge, snapshot);
  const captainConfidence = confidenceWeight(challenge.captainConfidence, CAPTAIN_CONFIDENCE);
  const phaseConfidence = confidenceWeight(challenge.phaseSolveConfidence, PHASE_SOLVE_CONFIDENCE);
  const fit = resourceFitForChallenge(challenge, roster);
  const iccRec = computeIccRecommendation(challenge, {
    competition: snapshot?.competition,
    phase,
    fit,
  });
  const staleMeeting = !challenge.lastMeetingAt || Date.now() - challenge.lastMeetingAt > 90 * 60_000;
  const opportunityCost = assigneeCount * Math.max(1, Math.round(timeSpent / 30));
  const difficultyDots = DIFFICULTIES[challenge.difficulty]?.dots || 2;
  const easeScore = (4 - difficultyDots) * 140;
  const aiCleanupScore = easeScore + (Math.min(solveCount, 7) * 70) + (progress * 1.5)
    + (challenge.captainConfidence === 'near-solved' ? 220 : 0)
    + (challenge.status === 'stuck' ? 35 : 0);
  const externalSignal = solveCount === 0 ? 30 : Math.max(-80, 120 - (solveCount * 35));

  let score;
  if (inAiWindow) {
    score = aiCleanupScore + (captainConfidence * 1.2) + progress - Math.max(0, currentPoints - 230) * 0.2;
  } else if (inHrWindow) {
    const lockValue = hrValue.hrLockForecast ?? hrValue.usaNextForecast;
    score = (lockValue * 2) + hrValue.lockGain + rankImpact + (captainConfidence * 1.4)
      + phaseConfidence + progress + externalSignal + phaseRisk;
    if (hrValue.usaNextForecast >= 500) score += 140;
    else if (hrValue.usaNextForecast >= 339) score += 85;
    else if (hrValue.usaNextForecast >= 230) score += 35;
    if (hrValue.shouldDiscussPark) score -= challenge.captainConfidence === 'near-solved' ? 10 : 95;
    if (hrValue.shouldParkForAi) score -= challenge.captainConfidence === 'near-solved' ? 65 : 280;
  } else {
    score = currentPoints + phaseRisk + rankImpact + (captainConfidence * 2) + phaseConfidence + progress
      + (solveCount === 0 ? -8 : Math.min(40, solveCount * 4));
  }
  score -= opportunityCost * 10;
  if (challenge.status === 'stuck') score -= 20;
  if (challenge.resourceNeed === 'drop' || challenge.coachDecision === 'drop' || challenge.coachDecision === 'park') score -= 90;
  if (challenge.coachDecision === 'phase_priority') score += 65;
  if (challenge.resourceNeed === 'operator' || challenge.resourceNeed === 'specialist') score += fit.available.length > 0 ? 25 : 5;
  score += iccRecommendationScoreBoost(iccRec);

  const reasons = [];
  if (currentPoints > 0) reasons.push(`TRUE: ${currentPoints} ICC current`);
  if (hrValue.usaNextForecast > 0) reasons.push(`FORECAST: USA next solve ${hrValue.usaNextForecast}pt`);
  if (inHrWindow && hrValue.hrLockForecast != null) {
    reasons.push(`FORECAST: HR lock ${hrValue.hrLockForecast}pt after +${hrValue.extraBeforeLock} HR solve${hrValue.extraBeforeLock === 1 ? '' : 's'}`);
  } else if (inAiWindow) {
    reasons.push(`FORECAST: AI cleanup ${hrValue.aiCleanupForecast}pt`);
  }
  if (hrValue.lockGain > 0) reasons.push(`FORECAST: ${hrValue.lockGain}pt gain over waiting for AI cleanup`);
  if (rankImpact >= 80) reasons.push('could change scoreboard position');
  else if (rankImpact > 0) reasons.push(`${rankImpact} rank-impact estimate`);
  if (phaseRisk > 0) reasons.push(`${phaseRisk} phase urgency value`);
  if (challenge.captainConfidence && challenge.captainConfidence !== 'unknown') reasons.push(`${CAPTAIN_CONFIDENCE[challenge.captainConfidence]?.label} captain confidence`);
  if (challenge.phaseSolveConfidence && challenge.phaseSolveConfidence !== 'unknown') reasons.push(`${PHASE_SOLVE_CONFIDENCE[challenge.phaseSolveConfidence]?.label} before phase change`);
  if (progress > 0) reasons.push(`${progress}% progress detail`);
  if (timeSpent > 0) reasons.push(`${timeSpent}m already invested`);
  if (solveCount >= 4) reasons.push(`${solveCount} public solves - park for AI unless finish is tiny`);
  else if (solveCount === 3) reasons.push('3 public solves - captain discussion before HR push');
  else if (solveCount > 0) reasons.push(`${solveCount} public solve${solveCount === 1 ? '' : 's'} - still an HR target`);
  else if (challenge.platformId) reasons.push('no public solves yet');
  if (assigneeCount > 0) reasons.push(`${assigneeCount} operator${assigneeCount === 1 ? '' : 's'} assigned`);
  if (challenge.resourceNeed && challenge.resourceNeed !== 'none') reasons.push(RESOURCE_NEEDS[challenge.resourceNeed]?.label || challenge.resourceNeed);
  if (staleMeeting) reasons.push('needs fresh captain report');
  if (iccRec?.reasons?.length) reasons.push(...iccRec.reasons.slice(0, 2));

  const missingConfidence = !challenge.captainConfidence || challenge.captainConfidence === 'unknown' || !challenge.phaseSolveConfidence || challenge.phaseSolveConfidence === 'unknown';
  let lane = 'ask';
  if (challenge.status === 'solved' || challenge.platformSolved) lane = 'solved';
  else if (challenge.resourceNeed === 'drop' || challenge.coachDecision === 'drop' || (captainConfidence <= 20 && timeSpent >= 90 && currentPoints < 250)) lane = 'drop';
  else if (inAiWindow) {
    if (challenge.captainConfidence === 'near-solved' || progress >= 35) lane = 'continue';
    else if (challenge.resourceNeed === 'operator' || challenge.resourceNeed === 'specialist' || challenge.resourceNeed === 'rest' || challenge.status === 'stuck') lane = 'resource';
    else lane = 'drop';
  } else if (inHrWindow) {
    if (challenge.coachDecision === 'park' || (hrValue.shouldParkForAi && challenge.captainConfidence !== 'near-solved')) lane = 'drop';
    else if (challenge.captainConfidence === 'near-solved' || progress >= 70) lane = 'continue';
    else if (hrValue.shouldDiscussPark && challenge.captainConfidence !== 'near-solved') lane = 'ask';
    else if (hrValue.lowSolveTarget && (hrValue.usaNextForecast >= 500 || hrValue.hrLockForecast >= 339 || currentPoints >= 450)) lane = 'win';
    else if (hrValue.lowSolveTarget) lane = 'lock';
    else if (challenge.resourceNeed === 'operator' || challenge.resourceNeed === 'specialist' || challenge.resourceNeed === 'rest' || challenge.status === 'stuck') lane = 'resource';
    else if (missingConfidence || staleMeeting) lane = 'ask';
    else if (captainConfidence >= 45 || progress >= 25) lane = 'continue';
  } else if (challenge.coachDecision === 'park') lane = 'drop';
  else if (missingConfidence || staleMeeting) lane = 'ask';
  else if (rankImpact >= 80) lane = 'win';
  else if (phaseRisk > 0 && (phaseConfidence >= 45 || captainConfidence >= 45)) lane = 'lock';
  else if (challenge.resourceNeed === 'operator' || challenge.resourceNeed === 'specialist' || challenge.resourceNeed === 'rest' || challenge.status === 'stuck') lane = 'resource';
  else if (captainConfidence >= 45 || progress >= 25) lane = 'continue';

  const questionPrompts = [];
  if (inHrWindow && solveCount <= 2) questionPrompts.push(`Can we convert this before Human Resistance ends and lock roughly ${hrValue.hrLockForecast ?? hrValue.usaNextForecast}pt?`);
  if (inHrWindow && solveCount === 3) questionPrompts.push('Ask captain if this is near enough to justify HR time before parking for AI.');
  if (inHrWindow && solveCount >= 4) questionPrompts.push('Park for AI unless captain says the remaining finish cost is tiny.');
  if (inAiWindow) questionPrompts.push('AI cleanup: take the easiest, most-solved items first unless a captain has a near-finished path.');
  if (challenge.captainConfidence === 'unknown') questionPrompts.push('Ask captain: low, medium, high, or near-solved confidence?');
  if (phaseRisk > 0 && challenge.phaseSolveConfidence === 'unknown') questionPrompts.push('Ask whether this can realistically solve before the phase freeze.');
  if (staleMeeting) questionPrompts.push('Get current operators assigned and whether to add, swap, or drop resources.');
  if (captainConfidence < 45 && timeSpent > 45) questionPrompts.push('Ask if continued time is likely to convert into points before the next meeting.');
  if (challenge.resourceNeed === 'operator' || challenge.resourceNeed === 'specialist') questionPrompts.push(`Ask whether ${fit.available.length ? fit.available.map(p => p.name).slice(0, 3).join(', ') : 'another specialist'} would materially improve odds.`);
  if (!questionPrompts.length) questionPrompts.push('Confirm progress confidence and next resource decision.');

  return {
    challenge,
    lane,
    score: Math.round(score),
    currentPoints,
    hrValue,
    aiCleanupScore,
    phaseRisk,
    rankImpact,
    progress,
    timeSpent,
    opportunityCost,
    captainConfidence,
    phaseConfidence,
    resourceFit: fit,
    iccRec,
    reasons,
    questionPrompts,
  };
}

function buildInsights(challenges, roster, settings, phase, snapshot) {
  const inAiWindow = isAiCleanupWindow(phase);
  const lanes = {
    win: { label: 'LOCK 500S', color: '#d4a843', items: [] },
    lock: { label: 'MANUAL HR TARGETS', color: '#f59e0b', items: [] },
    ask: { label: 'CAPTAIN CHECK', color: '#06b6d4', items: [] },
    resource: { label: 'RESOURCE SHIFT', color: '#a855f7', items: [] },
    continue: { label: 'FINISH IF NEAR', color: '#10b981', items: [] },
    drop: { label: inAiWindow ? 'AI CLEANUP' : 'PARK FOR AI', color: inAiWindow ? '#a855f7' : '#ef4444', items: [] },
    solved: { label: 'SOLVED / VERIFIED', color: '#10b981', items: [] },
  };
  challenges.map(ch => buildInsightForChallenge(ch, roster, settings, phase, snapshot))
    .forEach(insight => lanes[insight.lane].items.push(insight));
  Object.entries(lanes).forEach(([key, lane]) => {
    lane.items.sort((a, b) => {
      if (inAiWindow && key === 'drop') {
        const aDots = DIFFICULTIES[a.challenge.difficulty]?.dots || 2;
        const bDots = DIFFICULTIES[b.challenge.difficulty]?.dots || 2;
        if (aDots !== bDots) return aDots - bDots;
        const aSolves = a.hrValue?.publicSolves ?? Number(a.challenge.platformSolveCount ?? 0);
        const bSolves = b.hrValue?.publicSolves ?? Number(b.challenge.platformSolveCount ?? 0);
        if (aSolves !== bSolves) return bSolves - aSolves;
      }
      return b.score - a.score;
    });
  });
  return lanes;
}

// ============================================================
// USCT LOGO (inline SVG)
// ============================================================

function USCTLogo({ size = 64 }) {
  return (
    <img
      src="data:image/webp;base64,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"
      width={size}
      height={size}
      alt="US Cyber Team"
      style={{
        display: 'block',
        borderRadius: '50%',
        filter: 'drop-shadow(0 0 12px rgba(212, 168, 67, 0.35))',
      }}
    />
  );
}

// ============================================================
// PRIMITIVES
// ============================================================

const Badge = ({ children, color = '#94a3b8', variant = 'soft', size = 'sm', style = {}, ...rest }) => {
  const base = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    fontFamily: '"Chakra Petch", sans-serif', fontWeight: 600,
    letterSpacing: '0.08em', textTransform: 'uppercase',
    borderRadius: 3, padding: size === 'sm' ? '3px 8px' : '5px 12px',
    fontSize: size === 'sm' ? 10 : 11, border: `1px solid ${color}`,
  };
  if (variant === 'soft') { base.background = `${color}1a`; base.color = color; }
  else { base.background = color; base.color = '#0a0e1a'; }
  return <span style={{ ...base, ...style }} {...rest}>{children}</span>;
};

const DifficultyDots = ({ level, size = 6 }) => {
  const d = DIFFICULTIES[level];
  if (!d) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
      {[1, 2, 3].map(i => (
        <span key={i} style={{
          width: size, height: size, borderRadius: 1,
          background: i <= d.dots ? d.color : 'rgba(255,255,255,0.12)',
          boxShadow: i <= d.dots ? `0 0 6px ${d.color}80` : 'none',
        }} />
      ))}
    </span>
  );
};

const IconBtn = ({ onClick, children, title, active, danger, style = {} }) => (
  <button onClick={onClick} title={title} style={{
    background: active ? 'rgba(212, 168, 67, 0.15)' : 'transparent',
    border: `1px solid ${active ? '#d4a843' : 'rgba(255,255,255,0.12)'}`,
    color: danger ? '#ef4444' : active ? '#d4a843' : 'rgba(255,255,255,0.7)',
    width: 34, height: 34, borderRadius: 4,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', transition: 'all 120ms', ...style,
  }}
  onMouseEnter={e => { if (!active && !danger) { e.currentTarget.style.borderColor = 'rgba(212,168,67,0.5)'; e.currentTarget.style.color = '#d4a843'; }}}
  onMouseLeave={e => { if (!active && !danger) { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; e.currentTarget.style.color = 'rgba(255,255,255,0.7)'; }}}>
    {children}
  </button>
);

const PrimaryBtn = ({ onClick, children, style = {}, disabled }) => (
  <button onClick={disabled ? undefined : onClick} disabled={disabled} style={{
    background: disabled ? 'rgba(255,255,255,0.06)' : 'linear-gradient(180deg, #e0b450 0%, #c49533 100%)',
    color: disabled ? 'rgba(255,255,255,0.3)' : '#0a0e1a',
    border: `1px solid ${disabled ? 'rgba(255,255,255,0.1)' : '#e0b450'}`,
    padding: '9px 16px', borderRadius: 4, cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: '"Chakra Petch", sans-serif', fontWeight: 700,
    letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: 12,
    display: 'inline-flex', alignItems: 'center', gap: 8,
    boxShadow: disabled ? 'none' : '0 0 24px rgba(212, 168, 67, 0.25)',
    transition: 'all 150ms', ...style,
  }}
  onMouseEnter={e => { if (!disabled) { e.currentTarget.style.boxShadow = '0 0 32px rgba(212, 168, 67, 0.5)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}}
  onMouseLeave={e => { if (!disabled) { e.currentTarget.style.boxShadow = '0 0 24px rgba(212, 168, 67, 0.25)'; e.currentTarget.style.transform = 'translateY(0)'; }}}>
    {children}
  </button>
);

const GhostBtn = ({ onClick, children, style = {}, danger, disabled }) => (
  <button onClick={disabled ? undefined : onClick} disabled={disabled} style={{
    background: 'transparent',
    color: disabled ? 'rgba(255,255,255,0.3)' : danger ? '#ef4444' : 'rgba(255,255,255,0.85)',
    border: `1px solid ${disabled ? 'rgba(255,255,255,0.08)' : danger ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.15)'}`,
    padding: '8px 14px', borderRadius: 4, cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: '"Chakra Petch", sans-serif', fontWeight: 600,
    letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: 12,
    display: 'inline-flex', alignItems: 'center', gap: 8,
    transition: 'all 120ms', ...style,
  }}
  onMouseEnter={e => { if (!disabled) e.currentTarget.style.borderColor = danger ? '#ef4444' : 'rgba(212,168,67,0.5)'; }}
  onMouseLeave={e => { if (!disabled) e.currentTarget.style.borderColor = danger ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.15)'; }}>
    {children}
  </button>
);

const Input = ({ value, onChange, placeholder, type = 'text', style = {}, ...rest }) => (
  <input type={type} value={value} onChange={onChange} placeholder={placeholder}
    style={{
      background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.12)',
      color: '#fff', padding: '9px 12px', borderRadius: 3, width: '100%',
      fontFamily: '"Chakra Petch", sans-serif', fontSize: 14, outline: 'none',
      transition: 'border-color 120ms, box-shadow 120ms', ...style,
    }}
    onFocus={e => { e.target.style.borderColor = '#d4a843'; e.target.style.boxShadow = '0 0 0 3px rgba(212,168,67,0.15)'; }}
    onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.12)'; e.target.style.boxShadow = 'none'; }}
    {...rest} />
);

const Select = ({ value, onChange, options, style = {}, ...rest }) => (
  <select value={value} onChange={onChange} style={{
    background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.12)',
    color: '#fff', padding: '9px 12px', borderRadius: 3,
    fontFamily: '"Chakra Petch", sans-serif', fontSize: 13, outline: 'none',
    cursor: rest.disabled ? 'not-allowed' : 'pointer', appearance: 'none',
    backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23d4a843' stroke-width='2'><polyline points='6 9 12 15 18 9'/></svg>")`,
    backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center', paddingRight: 30,
    opacity: rest.disabled ? 0.65 : 1, ...style,
  }} {...rest}>
    {options.map(o => (
      <option key={o.value} value={o.value} style={{ background: '#141b2e', color: '#fff' }}>
        {o.label}
      </option>
    ))}
  </select>
);

const SectionLabel = ({ icon, children }) => (
  <div style={{
    fontSize: 10, letterSpacing: '0.2em', color: '#d4a843',
    fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6,
  }}>{icon}{children}</div>
);

// ============================================================
// MAIN APP
// ============================================================

export default function CoachCommandCenter() {
  const [challenges, setChallenges] = useState([]);
  const [roster, setRoster] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [platformSnapshots, setPlatformSnapshots] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [iccSync, setIccSync] = useState({
    configured: false,
    status: 'idle',
    error: null,
    lastSyncAt: null,
    alerts: [],
  });
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const iccSyncInFlight = useRef(false);

  const [view, setView] = useState('challenges');
  const [selectedId, setSelectedId] = useState(null);
  const [selectedOp, setSelectedOp] = useState(null);
  const [meetingChallengeId, setMeetingChallengeId] = useState(null);
  const [showRoster, setShowRoster] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('all');
  const [filterDiff, setFilterDiff] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterAssignee, setFilterAssignee] = useState('all');
  const [sortBy, setSortBy] = useState('updated');
  const [showStarred, setShowStarred] = useState(false);

  useEffect(() => {
    (async () => {
      const [chs, rs, st, ps, ms] = await Promise.all([
        storage.listChallenges(), storage.getRoster(), storage.getSettings(),
        storage.listPlatformSnapshots(), storage.listMeetings(),
      ]);
      setChallenges(chs); setRoster(rs); setSettings(st); setPlatformSnapshots(ps); setMeetings(ms); setLoading(false);
    })();
  }, []);

  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(async () => {
      const chs = await storage.listChallenges();
      setChallenges(chs);
    }, 8000);
    return () => clearInterval(t);
  }, []);

  const refresh = useCallback(async () => {
    const [chs, rs, st, ps, ms] = await Promise.all([
      storage.listChallenges(), storage.getRoster(), storage.getSettings(),
      storage.listPlatformSnapshots(), storage.listMeetings(),
    ]);
    setChallenges(chs); setRoster(rs); setSettings(st); setPlatformSnapshots(ps); setMeetings(ms);
  }, []);

  const upsertChallenge = useCallback(async (ch) => {
    const updated = { ...ch, updatedAt: Date.now() };
    const idx = challenges.findIndex(c => c.id === updated.id);
    const next = idx >= 0 ? [...challenges] : [...challenges, updated];
    if (idx >= 0) next[idx] = updated;
    const canonical = canonicalizeChallenges(next).challenges;
    setChallenges(canonical);
    await storage.saveCanonicalChallenges(canonical);
  }, [challenges]);

  const savePlatformSnapshot = useCallback(async (snapshot) => {
    const merged = applyPlatformSnapshotToChallenges(challenges, snapshot, roster);
    const deduped = canonicalizeChallenges(merged).challenges;
    setPlatformSnapshots(prev => [snapshot, ...prev].sort((a, b) => (b.importedAt || 0) - (a.importedAt || 0)));
    setChallenges(deduped);
    await storage.savePlatformSnapshot(snapshot);
    await storage.saveCanonicalChallenges(deduped.map(ch => ({ ...ch, updatedAt: Date.now() })));
  }, [challenges, roster]);

  const syncIccFromApi = useCallback(async () => {
    if (iccSyncInFlight.current) return;
    iccSyncInFlight.current = true;
    setIccSync(s => ({ ...s, status: s.configured ? 'loading' : s.status }));
    try {
      const bundle = await fetchIccBundle();
      const snapshot = buildSnapshotFromIccBundle(bundle);
      const alerts = buildIccAlerts(bundle);
      setIccSync({
        configured: true,
        status: 'ok',
        error: null,
        lastSyncAt: Date.now(),
        alerts,
      });
      const current = await storage.listChallenges();
      const merged = applyPlatformSnapshotToChallenges(current, snapshot, roster);
      setChallenges(merged);
      await storage.savePlatformSnapshot(snapshot);
      await storage.saveCanonicalChallenges(merged.map(ch => ({ ...ch, updatedAt: Date.now() })));
      setPlatformSnapshots(prev => {
        const rest = prev.filter(s => s.id !== snapshot.id);
        return [snapshot, ...rest].slice(0, 30);
      });
    } catch (e) {
      setIccSync(s => ({
        ...s,
        configured: s.configured,
        status: 'error',
        error: e?.message || 'ICC sync failed',
      }));
    } finally {
      iccSyncInFlight.current = false;
    }
  }, [roster]);

  useEffect(() => {
    let cancelled = false;
    let timer = null;

    (async () => {
      const statusRes = await fetchIccStatus().catch(() => ({ configured: false }));
      if (cancelled) return;
      if (!statusRes.configured) {
        setIccSync(s => ({ ...s, configured: false, status: 'idle' }));
        return;
      }
      setIccSync(s => ({ ...s, configured: true }));
      const tick = async () => {
        if (cancelled) return;
        await syncIccFromApi();
        if (!cancelled) timer = setTimeout(tick, 15000);
      };
      await tick();
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [syncIccFromApi]);

  const saveMeetingUpdate = useCallback(async (challengeId, update) => {
    const now = Date.now();
    const meeting = {
      id: `${MEETING_PREFIX}${now}`,
      createdAt: now,
      challengeId,
      ...update,
    };
    const ch = challenges.find(c => c.id === challengeId);
    if (!ch) return;
    const updatedChallenge = migrate({
      ...ch,
      assignees: update.assignees,
      captainProgress: update.captainProgress,
      captainTimeSpentMinutes: update.captainTimeSpentMinutes,
      captainConfidence: update.captainConfidence,
      phaseSolveConfidence: update.phaseSolveConfidence,
      resourceAskCategory: update.resourceAskCategory,
      resourceAskName: update.resourceAskName,
      resourceNeed: update.resourceNeed,
      coachDecision: update.coachDecision,
      lastMeetingAt: now,
      meetingHistory: [...(ch.meetingHistory || []), meeting].slice(-20),
    });
    await upsertChallenge(updatedChallenge);
    setMeetings(prev => [meeting, ...prev]);
    await storage.saveMeeting(meeting);
  }, [challenges, upsertChallenge]);

  const quickUpdateChallenge = useCallback(async (challengeId, patch) => {
    const ch = challenges.find(c => c.id === challengeId);
    if (!ch) return;
    await upsertChallenge(migrate({ ...ch, ...patch }));
  }, [challenges, upsertChallenge]);

  // ROBUST DELETE: optimistic local removal, then storage delete, then verify
  const removeChallenge = useCallback(async (id) => {
    setChallenges(prev => prev.filter(c => c.id !== id));
    if (selectedId === id) setSelectedId(null);
    await storage.deleteChallenge(id);
    // Re-fetch shortly to confirm deletion stuck (in case of conflicts)
    setTimeout(async () => {
      const chs = await storage.listChallenges();
      setChallenges(chs);
    }, 600);
  }, [selectedId]);

  const saveRoster = useCallback(async (r) => { await storage.saveRoster(r); setRoster(r); }, []);
  const saveSettings = useCallback(async (s) => { await storage.saveSettings(s); setSettings(s); }, []);

  const clearAllData = useCallback(async () => {
    if (!window.confirm('PERMANENTLY DELETE all challenges, roster, and competition settings? This affects everyone using this artifact. Cannot be undone.')) return;
    await storage.clearAll();
    setChallenges([]);
    setRoster([]);
    setSettings(DEFAULT_SETTINGS);
    setPlatformSnapshots([]);
    setMeetings([]);
    setShowRoster(false);
  }, []);

  const activeRoster = useMemo(() => roster.filter(p => p.status !== 'subbed-out'), [roster]);

  const phase = useMemo(() => getPhase(settings), [settings, tick]);

  const liveSnapshot = useMemo(
    () => platformSnapshots.find(s => s.source === 'icc') || platformSnapshots[0],
    [platformSnapshots],
  );

  const insightLanes = useMemo(
    () => buildInsights(challenges, activeRoster, settings, phase, liveSnapshot),
    [challenges, activeRoster, settings, phase, liveSnapshot, tick],
  );

  const iccRecommendations = useMemo(() => {
    const comp = liveSnapshot?.competition;
    const map = new Map();
    for (const ch of challenges) {
      const fit = resourceFitForChallenge(ch, activeRoster);
      map.set(ch.id, computeIccRecommendation(ch, { competition: comp, phase, fit }));
    }
    return map;
  }, [challenges, activeRoster, liveSnapshot, phase]);

  const visible = useMemo(() => {
    let arr = challenges;
    if (showStarred) arr = arr.filter(c => c.starred);
    if (filterCat !== 'all') arr = arr.filter(c => c.category === filterCat);
    if (filterDiff !== 'all') arr = arr.filter(c => c.difficulty === filterDiff);
    if (filterStatus !== 'all') arr = arr.filter(c => c.status === filterStatus);
    if (filterAssignee !== 'all') {
      if (filterAssignee === '__none__') arr = arr.filter(c => c.assignees.length === 0);
      else arr = arr.filter(c => c.assignees.includes(filterAssignee));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      arr = arr.filter(c =>
        c.title.toLowerCase().includes(q) ||
        c.notes.toLowerCase().includes(q) ||
        c.tags.some(t => t.toLowerCase().includes(q))
      );
    }
    const statusOrder = { 'in-progress': 0, stuck: 1, unsolved: 2, solved: 3 };
    const sorted = [...arr];
    sorted.sort((a, b) => {
      switch (sortBy) {
        case 'created':    return b.createdAt - a.createdAt;
        case 'points':     return (b.points || 0) - (a.points || 0);
        case 'difficulty': return DIFFICULTIES[b.difficulty].dots - DIFFICULTIES[a.difficulty].dots;
        case 'title':      return a.title.localeCompare(b.title);
        case 'status':     return statusOrder[a.status] - statusOrder[b.status];
        case 'updated':
        default:           return b.updatedAt - a.updatedAt;
      }
    });
    return sorted;
  }, [challenges, search, filterCat, filterDiff, filterStatus, filterAssignee, sortBy, showStarred, tick]);

  const stats = useMemo(() => {
    const total = challenges.length;
    const solved = challenges.filter(c => c.status === 'solved').length;
    const inProg = challenges.filter(c => c.status === 'in-progress').length;
    const stuck = challenges.filter(c => c.status === 'stuck').length;
    const points = challenges.filter(c => c.status === 'solved').reduce((s, c) => s + (c.points || 0), 0);
    const totalOps = activeRoster.length;
    const engagedOps = new Set();
    challenges.forEach(c => {
      if (c.status === 'in-progress' || c.status === 'stuck') c.assignees.forEach(a => engagedOps.add(a));
    });
    const byCat = Object.keys(CATEGORIES).map(k => ({
      key: k, total: challenges.filter(c => c.category === k).length,
      solved: challenges.filter(c => c.category === k && c.status === 'solved').length,
    }));
    const hrSolved = challenges.filter(c => solvedPhase(c, settings) === 'locked');
    const solvedHR = hrSolved.length;
    const pendingHR = hrSolved.filter(c => solvedLockState(c, settings) === 'pending').length;
    const lockedHR = hrSolved.filter(c => solvedLockState(c, settings) === 'locked').length;
    const pointsHR = hrSolved.reduce((s, c) => s + (c.points || 0), 0);
    return { total, solved, inProg, stuck, points, totalOps, engagedOps: engagedOps.size, byCat, solvedHR, pendingHR, lockedHR, pointsHR };
  }, [challenges, activeRoster, settings, tick]);

  const selected = challenges.find(c => c.id === selectedId);
  const meetingChallenge = challenges.find(c => c.id === meetingChallengeId);
  const subsRemaining = MAX_SUBS_PER_DAY - (settings.subsUsed || 0);

  const staleAlerts = useMemo(() => {
    if (!settings.startTime || phase.phase === 'pending' || phase.phase === 'scheduled' || phase.phase === 'ended') return [];
    const now = Date.now();
    return challenges
      .filter(c => (c.status === 'in-progress' || c.status === 'stuck') &&
                   (now - c.updatedAt) > STALE_THRESHOLD_MS)
      .sort((a, b) => a.updatedAt - b.updatedAt);
  }, [challenges, settings, phase, tick]);

  return (
    <div style={{
      minHeight: '100vh', background: '#070a14', color: '#e6e9f0',
      fontFamily: '"Chakra Petch", sans-serif', position: 'relative',
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-track { background: #0a0e1a; }
        ::-webkit-scrollbar-thumb { background: rgba(212,168,67,0.3); border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(212,168,67,0.5); }
        textarea { resize: vertical; }
        .ctf-grid-bg {
          background-image:
            linear-gradient(rgba(212,168,67,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(212,168,67,0.04) 1px, transparent 1px);
          background-size: 32px 32px;
        }
        @keyframes pulseGlow { 0%,100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.5); } 50% { box-shadow: 0 0 0 6px rgba(245, 158, 11, 0); } }
        @keyframes pulseRed { 0%,100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.6); } 50% { box-shadow: 0 0 0 8px rgba(239, 68, 68, 0); } }
        @keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
        @keyframes flashUrgent { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        .logo-ring {
          position: absolute; inset: -8px; border-radius: 50%;
          border: 1px dashed rgba(212,168,67,0.35);
          animation: spin 40s linear infinite;
        }
      `}</style>

      <div className="ctf-grid-bg" style={{ position: 'absolute', inset: 0, opacity: 0.6, pointerEvents: 'none' }} />

      <div style={{ position: 'relative', maxWidth: 1400, margin: '0 auto', padding: '24px 28px 80px' }}>
        {/* HEADER */}
        <header style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
              <div style={{ width: 64, height: 64, position: 'relative', flexShrink: 0 }}>
                <USCTLogo size={64} />
                <div className="logo-ring" />
              </div>
              <div>
                <div style={{
                  fontSize: 10, letterSpacing: '0.3em', color: '#d4a843',
                  fontWeight: 600, marginBottom: 2,
                }}>
                  ◆ US CYBER TEAM ◆ OPERATIONS ◆
                </div>
                <h1 style={{
                  margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: '0.04em',
                  background: 'linear-gradient(180deg, #fff 0%, #c9d0e0 100%)',
                  WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}>
                  {settings.eventName || 'COACH COMMAND CENTER'}
                </h1>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <SubCounter remaining={subsRemaining} />
              <IconBtn onClick={refresh} title="Refresh"><RefreshCw size={15} /></IconBtn>
              <IconBtn onClick={() => setShowRoster(true)} title="Roster & Settings"><Users size={15} /></IconBtn>
              <PrimaryBtn onClick={() => setShowAdd(true)}>
                <Plus size={15} strokeWidth={3} /> New Challenge
              </PrimaryBtn>
            </div>
          </div>
        </header>

        <CompetitionPanel phase={phase} settings={settings}
          onConfigureTime={() => setShowRoster(true)}
          onSaveSettings={saveSettings} />

        {staleAlerts.length > 0 && (
          <div style={{
            marginTop: 12, padding: '10px 14px',
            background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239,68,68,0.25)',
            borderRadius: 4, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          }}>
            <BatteryWarning size={16} color="#ef4444" />
            <span style={{ fontSize: 11, letterSpacing: '0.15em', color: '#fca5a5', fontWeight: 600 }}>
              NO UPDATE 30M+
            </span>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>
              {staleAlerts.length} engaged/stuck challenge{staleAlerts.length > 1 ? 's' : ''} not updated in last 30 min — request a captain sync:
            </span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {staleAlerts.slice(0, 4).map(c => (
                <button key={c.id} onClick={() => setSelectedId(c.id)} style={{
                  background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
                  color: '#fca5a5', padding: '3px 9px', borderRadius: 2, cursor: 'pointer',
                  fontSize: 11, fontFamily: '"Chakra Petch", sans-serif',
                }}>
                  {c.title || 'untitled'} · {fmtRelative(c.updatedAt)}
                </button>
              ))}
              {staleAlerts.length > 4 && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>+{staleAlerts.length - 4} more</span>}
            </div>
          </div>
        )}

        {/* STATS STRIP */}
        <div style={{
          marginTop: 12, display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10,
        }}>
          <StatCard label="CHALLENGES" value={stats.total} icon={<Hash size={14} />} />
          <StatCard label="SOLVED" value={stats.solved} icon={<Check size={14} />} accent="#10b981"
            sub={stats.total ? `${Math.round((stats.solved / stats.total) * 100)}%` : '0%'} />
          <StatCard label="ENGAGED" value={stats.inProg} icon={<Activity size={14} />} accent="#f59e0b" />
          <StatCard label="STUCK" value={stats.stuck} icon={<AlertCircle size={14} />} accent="#dc2626" />
          <StatCard label="OPS ENGAGED" value={`${stats.engagedOps}/${stats.totalOps}`} icon={<UserCheck size={14} />} accent="#d4a843" />
          {settings.startTime ? (
            <StatCard
              label={phase.phase === 'locked' ? 'HR LOCK PENDING' : 'HR LOCKED'}
              value={`${stats.solvedHR} · ${stats.pointsHR}pt`}
              icon={<Lock size={14} />}
              accent={stats.pendingHR > 0 ? '#f59e0b' : '#10b981'}
              sub={stats.pendingHR > 0 ? `${stats.pendingHR} pending` : `${stats.lockedHR} locked`} />
          ) : (
            <StatCard label="POINTS" value={stats.points} icon={<Award size={14} />} accent="#d4a843" />
          )}
        </div>

        {/* CATEGORY BAR */}
        <div style={{
          marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6,
          padding: '8px 12px', background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.06)', borderRadius: 4,
        }}>
          {stats.byCat.filter(b => b.total > 0).map(b => {
            const cat = CATEGORIES[b.key];
            const pct = b.total ? (b.solved / b.total) * 100 : 0;
            return (
              <div key={b.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <span style={{ width: 7, height: 7, background: cat.color, borderRadius: 1 }} />
                <span style={{ letterSpacing: '0.1em', color: 'rgba(255,255,255,0.65)' }}>{cat.label}</span>
                <span style={{ fontFamily: '"JetBrains Mono", monospace', color: cat.color, fontWeight: 600 }}>
                  {b.solved}/{b.total}
                </span>
                <span style={{ width: 36, height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 1, overflow: 'hidden' }}>
                  <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: cat.color }} />
                </span>
              </div>
            );
          })}
          {stats.byCat.every(b => b.total === 0) && (
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.1em' }}>
              NO CHALLENGES TRACKED YET
            </span>
          )}
        </div>

        {/* VIEW TABS */}
        <div style={{
          marginTop: 18, display: 'flex', gap: 0, marginBottom: 16,
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}>
          <TabBtn active={view === 'challenges'} onClick={() => setView('challenges')}
            icon={<Target size={14} />} label="CHALLENGES" count={challenges.length} />
          <TabBtn active={view === 'operators'} onClick={() => setView('operators')}
            icon={<Users size={14} />} label="OPERATORS" count={activeRoster.length}
            badge={stats.engagedOps > 0 ? `${stats.engagedOps} ENGAGED` : null} />
          <TabBtn active={view === 'meetings'} onClick={() => setView('meetings')}
            icon={<Radio size={14} />} label="MEETINGS" count={Object.values(insightLanes).reduce((n, lane) => n + (lane.label === 'SOLVED / VERIFIED' ? 0 : lane.items.length), 0)}
            badge={iccSync.configured ? 'ICC LIVE' : platformSnapshots.length ? 'PLATFORM' : 'MANUAL'} />
        </div>

        {view === 'challenges' && (
          <>
            <div style={{
              display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
              padding: '12px 14px', marginBottom: 16,
              background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 4,
            }}>
              <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 200 }}>
                <Search size={14} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.4)' }} />
                <Input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search title, notes, tags…" style={{ paddingLeft: 34 }} />
              </div>
              <Select value={filterCat} onChange={e => setFilterCat(e.target.value)}
                options={[{ value: 'all', label: 'All categories' }, ...Object.entries(CATEGORIES).map(([k, v]) => ({ value: k, label: v.label }))]} />
              <Select value={filterDiff} onChange={e => setFilterDiff(e.target.value)}
                options={[{ value: 'all', label: 'All difficulties' }, ...Object.entries(DIFFICULTIES).map(([k, v]) => ({ value: k, label: v.label }))]} />
              <Select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                options={[{ value: 'all', label: 'All statuses' }, ...Object.entries(STATUSES).map(([k, v]) => ({ value: k, label: v.label }))]} />
              <Select value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)}
                options={[
                  { value: 'all', label: 'Anyone' }, { value: '__none__', label: 'Unassigned' },
                  ...activeRoster.map(p => ({ value: p.name, label: p.name })),
                ]} />
              <Select value={sortBy} onChange={e => setSortBy(e.target.value)}
                options={SORT_OPTIONS.map(o => ({ value: o.value, label: `↓ ${o.label}` }))} />
              <IconBtn onClick={() => setShowStarred(s => !s)} active={showStarred} title="Show starred only">
                <Star size={15} fill={showStarred ? '#d4a843' : 'none'} />
              </IconBtn>
            </div>

            {loading ? (
              <LoadingState />
            ) : visible.length === 0 ? (
              <EmptyState hasChallenges={challenges.length > 0} onAdd={() => setShowAdd(true)} />
            ) : (
              <div style={{
                display: 'grid', gap: 14,
                gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))',
              }}>
                {visible.map(c => (
                  <ChallengeCard key={c.id} challenge={c} settings={settings} phase={phase}
                    iccRec={iccRecommendations.get(c.id)}
                    onClick={() => setSelectedId(c.id)}
                    onToggleStar={() => upsertChallenge({ ...c, starred: !c.starred })} />
                ))}
              </div>
            )}
          </>
        )}

        {view === 'operators' && (
          <OperatorsView
            roster={activeRoster} allRoster={roster} challenges={challenges}
            onSelectChallenge={(id) => setSelectedId(id)}
            onSelectOperator={setSelectedOp}
            onAddOperator={() => setShowRoster(true)} />
        )}

        {view === 'meetings' && (
          <MeetingsView
            challenges={challenges}
            roster={activeRoster}
            settings={settings}
            phase={phase}
            lanes={insightLanes}
            snapshots={platformSnapshots}
            meetings={meetings}
            iccSync={iccSync}
            iccRecommendations={iccRecommendations}
            onIccSyncNow={syncIccFromApi}
            onImportSnapshot={savePlatformSnapshot}
            onQuickUpdate={quickUpdateChallenge}
            onOpenChallenge={setSelectedId}
            onUpdateMeeting={setMeetingChallengeId}
            onConfigureRoster={() => setShowRoster(true)} />
        )}

        <footer style={{
          marginTop: 60, paddingTop: 20, borderTop: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontSize: 10, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.35)',
        }}>
          <div>◆ COACH COMMAND CENTER · USCT · ICC 2026</div>
          <div style={{ fontFamily: '"JetBrains Mono", monospace' }}>
            {view === 'challenges'
              ? `SHOWING ${visible.length} / ${challenges.length}`
              : view === 'operators'
                ? `${activeRoster.length} ACTIVE OPERATOR${activeRoster.length === 1 ? '' : 'S'}`
                : `${meetings.length} MEETING UPDATE${meetings.length === 1 ? '' : 'S'}`}
          </div>
        </footer>
      </div>

      {selected && (
        <ChallengeDetail challenge={selected} roster={roster} settings={settings} phase={phase}
          onClose={() => setSelectedId(null)}
          onSave={upsertChallenge}
          onDelete={() => removeChallenge(selected.id)} />
      )}
      {showAdd && (
        <AddModal roster={activeRoster}
          onClose={() => setShowAdd(false)}
          onCreate={async (data) => {
            const ch = newChallenge(data);
            await upsertChallenge(ch);
            setShowAdd(false);
            setSelectedId(ch.id);
          }} />
      )}
      {showRoster && (
        <RosterModal roster={roster} settings={settings} challenges={challenges}
          platformSnapshots={platformSnapshots}
          meetings={meetings}
          subsRemaining={subsRemaining}
          onClose={() => setShowRoster(false)}
          onSaveRoster={saveRoster}
          onSaveSettings={saveSettings}
          onClearAll={clearAllData} />
      )}
      {selectedOp && (
        <OperatorDetailModal operator={roster.find(p => p.name === selectedOp) || { name: selectedOp }} challenges={challenges} settings={settings}
          onClose={() => setSelectedOp(null)}
          onOpenChallenge={(id) => { setSelectedOp(null); setSelectedId(id); }} />
      )}
      {meetingChallenge && (
        <MeetingUpdateModal
          challenge={meetingChallenge}
          roster={activeRoster}
          onClose={() => setMeetingChallengeId(null)}
          onSave={async (update) => {
            await saveMeetingUpdate(meetingChallenge.id, update);
            setMeetingChallengeId(null);
          }} />
      )}
    </div>
  );
}

// ============================================================
// COMPETITION PANEL
// ============================================================

function CompetitionPanel({ phase, settings, onConfigureTime, onSaveSettings }) {
  const day = COMP_DAYS[settings.competitionDay] || COMP_DAYS.jeopardy;

  if (phase.phase === 'pending') {
    return (
      <div style={{
        padding: '18px 22px', background: 'rgba(255,255,255,0.025)',
        border: '1px dashed rgba(212,168,67,0.3)', borderRadius: 4,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Clock size={28} color="#d4a843" />
          <div>
            <div style={{ fontSize: 11, letterSpacing: '0.2em', color: '#d4a843', fontWeight: 600 }}>
              ◆ COMPETITION TIMER NOT SET
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', marginTop: 2 }}>
              Set the start time in settings to begin tracking competition phase.
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <GhostBtn onClick={() => onSaveSettings({ ...settings, startTime: Date.now() })}>
            <Play size={12} fill="currentColor" /> Start Now
          </GhostBtn>
          <PrimaryBtn onClick={onConfigureTime}><Clock size={13} /> Configure</PrimaryBtn>
        </div>
      </div>
    );
  }

  if (phase.phase === 'scheduled') {
    return (
      <div style={{
        padding: '16px 22px', background: 'rgba(212,168,67,0.06)',
        border: '1px solid rgba(212,168,67,0.3)', borderRadius: 4,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ color: day.color, fontSize: 22, fontWeight: 700 }}>{day.icon}</div>
            <div>
              <div style={{ fontSize: 11, letterSpacing: '0.2em', color: day.color, fontWeight: 600 }}>
                {day.label} DAY · SCHEDULED
              </div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)' }}>
                Starts {new Date(settings.startTime).toLocaleString()}
              </div>
            </div>
          </div>
          <div style={{
            fontFamily: '"JetBrains Mono", monospace', fontSize: 22, fontWeight: 700, color: '#d4a843',
          }}>
            T-{fmtCountdown(phase.startsIn)}
          </div>
        </div>
      </div>
    );
  }

  if (phase.phase === 'ended') {
    return (
      <div style={{
        padding: '16px 22px', background: 'rgba(255,255,255,0.025)',
        border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Square size={22} color="#94a3b8" fill="#94a3b8" />
          <div>
            <div style={{ fontSize: 11, letterSpacing: '0.2em', color: '#94a3b8', fontWeight: 600 }}>
              {day.label} DAY · CONCLUDED
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
              Total competition time: {fmtCountdown(phase.totalMs)}
            </div>
          </div>
        </div>
        <GhostBtn onClick={() => onSaveSettings({ ...settings, startTime: null, subsUsed: 0 })}>
          <TimerReset size={12} /> Reset for Next Day
        </GhostBtn>
      </div>
    );
  }

  // Active phase: 'in-progress', 'locked', or 'open'
  const useLockedPhase = settings.useLockedPhase ?? false;
  const isLocked = phase.phase === 'locked';
  const isInProgress = phase.phase === 'in-progress';

  let phaseColor, phaseIcon, phaseLabel, phaseDesc, showLockUrgent, showLockWarn;

  if (!useLockedPhase || isInProgress) {
    phaseColor = '#d4a843';
    phaseIcon = <Activity size={20} />;
    phaseLabel = 'IN PROGRESS';
    phaseDesc = `${fmtCountdown(phase.phaseRemaining)} remaining`;
    showLockUrgent = false;
    showLockWarn = false;
  } else if (isLocked) {
    phaseColor = '#d4a843';
    phaseIcon = <ShieldAlert size={20} />;
    phaseLabel = (settings.lockedPhaseLabel || 'Phase 1').toUpperCase();
    phaseDesc = 'Score-lock zone · lock triggers at phase end';
    showLockUrgent = phase.phaseRemaining <= LOCK_URGENT_MS;
    showLockWarn = phase.phaseRemaining <= LOCK_WARN_MS && !showLockUrgent;
  } else {
    phaseColor = '#ef4444';
    phaseIcon = <Cpu size={20} />;
    phaseLabel = (settings.openPhaseLabel || 'Phase 2').toUpperCase();
    phaseDesc = 'Open phase · scores decaying';
    showLockUrgent = false;
    showLockWarn = false;
  }

  const lockedPct = useLockedPhase && !isInProgress ? (phase.lockedMs / phase.totalMs) * 100 : 100;
  const elapsedPct = Math.min(100, (phase.elapsed / phase.totalMs) * 100);

  return (
    <div style={{
      padding: '14px 18px', borderRadius: 4,
      background: `linear-gradient(135deg, ${phaseColor}12 0%, transparent 60%), rgba(255,255,255,0.025)`,
      border: `1px solid ${phaseColor}55`,
      boxShadow: showLockUrgent ? `0 0 28px ${phaseColor}40` : 'none',
      animation: showLockUrgent ? 'pulseRed 2s infinite' : 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ color: day.color, fontSize: 18, fontWeight: 700 }}>{day.icon}</div>
          <div>
            <div style={{ fontSize: 10, letterSpacing: '0.25em', color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>
              {day.label} DAY
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
              <span style={{ color: phaseColor }}>{phaseIcon}</span>
              <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '0.06em', color: phaseColor }}>
                {phaseLabel}
              </span>
              {showLockUrgent && (
                <span style={{
                  fontSize: 9, padding: '2px 8px', background: '#ef4444', color: '#fff',
                  letterSpacing: '0.15em', borderRadius: 2, fontWeight: 700,
                  animation: 'flashUrgent 1s infinite',
                }}>LOCK-IN URGENT</span>
              )}
              {showLockWarn && (
                <span style={{
                  fontSize: 9, padding: '2px 8px', background: 'rgba(245,158,11,0.2)', color: '#f59e0b',
                  border: '1px solid #f59e0b', letterSpacing: '0.15em', borderRadius: 2, fontWeight: 700,
                }}>LOCK-IN WINDOW</span>
              )}
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>{phaseDesc}</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.5)' }}>
              {isLocked ? 'SCORE LOCK IN' : 'COMPETITION ENDS'}
            </div>
            <div style={{
              fontFamily: '"JetBrains Mono", monospace', fontSize: 24, fontWeight: 700,
              color: showLockUrgent ? '#ef4444' : phaseColor, lineHeight: 1,
            }}>{fmtCountdown(phase.phaseRemaining)}</div>
          </div>
          <div style={{ textAlign: 'right', borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: 20 }}>
            <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.5)' }}>ELAPSED</div>
            <div style={{
              fontFamily: '"JetBrains Mono", monospace', fontSize: 16, color: '#fff', lineHeight: 1, marginTop: 2,
            }}>{fmtCountdown(phase.elapsed)} / {fmtCountdown(phase.totalMs)}</div>
          </div>
        </div>
      </div>

      <div style={{ position: 'relative', height: 10, background: 'rgba(0,0,0,0.4)', borderRadius: 2, overflow: 'hidden', marginBottom: 4 }}>
        {useLockedPhase && !isInProgress && (
          <>
            <div style={{
              position: 'absolute', left: 0, top: 0, bottom: 0, width: `${lockedPct}%`,
              background: 'rgba(212, 168, 67, 0.15)',
              borderRight: '1px solid rgba(255,255,255,0.3)',
            }} />
            <div style={{
              position: 'absolute', left: `${lockedPct}%`, top: 0, bottom: 0, right: 0,
              background: 'rgba(239, 68, 68, 0.15)',
            }} />
          </>
        )}
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0, width: `${elapsedPct}%`,
          background: useLockedPhase && !isInProgress
            ? `linear-gradient(90deg, #d4a843 0%, #d4a843 ${lockedPct/Math.max(elapsedPct,0.01)*100}%, #ef4444 100%)`
            : '#d4a843',
          opacity: 0.85,
        }} />
        <div style={{
          position: 'absolute', left: `${elapsedPct}%`, top: -2, bottom: -2, width: 2,
          background: '#fff', boxShadow: '0 0 8px #fff',
        }} />
      </div>
      {useLockedPhase && !isInProgress && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', fontSize: 9, letterSpacing: '0.15em',
          color: 'rgba(255,255,255,0.4)', fontFamily: '"JetBrains Mono", monospace',
        }}>
          <span>{(settings.lockedPhaseLabel || 'Phase 1').toUpperCase()} · {settings.lockedPhaseHours ?? DEFAULT_HR_HOURS}H</span>
          <span style={{ color: phaseColor }}>▲ NOW</span>
          <span>{(settings.openPhaseLabel || 'Phase 2').toUpperCase()} · {Math.max(0, (settings.durationHours ?? DEFAULT_DURATION_HOURS) - (settings.lockedPhaseHours ?? DEFAULT_HR_HOURS))}H</span>
        </div>
      )}
    </div>
  );
}

// ============================================================
// HEADER WIDGETS
// ============================================================

function SubCounter({ remaining }) {
  const color = remaining === 0 ? '#ef4444' : remaining === 1 ? '#f59e0b' : '#d4a843';
  return (
    <div title="ICC rule: 2 substitutions allowed per competition day" style={{
      display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px',
      background: `${color}15`, border: `1px solid ${color}40`,
      borderRadius: 3, fontSize: 11, letterSpacing: '0.12em', color,
    }}>
      <ArrowLeftRight size={12} />
      SUBS: {remaining}/{MAX_SUBS_PER_DAY}
    </div>
  );
}

function TabBtn({ active, onClick, icon, label, count, badge }) {
  return (
    <button onClick={onClick} style={{
      background: 'transparent', border: 'none', cursor: 'pointer',
      padding: '12px 18px', display: 'inline-flex', alignItems: 'center', gap: 8,
      color: active ? '#d4a843' : 'rgba(255,255,255,0.55)',
      fontFamily: '"Chakra Petch", sans-serif', fontWeight: 600,
      letterSpacing: '0.15em', fontSize: 12, position: 'relative',
      borderBottom: `2px solid ${active ? '#d4a843' : 'transparent'}`,
      marginBottom: -1, transition: 'color 120ms',
    }}>
      {icon} {label}
      <span style={{
        fontFamily: '"JetBrains Mono", monospace', fontSize: 11,
        color: active ? '#d4a843' : 'rgba(255,255,255,0.4)',
        background: 'rgba(255,255,255,0.05)', padding: '1px 6px', borderRadius: 2,
      }}>{count}</span>
      {badge && (
        <span style={{
          fontSize: 9, padding: '2px 6px', background: 'rgba(245,158,11,0.15)',
          color: '#f59e0b', border: '1px solid rgba(245,158,11,0.4)', borderRadius: 2,
          letterSpacing: '0.1em',
        }}>{badge}</span>
      )}
    </button>
  );
}

function StatCard({ label, value, icon, accent = '#d4a843', sub }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.08)',
      borderLeft: `3px solid ${accent}`, borderRadius: 3,
      padding: '10px 12px', position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, letterSpacing: '0.18em', color: 'rgba(255,255,255,0.55)', marginBottom: 4 }}>
        <span style={{ color: accent }}>{icon}</span>{label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', lineHeight: 1.1 }}>
        {value}
        {sub && <span style={{ marginLeft: 8, fontSize: 12, color: accent, fontWeight: 500 }}>{sub}</span>}
      </div>
    </div>
  );
}

// ============================================================
// CHALLENGE CARD
// ============================================================

function ChallengeCard({ challenge, settings, phase, iccRec, onClick, onToggleStar }) {
  const cat = CATEGORIES[challenge.category] || CATEGORIES.misc;
  const stat = STATUSES[challenge.status];
  const isSolved = challenge.status === 'solved';
  const solvedIn = solvedPhase(challenge, settings);
  const lockState = solvedLockState(challenge, settings);
  const solverName = solverDisplayName(challenge);
  const solverSource = challenge.solver?.source || '';
  const decay = pointDecayIntel(challenge);
  const showDecay = challenge.platformSource && decay.max > 0;
  const valueModel = !isSolved ? buildHrValueModel(challenge, phase) : null;
  const showValueForecast = valueModel && (isHrPriorityWindow(phase) || isAiCleanupWindow(phase));
  const forecastLabel = valueModel?.hrLockForecast == null ? 'AI FCST' : 'LOCK FCST';
  const forecastValue = valueModel?.hrLockForecast == null ? valueModel?.aiCleanupForecast : valueModel?.hrLockForecast;
  const isStale = (challenge.status === 'in-progress' || challenge.status === 'stuck') &&
                  (Date.now() - challenge.updatedAt) > STALE_THRESHOLD_MS;

  return (
    <div onClick={onClick} style={{
      background: isSolved ? 'rgba(16,185,129,0.04)' : 'rgba(255,255,255,0.025)',
      border: `1px solid ${isSolved ? 'rgba(16,185,129,0.25)' : isStale ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.08)'}`,
      borderRadius: 4, padding: 14, cursor: 'pointer', position: 'relative',
      transition: 'all 150ms', overflow: 'hidden',
    }}
    onMouseEnter={e => {
      e.currentTarget.style.borderColor = isSolved ? '#10b981' : '#d4a843';
      e.currentTarget.style.transform = 'translateY(-2px)';
      e.currentTarget.style.boxShadow = `0 8px 24px ${isSolved ? 'rgba(16,185,129,0.15)' : 'rgba(212,168,67,0.12)'}`;
    }}
    onMouseLeave={e => {
      e.currentTarget.style.borderColor = isSolved ? 'rgba(16,185,129,0.25)' : isStale ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.08)';
      e.currentTarget.style.transform = 'translateY(0)';
      e.currentTarget.style.boxShadow = 'none';
    }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        background: `linear-gradient(90deg, ${cat.color}, ${cat.color}33 80%, transparent)`,
      }} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Badge color={cat.color}>{cat.label}</Badge>
          <DifficultyDots level={challenge.difficulty} />
          {challenge.points > 0 && (
            <span style={{
              fontSize: 10, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.1em',
              fontFamily: '"JetBrains Mono", monospace',
            }}>
              {challenge.points} PT
            </span>
          )}
          {lockState === 'pending' && (
            <span title="Solved during HR; value locks when Human Resistance ends" style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              fontSize: 9, padding: '2px 6px', background: 'rgba(245,158,11,0.12)',
              border: '1px solid rgba(245,158,11,0.4)', color: '#f59e0b',
              borderRadius: 2, letterSpacing: '0.1em', fontWeight: 600,
            }}>
              <Clock size={9} /> LOCK PENDING
            </span>
          )}
          {lockState === 'locked' && (
            <span title="Score locked at end of Human Resistance" style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              fontSize: 9, padding: '2px 6px', background: 'rgba(16,185,129,0.12)',
              border: '1px solid rgba(16,185,129,0.4)', color: '#10b981',
              borderRadius: 2, letterSpacing: '0.1em', fontWeight: 600,
            }}>
              <Lock size={9} /> LOCKED
            </span>
          )}
          {solvedIn === 'open' && (
            <span title="Solved during open phase" style={{
              fontSize: 9, padding: '2px 6px', background: 'rgba(239,68,68,0.12)',
              border: '1px solid rgba(239,68,68,0.4)', color: '#ef4444',
              borderRadius: 2, letterSpacing: '0.1em', fontWeight: 600,
            }}>
              <Cpu size={9} style={{ verticalAlign: -1, marginRight: 2 }} />OPEN
            </span>
          )}
          {iccRec && ICC_RECOMMENDATIONS[iccRec.key] && (
            <Badge color={ICC_RECOMMENDATIONS[iccRec.key].color} title={iccRec.reasons?.join(' · ')}>
              {ICC_RECOMMENDATIONS[iccRec.key].label}
            </Badge>
          )}
        </div>
        <button onClick={(e) => { e.stopPropagation(); onToggleStar(); }} style={{
          background: 'transparent', border: 'none', cursor: 'pointer', padding: 2,
          color: challenge.starred ? '#d4a843' : 'rgba(255,255,255,0.25)',
        }}>
          <Star size={15} fill={challenge.starred ? '#d4a843' : 'none'} />
        </button>
      </div>

      <div style={{
        fontSize: 16, fontWeight: 600, color: '#fff', letterSpacing: '0.01em',
        marginBottom: 8, textDecoration: isSolved ? 'line-through' : 'none',
        textDecorationColor: 'rgba(16,185,129,0.4)',
      }}>
        {challenge.title || <span style={{ color: 'rgba(255,255,255,0.3)' }}>Untitled</span>}
      </div>

      {challenge.tags.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
          {challenge.tags.slice(0, 4).map(t => (
            <span key={t} style={{
              fontSize: 10, padding: '2px 6px', background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.08)', borderRadius: 2,
              color: 'rgba(255,255,255,0.6)', fontFamily: '"JetBrains Mono", monospace',
            }}>#{t}</span>
          ))}
          {challenge.tags.length > 4 && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>+{challenge.tags.length - 4}</span>}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, minHeight: 22 }}>
        <Users size={12} color="rgba(255,255,255,0.4)" />
        {challenge.assignees.length === 0 ? (
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.08em' }}>UNASSIGNED</span>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              {challenge.assignees.map((a, i) => (
                <Avatar key={a} name={a} index={i} />
              ))}
            </div>
            {challenge.assignees.length > 1 && (
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em' }}>
                · {challenge.assignees.length} OPS
              </span>
            )}
          </>
        )}
      </div>

      {(isSolved || solverName) && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10,
          color: solverName ? '#10b981' : 'rgba(255,255,255,0.45)', fontSize: 11,
          letterSpacing: '0.08em', minHeight: 20,
        }}>
          <Award size={12} />
          {solverName ? (
            <span>SOLVER <b style={{ color: '#fff' }}>{solverName}</b>{solverSource === 'icc' ? ' · ICC' : ' · COACH'}</span>
          ) : (
            <span>SOLVER PENDING ICC SYNC</span>
          )}
        </div>
      )}

      {showDecay && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10,
          color: 'rgba(255,255,255,0.55)', fontSize: 11, letterSpacing: '0.06em',
          fontFamily: '"JetBrains Mono", monospace',
        }}>
          <Activity size={12} color="#06b6d4" />
          <span>
            {decay.solveCount} solves · {decay.current}/{decay.max}pt
            {decay.lost > 0 ? ` · -${decay.lost}` : ''}
          </span>
        </div>
      )}

      {showValueForecast && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10,
          color: 'rgba(255,255,255,0.58)', fontSize: 10, letterSpacing: '0.05em',
          fontFamily: '"JetBrains Mono", monospace',
        }}>
          <Target size={12} color="#d4a843" />
          <span>
            TRUE {valueModel.trueCurrentPoints} · USA {valueModel.usaNextForecast} · {forecastLabel} {forecastValue}
          </span>
        </div>
      )}

      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        paddingTop: 10, borderTop: '1px dashed rgba(255,255,255,0.08)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%', background: stat.color,
            boxShadow: challenge.status === 'in-progress' ? `0 0 8px ${stat.color}` : 'none',
          }} />
          <span style={{ fontSize: 10, color: stat.color, letterSpacing: '0.15em', fontWeight: 600 }}>
            {stat.label}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {isStale && <AlertTriangle size={11} color="#ef4444" />}
          <span style={{
            fontSize: 10, color: isStale ? '#ef4444' : 'rgba(255,255,255,0.5)',
            fontFamily: '"JetBrains Mono", monospace',
          }}>
            {fmtRelative(challenge.updatedAt)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// MEETINGS / INSIGHTS VIEW
// ============================================================

function IccLivePanel({ iccSync, liveSnapshot, onSyncNow }) {
  const { configured, status, error, lastSyncAt, alerts } = iccSync;
  if (!configured) return null;

  const board = liveSnapshot?.scoreboard;
  const statusColor = status === 'error' ? '#ef4444' : status === 'loading' ? '#f59e0b' : '#10b981';

  return (
    <div style={{
      padding: 14, marginBottom: 16,
      background: 'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(212,168,67,0.05))',
      border: '1px solid rgba(16,185,129,0.28)', borderRadius: 4,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <div>
          <SectionLabel icon={<Activity size={11} />}>ICC LIVE · TEAM USA</SectionLabel>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.72)', lineHeight: 1.5 }}>
            Auto-sync every 15s via server proxy.
            {board?.ourRank != null && (
              <> Rank <b style={{ color: '#d4a843' }}>#{board.ourRank}</b> · {Number(board.ourScore ?? 0).toLocaleString()} pts</>
            )}
            {board?.gapAbove > 0 && <> · {board.gapAbove} to next</>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%', background: statusColor,
            boxShadow: status === 'ok' ? `0 0 8px ${statusColor}` : 'none',
          }} />
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>
            {status === 'loading' ? 'Syncing…' : lastSyncAt ? fmtRelative(lastSyncAt) : 'pending'}
          </span>
          <GhostBtn onClick={onSyncNow} disabled={status === 'loading'}>
            <RefreshCw size={12} /> Sync now
          </GhostBtn>
        </div>
      </div>
      {error && (
        <div style={{ fontSize: 11, color: '#ef4444', marginBottom: 8 }}>{error}</div>
      )}
      {alerts.length > 0 && (
        <div style={{ display: 'grid', gap: 6 }}>
          {alerts.map(a => (
            <div key={a.message} style={{
              fontSize: 11, padding: '6px 10px', borderRadius: 3, lineHeight: 1.45,
              background: a.severity === 'warn' ? 'rgba(245,158,11,0.1)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${a.severity === 'warn' ? 'rgba(245,158,11,0.35)' : 'rgba(255,255,255,0.1)'}`,
              color: a.severity === 'warn' ? '#fbbf24' : 'rgba(255,255,255,0.72)',
            }}>
              {a.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MeetingsView({
  challenges, roster, settings, phase, lanes, snapshots, meetings,
  iccSync, iccRecommendations, onIccSyncNow,
  onImportSnapshot, onQuickUpdate, onOpenChallenge, onUpdateMeeting, onConfigureRoster,
}) {
  const [source, setSource] = useState('metactf');
  const [paste, setPaste] = useState('');
  const [importMessage, setImportMessage] = useState('');
  const [showSolved, setShowSolved] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const [manualCategory, setManualCategory] = useState('web');
  const [manualPoints, setManualPoints] = useState('');
  const [manualSolves, setManualSolves] = useState('');
  const latestSnapshot = snapshots.find(s => s.source === 'icc') || snapshots[0];
  const parsedPreview = useMemo(() => parsePlatformImport(paste, source), [paste, source]);
  const actionableCount = Object.entries(lanes).filter(([k]) => k !== 'solved').reduce((n, [, lane]) => n + lane.items.length, 0);
  const winCount = lanes.win.items.length;
  const lockCount = lanes.lock.items.length;
  const resourceCount = lanes.resource.items.length;
  const askCount = lanes.ask.items.length;
  const cleanupCount = lanes.drop.items.length;

  const handleImport = async () => {
    const parsed = parsePlatformImport(paste, source);
    if (parsed.errors.length || parsed.challenges.length === 0) {
      setImportMessage(parsed.errors[0] || 'No challenges found in import.');
      return;
    }
    const snapshot = buildPlatformSnapshot({ source, challenges: parsed.challenges, scoreboard: parsed.scoreboard });
    await onImportSnapshot(snapshot);
    setPaste('');
    setImportMessage(`Imported ${snapshot.challengeCount} platform challenge${snapshot.challengeCount === 1 ? '' : 's'}.`);
  };

  const handleManualRow = async () => {
    const title = manualTitle.trim();
    if (!title) return;
    const challenge = normalizePlatformChallenge({
      id: title.toLowerCase().replace(/\s+/g, '-'),
      title,
      category: manualCategory,
      points: Number(manualPoints) || 0,
      solves: Number(manualSolves) || 0,
      solved: false,
    }, 'manual');
    const snapshot = buildPlatformSnapshot({ source: 'manual', challenges: [challenge] });
    await onImportSnapshot(snapshot);
    setManualTitle('');
    setManualPoints('');
    setManualSolves('');
    setImportMessage(`Added manual row: ${title}.`);
  };

  const boardOrder = phase.phase === 'open'
    ? ['drop', 'continue', 'ask', 'resource', 'win', 'lock']
    : ['win', 'lock', 'ask', 'resource', 'continue', 'drop'];

  return (
    <div>
      <IccLivePanel iccSync={iccSync} liveSnapshot={latestSnapshot} onSyncNow={onIccSyncNow} />
      <div style={{
        padding: 16, background: 'linear-gradient(135deg, rgba(212,168,67,0.08), rgba(255,255,255,0.02))',
        border: '1px solid rgba(212,168,67,0.24)', borderRadius: 4, marginBottom: 16,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
          <div>
            <SectionLabel icon={<Target size={11} />}>PRIORITY BOARD</SectionLabel>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', letterSpacing: '0.04em' }}>
              What should coaches lock before HR ends, park for AI, or clean up now?
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.62)', lineHeight: 1.5, marginTop: 4 }}>
              Board order separates ICC true points from forecasts: USA next solve, HR lock value, AI cleanup decay, public solves, and captain confidence.
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', textAlign: 'right', lineHeight: 1.5 }}>
            {latestSnapshot
              ? <>Latest platform snapshot<br /><b style={{ color: '#d4a843' }}>{latestSnapshot.source}</b> · {fmtRelative(latestSnapshot.importedAt)}</>
              : <>No platform snapshot yet<br /><b style={{ color: '#d4a843' }}>manual mode</b></>}
          </div>
        </div>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10,
        }}>
          <StatCard label="ACTIONABLE" value={actionableCount} icon={<Target size={14} />} accent="#d4a843"
            sub={latestSnapshot ? `${fmtRelative(latestSnapshot.importedAt)}` : 'manual'} />
          <StatCard label="LOCK 500S" value={winCount} icon={<Award size={14} />} accent="#d4a843"
            sub={latestSnapshot?.scoreboard?.gapAbove ? `${latestSnapshot.scoreboard.gapAbove}pt gap` : 'low-solve HR'} />
          <StatCard label="HR TARGETS" value={lockCount} icon={<Lock size={14} />} accent="#f59e0b"
            sub={phase.phase === 'locked' ? fmtCountdown(phase.phaseRemaining) : 'phase inactive'} />
          <StatCard label="RESOURCE CALLS" value={resourceCount} icon={<Users size={14} />} accent="#06b6d4"
            sub={`${roster.length} active ops`} />
          <StatCard label="CAPTAIN CHECK" value={askCount} icon={<Radio size={14} />} accent="#06b6d4"
            sub="missing confidence" />
          <StatCard label={phase.phase === 'open' ? 'AI CLEANUP' : 'PARK FOR AI'} value={cleanupCount} icon={<Clock size={14} />} accent={phase.phase === 'open' ? '#a855f7' : '#ef4444'}
            sub={phase.phase === 'open' ? 'easy + solved first' : '4+ solves'} />
        </div>
      </div>

      {challenges.length === 0 ? (
        <MeetingsSetupState
          manualTitle={manualTitle}
          setManualTitle={setManualTitle}
          manualCategory={manualCategory}
          setManualCategory={setManualCategory}
          manualPoints={manualPoints}
          setManualPoints={setManualPoints}
          manualSolves={manualSolves}
          setManualSolves={setManualSolves}
          onManualRow={handleManualRow}
          onConfigureRoster={onConfigureRoster}
          settings={settings}
          roster={roster} />
      ) : (
        <>
          {boardOrder.map(key => (
            <InsightLane key={key} lane={lanes[key]} onQuickUpdate={onQuickUpdate} onOpenChallenge={onOpenChallenge} onUpdateMeeting={onUpdateMeeting} />
          ))}

          {lanes.solved.items.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <GhostBtn onClick={() => setShowSolved(s => !s)}>
                {showSolved ? 'Hide' : 'Show'} solved / verified · {lanes.solved.items.length}
              </GhostBtn>
              {showSolved && <InsightLane lane={lanes.solved} onQuickUpdate={onQuickUpdate} onOpenChallenge={onOpenChallenge} onUpdateMeeting={onUpdateMeeting} compact />}
            </div>
          )}
        </>
      )}

      <div style={{
        marginTop: 20, display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) minmax(320px, 1fr)', gap: 14,
      }}>
        <div style={{
          background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 4, padding: 16,
        }}>
          <SectionLabel icon={<FileJson size={11} />}>PLATFORM SNAPSHOT IMPORT</SectionLabel>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5, marginBottom: 12 }}>
            Paste MetaCTF or other platform JSON/CSV. When Swagger/API details are available, the same normalized snapshot shape can be written by `/api/platform/metactf/snapshot`.
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <Select value={source} onChange={e => setSource(e.target.value)}
              options={[
                { value: 'metactf', label: 'MetaCTF' },
                { value: 'ctfd', label: 'CTFd' },
                { value: 'manual', label: 'Manual / other' },
              ]}
              style={{ minWidth: 150 }} />
            <GhostBtn onClick={handleImport} disabled={!paste.trim()}>
              <Download size={12} /> Import
            </GhostBtn>
          </div>
          <textarea value={paste} onChange={e => setPaste(e.target.value)}
            placeholder={'JSON array/object or CSV with columns like title,category,points,solves,solved. Optional scoreboard: gapAbove,gapBelow,ourRank,ourScore.'}
            rows={7}
            style={{
              background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.12)',
              color: '#fff', padding: '10px 12px', borderRadius: 3, width: '100%',
              fontFamily: '"JetBrains Mono", monospace', fontSize: 12, outline: 'none', lineHeight: 1.5,
            }} />
          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: parsedPreview.errors.length ? '#ef4444' : 'rgba(255,255,255,0.45)' }}>
              {paste.trim()
                ? parsedPreview.errors[0] || `Preview: ${parsedPreview.challenges.length} normalized challenge${parsedPreview.challenges.length === 1 ? '' : 's'}`
                : latestSnapshot
                  ? `Latest: ${latestSnapshot.challengeCount} from ${latestSnapshot.source} · ${fmtRelative(latestSnapshot.importedAt)}`
                  : 'No platform snapshots imported yet.'}
            </span>
            {importMessage && <span style={{ fontSize: 11, color: '#d4a843' }}>{importMessage}</span>}
          </div>
        </div>

        <div style={{
          background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 4, padding: 16,
        }}>
          <SectionLabel icon={<Plus size={11} />}>QUICK MANUAL ROW</SectionLabel>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5, marginBottom: 12 }}>
            Add a challenge from a captain report when the platform import is not ready.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 90px 90px auto', gap: 8 }}>
            <Input value={manualTitle} onChange={e => setManualTitle(e.target.value)} placeholder="Challenge title" />
            <Select value={manualCategory} onChange={e => setManualCategory(e.target.value)}
              options={Object.entries(CATEGORIES).map(([k, v]) => ({ value: k, label: v.label }))} />
            <Input type="number" value={manualPoints} onChange={e => setManualPoints(e.target.value)} placeholder="pts" />
            <Input type="number" value={manualSolves} onChange={e => setManualSolves(e.target.value)} placeholder="solves" />
            <PrimaryBtn onClick={handleManualRow} disabled={!manualTitle.trim()}><Plus size={12} /> Add</PrimaryBtn>
          </div>
        </div>
      </div>

      {meetings.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <SectionLabel icon={<Clock size={11} />}>RECENT MEETING UPDATES</SectionLabel>
          <div style={{ display: 'grid', gap: 6 }}>
            {meetings.slice(0, 5).map(m => {
              const ch = challenges.find(c => c.id === m.challengeId);
              return (
                <button key={m.id} onClick={() => ch && onOpenChallenge(ch.id)} style={{
                  textAlign: 'left', background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.08)',
                  color: 'rgba(255,255,255,0.75)', padding: '8px 10px', borderRadius: 3, cursor: ch ? 'pointer' : 'default',
                  fontFamily: '"Chakra Petch", sans-serif', fontSize: 12,
                }}>
                  <b style={{ color: '#fff' }}>{ch?.title || 'Unknown challenge'}</b> · {fmtRelative(m.createdAt)} · {COACH_DECISIONS[m.coachDecision]?.label || m.coachDecision}
                  {m.note ? <span style={{ color: 'rgba(255,255,255,0.5)' }}> · {m.note}</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function MeetingsSetupState({ manualTitle, setManualTitle, manualCategory, setManualCategory, manualPoints, setManualPoints, manualSolves, setManualSolves, onManualRow, onConfigureRoster, settings, roster }) {
  const checklist = [
    { done: false, label: 'Import platform data or add quick challenge rows.' },
    { done: roster.length > 0, label: 'Add operator strengths, experience, and fatigue in roster.' },
    { done: Boolean(settings.startTime), label: 'Set competition start and phase timing.' },
    { done: false, label: 'Record captain confidence for the top challenges.' },
  ];
  return (
    <div style={{
      padding: 18, border: '1px dashed rgba(212,168,67,0.25)', borderRadius: 4,
      background: 'rgba(212,168,67,0.035)', marginBottom: 18,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <Radio size={28} color="#d4a843" />
        <div>
          <div style={{ fontSize: 15, letterSpacing: '0.18em', color: '#d4a843', fontWeight: 700 }}>
            SET UP THE PRIORITY BOARD
          </div>
          <div style={{ color: 'rgba(255,255,255,0.62)', fontSize: 13, marginTop: 3 }}>
            Add any challenge data now; the board will start ranking as soon as it has points and solve signals.
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 14 }}>
        <div style={{ display: 'grid', gap: 7 }}>
          {checklist.map(item => (
            <div key={item.label} style={{
              display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
              color: item.done ? '#10b981' : 'rgba(255,255,255,0.64)',
            }}>
              <span style={{
                width: 14, height: 14, borderRadius: 2, border: `1px solid ${item.done ? '#10b981' : 'rgba(255,255,255,0.25)'}`,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10,
              }}>{item.done ? '✓' : ''}</span>
              {item.label}
            </div>
          ))}
          {roster.length === 0 && (
            <GhostBtn onClick={onConfigureRoster} style={{ marginTop: 8, width: 'fit-content' }}>
              <Users size={12} /> Add operator skills
            </GhostBtn>
          )}
        </div>
        <div>
          <SectionLabel icon={<Plus size={11} />}>FAST START ROW</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 86px 86px auto', gap: 8 }}>
            <Input value={manualTitle} onChange={e => setManualTitle(e.target.value)} placeholder="Challenge title" />
            <Select value={manualCategory} onChange={e => setManualCategory(e.target.value)}
              options={Object.entries(CATEGORIES).map(([k, v]) => ({ value: k, label: v.label }))} />
            <Input type="number" value={manualPoints} onChange={e => setManualPoints(e.target.value)} placeholder="pts" />
            <Input type="number" value={manualSolves} onChange={e => setManualSolves(e.target.value)} placeholder="solves" />
            <PrimaryBtn onClick={onManualRow} disabled={!manualTitle.trim()}><Plus size={12} /> Add</PrimaryBtn>
          </div>
        </div>
      </div>
    </div>
  );
}

function InsightLane({ lane, onQuickUpdate, onOpenChallenge, onUpdateMeeting, compact = false }) {
  if (!lane.items.length) return null;
  return (
    <div style={{ marginBottom: compact ? 10 : 18 }}>
      <SectionLabel icon={<ChevronRight size={11} />}>{lane.label} · {lane.items.length}</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : 'repeat(auto-fill, minmax(360px, 1fr))', gap: 10 }}>
        {lane.items.map(insight => (
          <InsightCard key={insight.challenge.id} insight={insight} color={lane.color}
            onQuickUpdate={onQuickUpdate} onOpenChallenge={onOpenChallenge} onUpdateMeeting={onUpdateMeeting} />
        ))}
      </div>
    </div>
  );
}

function InsightCard({ insight, color, onQuickUpdate, onOpenChallenge, onUpdateMeeting }) {
  const c = insight.challenge;
  const cat = CATEGORIES[c.category] || CATEGORIES.misc;
  const decision = COACH_DECISIONS[c.coachDecision] || COACH_DECISIONS.watch;
  const need = RESOURCE_NEEDS[c.resourceNeed] || RESOURCE_NEEDS.none;
  const confidence = CAPTAIN_CONFIDENCE[c.captainConfidence] || CAPTAIN_CONFIDENCE.unknown;
  const phaseConfidence = PHASE_SOLVE_CONFIDENCE[c.phaseSolveConfidence] || PHASE_SOLVE_CONFIDENCE.unknown;
  const valueModel = insight.hrValue;
  const trueLabel = c.platformSource === 'icc' ? 'ICC TRUE' : 'TRUE';
  const forecastLabel = valueModel?.hrLockForecast == null ? 'AI FCST' : 'LOCK FCST';
  const forecastValue = valueModel?.hrLockForecast == null ? valueModel?.aiCleanupForecast : valueModel?.hrLockForecast;
  return (
    <div style={{
      background: 'rgba(255,255,255,0.025)', border: `1px solid ${color}45`,
      borderLeft: `3px solid ${color}`, borderRadius: 4, padding: 13,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 5 }}>
            <Badge color={cat.color}>{cat.label}</Badge>
            <Badge color={decision.color}>{decision.label}</Badge>
            <Badge color={confidence.color}>{confidence.label}</Badge>
            <Badge color={phaseConfidence.color}>{phaseConfidence.label}</Badge>
            {c.resourceNeed !== 'none' && <Badge color={need.color}>{need.label}</Badge>}
            {insight.iccRec && ICC_RECOMMENDATIONS[insight.iccRec.key] && (
              <Badge color={ICC_RECOMMENDATIONS[insight.iccRec.key].color} title={insight.iccRec.reasons?.join(' · ')}>
                {ICC_RECOMMENDATIONS[insight.iccRec.key].label}
              </Badge>
            )}
          </div>
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>{c.title || 'Untitled'}</div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontFamily: '"JetBrains Mono", monospace', color, fontWeight: 700, fontSize: 18 }}>{insight.score}</div>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.45)', letterSpacing: '0.12em' }}>PRIORITY</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6, marginBottom: 10 }}>
        <Stat label={trueLabel} value={insight.currentPoints || '-'} accent="#d4a843" />
        <Stat label="USA NEXT" value={valueModel?.usaNextForecast || '-'} accent="#10b981" />
        <Stat label={forecastLabel} value={forecastValue || '-'} accent={valueModel?.hrLockForecast == null ? '#a855f7' : '#f59e0b'} />
        <Stat label="SOLVES" value={valueModel?.publicSolves ?? c.platformSolveCount ?? '-'} accent="#06b6d4" />
        <Stat label="GAIN" value={valueModel?.lockGain || '-'} accent="#d4a843" />
        <Stat label="TIME" value={insight.timeSpent ? `${insight.timeSpent}m` : '-'} accent="#f59e0b" />
      </div>

      {insight.reasons.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
          {insight.reasons.slice(0, 5).map(reason => (
            <span key={reason} style={{
              fontSize: 10, padding: '2px 6px', background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.62)', borderRadius: 2,
            }}>{reason}</span>
          ))}
        </div>
      )}

      <div style={{
        padding: '8px 10px', background: 'rgba(0,0,0,0.22)', border: '1px dashed rgba(255,255,255,0.1)',
        borderRadius: 3, fontSize: 11, color: 'rgba(255,255,255,0.65)', lineHeight: 1.45, marginBottom: 10,
      }}>
        <b style={{ color }}>Captain question:</b> {insight.questionPrompts[0]}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
        <Select value={c.captainConfidence || 'unknown'}
          onChange={e => onQuickUpdate(c.id, { captainConfidence: e.target.value, lastMeetingAt: Date.now() })}
          options={Object.entries(CAPTAIN_CONFIDENCE).map(([k, v]) => ({ value: k, label: v.label }))}
          style={{ width: '100%', fontSize: 11 }} />
        <Select value={c.phaseSolveConfidence || 'unknown'}
          onChange={e => onQuickUpdate(c.id, { phaseSolveConfidence: e.target.value, lastMeetingAt: Date.now() })}
          options={Object.entries(PHASE_SOLVE_CONFIDENCE).map(([k, v]) => ({ value: k, label: v.label }))}
          style={{ width: '100%', fontSize: 11 }} />
        <Select value={c.coachDecision || 'watch'}
          onChange={e => onQuickUpdate(c.id, { coachDecision: e.target.value })}
          options={Object.entries(COACH_DECISIONS).map(([k, v]) => ({ value: k, label: v.label }))}
          style={{ width: '100%', fontSize: 11 }} />
        <Select value={c.resourceNeed || 'none'}
          onChange={e => onQuickUpdate(c.id, { resourceNeed: e.target.value })}
          options={Object.entries(RESOURCE_NEEDS).map(([k, v]) => ({ value: k, label: v.label }))}
          style={{ width: '100%', fontSize: 11 }} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <GhostBtn onClick={() => onOpenChallenge(c.id)}>
          <ExternalLink size={12} /> Open
        </GhostBtn>
        <PrimaryBtn onClick={() => onUpdateMeeting(c.id)}>
          <Radio size={12} /> Meeting Update
        </PrimaryBtn>
      </div>
    </div>
  );
}

function MeetingUpdateModal({ challenge, roster, onClose, onSave }) {
  const [progress, setProgress] = useState(challenge.captainProgress ?? '');
  const [timeSpent, setTimeSpent] = useState(challenge.captainTimeSpentMinutes ?? '');
  const [captainConfidence, setCaptainConfidence] = useState(challenge.captainConfidence || 'unknown');
  const [phaseSolveConfidence, setPhaseSolveConfidence] = useState(challenge.phaseSolveConfidence || 'unknown');
  const [resourceNeed, setResourceNeed] = useState(challenge.resourceNeed || 'none');
  const [coachDecision, setCoachDecision] = useState(challenge.coachDecision || 'watch');
  const [resourceAskCategory, setResourceAskCategory] = useState(challenge.resourceAskCategory || '');
  const [resourceAskName, setResourceAskName] = useState(challenge.resourceAskName || '');
  const [assignees, setAssignees] = useState(challenge.assignees || []);
  const [note, setNote] = useState('');
  const toggle = (name) => setAssignees(prev => prev.includes(name) ? prev.filter(x => x !== name) : [...prev, name]);
  const handleSave = () => onSave({
    captainProgress: progress === '' ? null : Math.max(0, Math.min(100, Number(progress) || 0)),
    captainTimeSpentMinutes: timeSpent === '' ? null : Math.max(0, Number(timeSpent) || 0),
    captainConfidence,
    phaseSolveConfidence,
    resourceNeed,
    coachDecision,
    resourceAskCategory,
    resourceAskName: resourceAskName.trim(),
    assignees,
    note: note.trim(),
  });

  return (
    <Modal onClose={onClose} width={720}>
      <div style={{ padding: '18px 22px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: '0.25em', color: '#d4a843', fontWeight: 600 }}>◆ CAPTAIN MEETING UPDATE</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 4 }}>{challenge.title || 'Untitled'}</div>
        </div>
        <IconBtn onClick={onClose}><X size={14} /></IconBtn>
      </div>
      <div style={{ padding: 22 }}>
        {roster.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <SectionLabel icon={<Users size={11} />}>REPORTED OPERATORS</SectionLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {roster.map(p => {
                const on = assignees.includes(p.name);
                const exp = EXPERIENCE_LEVELS[p.experienceLevel] || EXPERIENCE_LEVELS.solid;
                const availability = AVAILABILITY_STATUSES[p.availabilityStatus] || AVAILABILITY_STATUSES.available;
                return (
                  <button key={p.name} onClick={() => toggle(p.name)} title={`${exp.label} · ${availability.label}`} style={{
                    background: on ? 'rgba(212,168,67,0.15)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${on ? '#d4a843' : 'rgba(255,255,255,0.1)'}`,
                    color: on ? '#d4a843' : 'rgba(255,255,255,0.7)',
                    padding: '6px 10px', borderRadius: 3, cursor: 'pointer',
                    fontFamily: '"Chakra Petch", sans-serif', fontSize: 12,
                  }}>
                    {p.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 18 }}>
          <div>
            <SectionLabel icon={<Activity size={11} />}>PROGRESS CONFIDENCE (%)</SectionLabel>
            <Input type="number" min="0" max="100" value={progress} onChange={e => setProgress(e.target.value)} placeholder="0-100" />
          </div>
          <div>
            <SectionLabel icon={<Clock size={11} />}>TIME SPENT (MIN)</SectionLabel>
            <Input type="number" min="0" value={timeSpent} onChange={e => setTimeSpent(e.target.value)} placeholder="minutes" />
          </div>
          <div>
            <SectionLabel icon={<Radio size={11} />}>CAPTAIN CONFIDENCE</SectionLabel>
            <Select value={captainConfidence} onChange={e => setCaptainConfidence(e.target.value)}
              options={Object.entries(CAPTAIN_CONFIDENCE).map(([k, v]) => ({ value: k, label: v.label }))} style={{ width: '100%' }} />
          </div>
          <div>
            <SectionLabel icon={<Lock size={11} />}>SOLVE BEFORE PHASE?</SectionLabel>
            <Select value={phaseSolveConfidence} onChange={e => setPhaseSolveConfidence(e.target.value)}
              options={Object.entries(PHASE_SOLVE_CONFIDENCE).map(([k, v]) => ({ value: k, label: v.label }))} style={{ width: '100%' }} />
          </div>
          <div>
            <SectionLabel icon={<AlertTriangle size={11} />}>RESOURCE NEED</SectionLabel>
            <Select value={resourceNeed} onChange={e => setResourceNeed(e.target.value)}
              options={Object.entries(RESOURCE_NEEDS).map(([k, v]) => ({ value: k, label: v.label }))} style={{ width: '100%' }} />
          </div>
          <div>
            <SectionLabel icon={<Target size={11} />}>COACH DECISION</SectionLabel>
            <Select value={coachDecision} onChange={e => setCoachDecision(e.target.value)}
              options={Object.entries(COACH_DECISIONS).map(([k, v]) => ({ value: k, label: v.label }))} style={{ width: '100%' }} />
          </div>
          <div>
            <SectionLabel icon={<Tag size={11} />}>RESOURCE CATEGORY</SectionLabel>
            <Select value={resourceAskCategory} onChange={e => setResourceAskCategory(e.target.value)}
              options={[{ value: '', label: 'No category ask' }, ...Object.entries(CATEGORIES).map(([k, v]) => ({ value: k, label: v.label }))]} style={{ width: '100%' }} />
          </div>
          <div>
            <SectionLabel icon={<UserCheck size={11} />}>RESOURCE / OPERATOR ASK</SectionLabel>
            <Input value={resourceAskName} onChange={e => setResourceAskName(e.target.value)} placeholder="optional named resource" />
          </div>
        </div>

        <SectionLabel icon={<Terminal size={11} />}>NON-TECHNICAL MEETING NOTE</SectionLabel>
        <textarea value={note} onChange={e => setNote(e.target.value)}
          placeholder="Resource, morale, staffing, or priority notes only. Avoid technical hints/answers."
          rows={4}
          style={{
            background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.12)',
            color: '#fff', padding: '10px 12px', borderRadius: 3, width: '100%',
            fontFamily: '"JetBrains Mono", monospace', fontSize: 13, outline: 'none', lineHeight: 1.5,
            marginBottom: 18,
          }} />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <GhostBtn onClick={onClose}>Cancel</GhostBtn>
          <PrimaryBtn onClick={handleSave}><Check size={13} strokeWidth={3} /> Save Meeting Update</PrimaryBtn>
        </div>
      </div>
    </Modal>
  );
}

function Avatar({ name, index, size = 22 }) {
  const colors = ['#d4a843', '#3b82f6', '#a855f7', '#06b6d4', '#f97316', '#10b981', '#ef4444', '#ec4899', '#84cc16', '#f43f5e'];
  const c = colors[(name.charCodeAt(0) || 0) % colors.length];
  const initials = name.split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div title={name} style={{
      width: size, height: size, borderRadius: '50%',
      background: `${c}26`, border: `1px solid ${c}`,
      color: c, fontSize: Math.round(size * 0.4), fontWeight: 700,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      marginLeft: index === 0 ? 0 : -6,
    }}>
      {initials || '?'}
    </div>
  );
}

// ============================================================
// OPERATORS VIEW
// ============================================================

function OperatorsView({ roster, allRoster, challenges, onSelectChallenge, onSelectOperator, onAddOperator }) {
  const rosterWithSolverIntel = useMemo(() => {
    const combined = [...roster];
    const seen = new Set();
    roster.forEach((p) => {
      [p.name, p.iccUsername, p.iccUserId].filter(Boolean).forEach(v => seen.add(String(v).trim().toLowerCase()));
    });
    challenges.forEach((c) => {
      if (c.status !== 'solved') return;
      const solver = normalizeSolverRecord(c.solver);
      if (!solver) return;
      if (roster.some(p => operatorMatchesSolver(c, p))) return;
      const key = solver.userId != null ? `id:${solver.userId}` : `name:${String(solver.username || '').toLowerCase()}`;
      if (seen.has(key)) return;
      const name = solver.username || (solver.userId != null ? `user ${solver.userId}` : '');
      if (!name) return;
      seen.add(key);
      seen.add(String(name).toLowerCase());
      combined.push({
        name,
        iccUsername: solver.username || '',
        iccUserId: solver.userId ?? '',
        status: 'active',
        source: 'icc-solver',
        subbedOutAt: null,
        strengths: [],
        experienceLevel: 'solid',
        availabilityStatus: 'available',
        fatigueNote: 'ICC solver not mapped to roster',
      });
    });
    return combined;
  }, [roster, challenges]);

  const ops = useMemo(() => {
    return rosterWithSolverIntel.map(p => {
      const assigned = challenges.filter(c => c.assignees.includes(p.name));
      const engaged = assigned.filter(c => c.status === 'in-progress' || c.status === 'stuck');
      const solved = challenges.filter(c => c.status === 'solved' && operatorMatchesSolver(c, p));
      const catCount = {};
      assigned.forEach(c => { catCount[c.category] = (catCount[c.category] || 0) + 1; });
      return { player: p, assigned, engaged, solved, catCount };
    });
  }, [rosterWithSolverIntel, challenges]);

  const subbedOut = allRoster.filter(p => p.status === 'subbed-out');

  if (rosterWithSolverIntel.length === 0) {
    return (
      <div style={{
        padding: '60px 20px', textAlign: 'center',
        border: '1px dashed rgba(255,255,255,0.1)', borderRadius: 4,
      }}>
        <Users size={40} color="#d4a843" style={{ marginBottom: 14 }} />
        <div style={{ fontSize: 14, letterSpacing: '0.2em', color: '#d4a843', fontWeight: 600, marginBottom: 6 }}>
          NO OPERATORS ON ROSTER
        </div>
        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginBottom: 20 }}>
          Add team members to track their workload.
        </div>
        <PrimaryBtn onClick={onAddOperator}>
          <Plus size={14} strokeWidth={3} /> Manage Roster
        </PrimaryBtn>
      </div>
    );
  }

  const sorted = [...ops].sort((a, b) => {
    if (a.engaged.length !== b.engaged.length) return b.engaged.length - a.engaged.length;
    return b.assigned.length - a.assigned.length;
  });

  return (
    <>
      <div style={{
        display: 'grid', gap: 12,
        gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
      }}>
        {sorted.map(op => (
          <OperatorCard key={op.player.name} op={op}
            onSelectChallenge={onSelectChallenge}
            onSelectOperator={onSelectOperator} />
        ))}
      </div>

      {subbedOut.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <SectionLabel icon={<UserX size={11} />}>SUBBED OUT TODAY · {subbedOut.length}</SectionLabel>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {subbedOut.map(p => (
              <div key={p.name} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
                background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 3, fontSize: 13, color: 'rgba(255,255,255,0.5)',
              }}>
                <Avatar name={p.name} index={0} size={20} />
                <span style={{ textDecoration: 'line-through' }}>{p.name}</span>
                <span style={{ fontSize: 10, color: '#10b981', letterSpacing: '0.08em' }}>
                  {challenges.filter(c => c.status === 'solved' && operatorMatchesSolver(c, p)).length} SOLVED
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function OperatorCard({ op, onSelectChallenge, onSelectOperator }) {
  const { player, assigned, engaged, solved, catCount } = op;
  const isOverloaded = engaged.length >= 3;
  const isIdle = assigned.length === 0;
  const statusLabel = isIdle ? '○ IDLE · UNASSIGNED'
    : engaged.length === 0 ? '○ ASSIGNED · NOT ENGAGED'
    : isOverloaded ? `● HEAVY LOAD (${engaged.length})`
    : `● ENGAGED (${engaged.length})`;
  const statusColor = isIdle ? '#64748b' : engaged.length === 0 ? '#94a3b8'
    : isOverloaded ? '#ef4444' : '#f59e0b';

  return (
    <div onClick={() => onSelectOperator(player.name)} style={{
      background: 'rgba(255,255,255,0.025)',
      border: `1px solid ${engaged.length > 0 ? 'rgba(245,158,11,0.25)' : 'rgba(255,255,255,0.08)'}`,
      borderRadius: 4, padding: 14, cursor: 'pointer', position: 'relative',
      transition: 'all 150ms',
    }}
    onMouseEnter={e => { e.currentTarget.style.borderColor = '#d4a843'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
    onMouseLeave={e => { e.currentTarget.style.borderColor = engaged.length > 0 ? 'rgba(245,158,11,0.25)' : 'rgba(255,255,255,0.08)'; e.currentTarget.style.transform = 'translateY(0)'; }}>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <Avatar name={player.name} index={0} size={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>{player.name}</div>
          <div style={{ fontSize: 10, letterSpacing: '0.15em', fontWeight: 600, color: statusColor }}>
            {player.source === 'icc-solver' ? '● ICC SOLVER · MAP IN ROSTER' : statusLabel}
          </div>
        </div>
        {player.source === 'icc-solver' && (
          <div title="Solver from ICC API not mapped to a roster operator" style={{
            padding: '2px 6px', background: 'rgba(6,182,212,0.12)', border: '1px solid rgba(6,182,212,0.35)',
            borderRadius: 2, fontSize: 9, color: '#06b6d4', letterSpacing: '0.1em',
          }}>ICC</div>
        )}
        {isOverloaded && (
          <div title="Heavy load — 3+ engaged challenges" style={{
            padding: '2px 6px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)',
            borderRadius: 2, fontSize: 9, color: '#ef4444', letterSpacing: '0.1em',
          }}>⚠ LOAD</div>
        )}
      </div>

      {engaged.length > 0 ? (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.5)', marginBottom: 5 }}>CURRENTLY ENGAGED</div>
          {engaged.map(c => {
            const isStuck = c.status === 'stuck';
            return (
              <button key={c.id} onClick={(e) => { e.stopPropagation(); onSelectChallenge(c.id); }} style={{
                width: '100%', textAlign: 'left',
                background: isStuck ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)',
                border: `1px solid ${isStuck ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'}`,
                borderRadius: 3, padding: '6px 10px', marginBottom: 4, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                fontFamily: '"Chakra Petch", sans-serif', color: '#fff', fontSize: 13,
              }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
                  <span style={{ width: 6, height: 6, background: (CATEGORIES[c.category] || CATEGORIES.misc).color, borderRadius: 1, flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.title || 'Untitled'}
                  </span>
                </span>
                <span style={{
                  fontSize: 10, color: isStuck ? '#ef4444' : '#f59e0b', letterSpacing: '0.1em', fontWeight: 600,
                }}>{isStuck ? 'STUCK' : 'ENGAGED'}</span>
              </button>
            );
          })}
        </div>
      ) : assigned.length > 0 ? (
        <div style={{ marginBottom: 10, fontSize: 11, color: 'rgba(255,255,255,0.45)', fontStyle: 'italic' }}>
          <Coffee size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
          {assigned.length} assigned challenge{assigned.length === 1 ? '' : 's'} — none currently engaged
        </div>
      ) : null}

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6,
        padding: '8px 0', borderTop: '1px dashed rgba(255,255,255,0.08)',
        borderBottom: '1px dashed rgba(255,255,255,0.08)', marginBottom: 10,
      }}>
        <Stat label="ASSIGNED" value={assigned.length} />
        <Stat label="ENGAGED" value={engaged.length} accent="#f59e0b" />
        <Stat label="SOLVED" value={solved.length} accent="#10b981" />
      </div>

      {solved.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 9, letterSpacing: '0.2em', color: '#10b981', marginBottom: 5 }}>SOLVE CREDIT</div>
          {solved.slice(0, 3).map(c => (
            <button key={c.id} onClick={(e) => { e.stopPropagation(); onSelectChallenge(c.id); }} style={{
              width: '100%', textAlign: 'left',
              background: 'rgba(16,185,129,0.06)',
              border: '1px solid rgba(16,185,129,0.2)',
              borderRadius: 3, padding: '5px 8px', marginBottom: 4, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
              fontFamily: '"Chakra Petch", sans-serif', color: '#fff', fontSize: 12,
            }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title || 'Untitled'}</span>
              <span style={{ color: c.solver?.source === 'icc' ? '#10b981' : '#f59e0b', fontSize: 9, letterSpacing: '0.1em' }}>
                {c.solver?.source === 'icc' ? 'ICC' : 'COACH'}
              </span>
            </button>
          ))}
          {solved.length > 3 && (
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)' }}>+{solved.length - 3} more solved</div>
          )}
        </div>
      )}

      {Object.keys(catCount).length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {Object.entries(catCount).map(([k, n]) => {
            const cat = CATEGORIES[k] || CATEGORIES.misc;
            return (
              <span key={k} style={{
                fontSize: 9, letterSpacing: '0.08em', padding: '2px 6px',
                background: `${cat.color}1a`, color: cat.color,
                border: `1px solid ${cat.color}40`, borderRadius: 2,
              }}>
                {cat.label} · {n}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent = '#fff' }) {
  return (
    <div>
      <div style={{ fontSize: 9, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.45)' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: accent, marginTop: 2 }}>{value}</div>
    </div>
  );
}

// ============================================================
// OPERATOR DETAIL MODAL
// ============================================================

function OperatorDetailModal({ operator, challenges, settings, onClose, onOpenChallenge }) {
  const name = operator.name;
  const assigned = challenges.filter(c => c.assignees.includes(name));
  const credited = challenges.filter(c => c.status === 'solved' && operatorMatchesSolver(c, operator));
  const grouped = useMemo(() => {
    const byStatus = { 'in-progress': [], stuck: [], unsolved: [], solved: [] };
    assigned.forEach(c => { if (byStatus[c.status]) byStatus[c.status].push(c); });
    return byStatus;
  }, [assigned]);

  return (
    <Modal onClose={onClose} width={680}>
      <div style={{ padding: '18px 22px', borderBottom: '1px solid rgba(255,255,255,0.08)',
        display: 'flex', alignItems: 'center', gap: 14 }}>
        <Avatar name={name} index={0} size={48} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.25em', color: '#d4a843', fontWeight: 600 }}>◆ OPERATOR DOSSIER</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>{name}</div>
          {operator.iccUsername && (
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
              ICC username: {operator.iccUsername}
            </div>
          )}
        </div>
        <IconBtn onClick={onClose}><X size={14} /></IconBtn>
      </div>
      <div style={{ padding: 22 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 20 }}>
          <Stat label="ASSIGNED" value={assigned.length} />
          <Stat label="ENGAGED" value={grouped['in-progress'].length} accent="#f59e0b" />
          <Stat label="STUCK" value={grouped.stuck.length} accent="#ef4444" />
          <Stat label="SOLVED" value={credited.length} accent="#10b981" />
        </div>

        {credited.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <SectionLabel icon={<Award size={11} />}>SOLVE CREDIT · {credited.length}</SectionLabel>
            {credited.map(c => {
              const cat = CATEGORIES[c.category] || CATEGORIES.misc;
              return (
                <button key={c.id} onClick={() => onOpenChallenge(c.id)} style={{
                  width: '100%', textAlign: 'left',
                  background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.18)',
                  borderRadius: 3, padding: '9px 12px', marginBottom: 5, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                  fontFamily: '"Chakra Petch", sans-serif', color: '#fff', fontSize: 14,
                }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                    <Badge color={cat.color}>{cat.label}</Badge>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.title || 'Untitled'}
                    </span>
                  </span>
                  <span style={{ fontSize: 9, letterSpacing: '0.1em', color: c.solver?.source === 'icc' ? '#10b981' : '#f59e0b' }}>
                    {c.solver?.source === 'icc' ? 'ICC' : 'COACH'}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {assigned.length === 0 && credited.length === 0 ? (
          <div style={{
            padding: 20, textAlign: 'center', border: '1px dashed rgba(255,255,255,0.1)',
            borderRadius: 3, color: 'rgba(255,255,255,0.5)', fontSize: 13,
          }}>
            Not assigned or credited on any challenges yet.
          </div>
        ) : (
          <>
            {['in-progress', 'stuck', 'unsolved', 'solved'].map(s => (
              grouped[s].length > 0 && (
                <div key={s} style={{ marginBottom: 16 }}>
                  <SectionLabel icon={<ChevronRight size={11} />}>{STATUSES[s].label} · {grouped[s].length}</SectionLabel>
	                  {grouped[s].map(c => {
	                    const lockState = solvedLockState(c, settings);
	                    const cat = CATEGORIES[c.category] || CATEGORIES.misc;
                    return (
                      <button key={c.id} onClick={() => onOpenChallenge(c.id)} style={{
                        width: '100%', textAlign: 'left',
                        background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: 3, padding: '10px 12px', marginBottom: 5, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                        fontFamily: '"Chakra Petch", sans-serif', color: '#fff', fontSize: 14,
                      }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = '#d4a843'}
                      onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                          <Badge color={cat.color}>{cat.label}</Badge>
                          <DifficultyDots level={c.difficulty} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {c.title || 'Untitled'}
                          </span>
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
	                          {lockState === 'pending' && (
	                            <span style={{ fontSize: 9, color: '#f59e0b', letterSpacing: '0.1em' }}>
	                              <Clock size={9} style={{ verticalAlign: -1 }} /> PENDING
	                            </span>
	                          )}
	                          {lockState === 'locked' && (
	                            <span style={{ fontSize: 9, color: '#10b981', letterSpacing: '0.1em' }}>
	                              <Lock size={9} style={{ verticalAlign: -1 }} /> LOCKED
	                            </span>
	                          )}
                          <span style={{
                            fontSize: 11, color: 'rgba(255,255,255,0.55)',
                            fontFamily: '"JetBrains Mono", monospace',
                          }}>{fmtRelative(c.updatedAt)}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )
            ))}
          </>
        )}
      </div>
    </Modal>
  );
}

// ============================================================
// EMPTY / LOADING / MODAL
// ============================================================

function LoadingState() {
  return (
    <div style={{ padding: '60px 20px', textAlign: 'center', color: 'rgba(255,255,255,0.5)' }}>
      <Terminal size={28} style={{ marginBottom: 10 }} />
      <div style={{ letterSpacing: '0.2em' }}>LOADING OPS DATA…</div>
    </div>
  );
}

function EmptyState({ hasChallenges, onAdd }) {
  return (
    <div style={{
      padding: '60px 20px', textAlign: 'center',
      border: '1px dashed rgba(255,255,255,0.1)', borderRadius: 4,
    }}>
      <Crosshair size={40} color="#d4a843" style={{ marginBottom: 14 }} />
      <div style={{ fontSize: 14, letterSpacing: '0.2em', color: '#d4a843', fontWeight: 600, marginBottom: 6 }}>
        {hasChallenges ? 'NO MATCHES' : 'NO CHALLENGES TRACKED'}
      </div>
      <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginBottom: 20 }}>
        {hasChallenges ? 'Adjust filters or search to find challenges.' : "Add the first challenge from the captain's report."}
      </div>
      {!hasChallenges && (
        <PrimaryBtn onClick={onAdd}><Plus size={14} strokeWidth={3} /> Add First Challenge</PrimaryBtn>
      )}
    </div>
  );
}

function Modal({ children, onClose, width = 640 }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(7,10,20,0.85)',
      backdropFilter: 'blur(6px)', zIndex: 100,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '40px 16px', overflowY: 'auto',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#0e1424', border: '1px solid rgba(212,168,67,0.3)',
        borderRadius: 6, width: '100%', maxWidth: width,
        boxShadow: '0 24px 64px rgba(0,0,0,0.6), 0 0 32px rgba(212,168,67,0.1)',
      }}>
        {children}
      </div>
    </div>
  );
}

// ============================================================
// CHALLENGE DETAIL (with FIXED delete via native confirm)
// ============================================================

function ChallengeDetail({ challenge, roster, settings, phase, onClose, onSave, onDelete }) {
  const [draft, setDraft] = useState(challenge);
  const [tagInput, setTagInput] = useState('');
  const dirtyRef = useRef(false);

  useEffect(() => { if (!dirtyRef.current) setDraft(challenge); }, [challenge]);

  const update = (patch) => { dirtyRef.current = true; setDraft(d => ({ ...d, ...patch })); };

  const handleSave = async () => {
    await onSave(draft); dirtyRef.current = false; onClose();
  };

  const handleDelete = () => {
    const title = draft.title || 'this untitled challenge';
    if (window.confirm(`Delete "${title}"? This cannot be undone.`)) {
      onDelete();
      onClose();
    }
  };

  const toggleAssignee = (name) => {
    const has = draft.assignees.includes(name);
    update({ assignees: has ? draft.assignees.filter(a => a !== name) : [...draft.assignees, name] });
  };

  const setManualSolver = (name) => {
    const solver = name
      ? normalizeSolverRecord({ username: name, source: 'manual', solvedAt: draft.solvedAt || Date.now() })
      : null;
    update({ solver, solvedBy: solver?.username ? [solver.username] : [] });
  };

  const addTag = () => {
    const t = tagInput.trim().toLowerCase().replace(/\s+/g, '-');
    if (t && !draft.tags.includes(t)) update({ tags: [...draft.tags, t] });
    setTagInput('');
  };

  const markSolved = async () => {
    const now = Date.now();
    const existingSolver = normalizeSolverRecord(draft.solver);
    const projectedSolver = existingSolver || (draft.assignees.length === 1
      ? normalizeSolverRecord({ username: draft.assignees[0], source: 'manual', solvedAt: now })
      : null);
    await onSave({
      ...draft,
      status: 'solved',
      solvedAt: now,
      solver: projectedSolver,
      solvedBy: projectedSolver?.username ? [projectedSolver.username] : [],
    });
    onClose();
  };

  const cat = CATEGORIES[draft.category] || CATEGORIES.misc;
  const sp = solvedPhase(draft, settings);
  const lockState = solvedLockState(draft, settings);
  const solverName = solverDisplayName(draft);
  const solverSource = draft.solver?.source || '';
  const hasIccSolver = solverSource === 'icc';
  const decay = pointDecayIntel(draft);
  const publicSolves = Array.isArray(draft.platformSolves) ? draft.platformSolves.map(normalizePublicSolveRecord).filter(Boolean) : [];
  publicSolves.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  const solverOptions = [
    { value: '', label: draft.status === 'solved' ? 'Pending ICC / none' : 'No solver' },
    ...roster.map(p => ({ value: p.name, label: p.iccUsername ? `${p.name} (${p.iccUsername})` : p.name })),
  ];
  if (solverName && !solverOptions.some(o => o.value === solverName)) {
    solverOptions.push({ value: solverName, label: `${solverName} (ICC)` });
  }

  return (
    <Modal onClose={onClose} width={760}>
      <div style={{
        padding: '18px 22px', borderBottom: '1px solid rgba(255,255,255,0.08)',
        background: `linear-gradient(90deg, ${cat.color}12, transparent)`,
        borderTop: `3px solid ${cat.color}`, borderRadius: '6px 6px 0 0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Badge color={cat.color}>{cat.label}</Badge>
          <DifficultyDots level={draft.difficulty} />
          {lockState === 'pending' && (
            <Badge color="#f59e0b"><Clock size={10} /> HR SOLVE · LOCKS AT PHASE END</Badge>
          )}
          {lockState === 'locked' && (
            <Badge color="#10b981"><Lock size={10} /> SCORE LOCKED · {(settings.lockedPhaseLabel || 'Phase 1').toUpperCase()}</Badge>
          )}
          {sp === 'open' && (
            <Badge color="#ef4444"><Cpu size={10} /> SOLVED IN {(settings.openPhaseLabel || 'Phase 2').toUpperCase()}</Badge>
          )}
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: '"JetBrains Mono", monospace' }}>
            #{draft.id.slice(-6)}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <IconBtn onClick={() => update({ starred: !draft.starred })} active={draft.starred} title="Star">
            <Star size={14} fill={draft.starred ? '#d4a843' : 'none'} />
          </IconBtn>
          <IconBtn onClick={handleDelete} danger title="Delete challenge"><Trash2 size={14} /></IconBtn>
          <IconBtn onClick={onClose} title="Close"><X size={14} /></IconBtn>
        </div>
      </div>

      <div style={{ padding: 22 }}>
        <Input value={draft.title} onChange={e => update({ title: e.target.value })}
          placeholder="Challenge name…"
          style={{ fontSize: 20, fontWeight: 600, padding: '10px 14px', marginBottom: 18 }} />

        {draft.status !== 'solved' && (settings.useLockedPhase ?? false) && phase.phase === 'locked' && phase.phaseRemaining < LOCK_WARN_MS && (
          <div style={{
            marginBottom: 18, padding: 12,
            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 3, display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <AlertTriangle size={18} color="#ef4444" />
            <div style={{ flex: 1, fontSize: 12, color: '#fca5a5' }}>
              <b>LOCK-IN PRIORITY:</b> {settings.openPhaseLabel || 'Phase 2'} starts in <b style={{ fontFamily: '"JetBrains Mono", monospace' }}>{fmtCountdown(phase.phaseRemaining)}</b>. Score will continue decaying if not solved before then.
            </div>
          </div>
        )}

        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18,
          padding: '12px 16px', background: 'rgba(0,0,0,0.25)',
          border: '1px solid rgba(255,255,255,0.06)', borderRadius: 4,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.5)' }}>LAST UPDATED</div>
            <div style={{ fontSize: 16, color: '#fff', fontWeight: 500, marginTop: 2 }}>
              {fmtRelative(draft.updatedAt)} · {new Date(draft.updatedAt).toLocaleTimeString()}
            </div>
          </div>
          {draft.status !== 'solved' ? (
            <GhostBtn onClick={markSolved} style={{ borderColor: 'rgba(16,185,129,0.5)', color: '#10b981' }}>
              <Check size={13} strokeWidth={3} /> Mark Solved
            </GhostBtn>
          ) : (
            <Badge color="#10b981" variant="solid" size="lg"><Check size={12} strokeWidth={3} /> SOLVED</Badge>
          )}
        </div>

        {roster.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <SectionLabel icon={<UserCheck size={11} />}>ASSIGNED OPERATORS</SectionLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {roster.map(p => {
                const on = draft.assignees.includes(p.name);
                return (
                  <button key={p.name} onClick={() => toggleAssignee(p.name)} style={{
                    background: on ? 'rgba(212,168,67,0.15)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${on ? '#d4a843' : 'rgba(255,255,255,0.1)'}`,
                    color: p.status === 'subbed-out' ? 'rgba(255,255,255,0.35)' : on ? '#d4a843' : 'rgba(255,255,255,0.7)',
                    padding: '6px 12px', borderRadius: 3, cursor: 'pointer',
                    fontFamily: '"Chakra Petch", sans-serif', fontSize: 12, fontWeight: 500,
                    textDecoration: p.status === 'subbed-out' ? 'line-through' : 'none',
                  }}>
                    {on && <Check size={11} style={{ marginRight: 4, verticalAlign: -1 }} />}
                    {p.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ marginBottom: 18 }}>
          <SectionLabel icon={<Award size={11} />}>SOLVER CREDIT</SectionLabel>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center',
            padding: 12, background: 'rgba(16,185,129,0.04)', border: '1px solid rgba(16,185,129,0.16)', borderRadius: 4,
          }}>
            <div>
              <Select value={solverName} disabled={hasIccSolver}
                onChange={e => setManualSolver(e.target.value)}
                options={solverOptions}
                style={{ width: '100%' }} />
              <div style={{ marginTop: 6, fontSize: 11, color: 'rgba(255,255,255,0.5)', lineHeight: 1.4 }}>
                {hasIccSolver
                  ? `Authoritative ICC solve · user_id ${draft.solver?.userId ?? 'unknown'}`
                  : draft.status === 'solved'
                    ? 'Coach projection. ICC sync will replace this when the official Team USA solve appears.'
                    : 'Set after marking solved if coaches need a projection before official submission.'}
              </div>
            </div>
            <Badge color={hasIccSolver ? '#10b981' : '#f59e0b'}>{hasIccSolver ? 'ICC' : 'COACH'}</Badge>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 18 }}>
          <div>
            <SectionLabel icon={<Tag size={11} />}>CATEGORY</SectionLabel>
            <Select value={draft.category} onChange={e => update({ category: e.target.value })}
              options={Object.entries(CATEGORIES).map(([k, v]) => ({ value: k, label: v.label }))}
              style={{ width: '100%' }} />
          </div>
          <div>
            <SectionLabel icon={<Zap size={11} />}>DIFFICULTY</SectionLabel>
            <Select value={draft.difficulty} onChange={e => update({ difficulty: e.target.value })}
              options={Object.entries(DIFFICULTIES).map(([k, v]) => ({ value: k, label: v.label }))}
              style={{ width: '100%' }} />
          </div>
          <div>
            <SectionLabel icon={<Activity size={11} />}>STATUS</SectionLabel>
            <Select value={draft.status} onChange={e => {
              const status = e.target.value;
              const now = Date.now();
              const existingSolver = normalizeSolverRecord(draft.solver);
              const projectedSolver = status === 'solved'
                ? existingSolver || (draft.assignees.length === 1
                  ? normalizeSolverRecord({ username: draft.assignees[0], source: 'manual', solvedAt: draft.solvedAt || now })
                  : null)
                : null;
              update({
                status,
                solvedAt: status === 'solved' ? (draft.solvedAt || now) : null,
                solver: projectedSolver,
                solvedBy: projectedSolver?.username ? [projectedSolver.username] : [],
              });
            }}
              options={Object.entries(STATUSES).map(([k, v]) => ({ value: k, label: v.label }))}
              style={{ width: '100%' }} />
          </div>
          <div>
            <SectionLabel icon={<Award size={11} />}>POINTS</SectionLabel>
            <Input type="number" value={draft.points || ''}
              onChange={e => update({ points: parseInt(e.target.value) || 0 })}
              placeholder="optional" />
          </div>
        </div>

        {(draft.platformId || draft.platformPoints != null || draft.lastMeetingAt) && (
          <div style={{
            marginBottom: 18, padding: 12, background: 'rgba(212,168,67,0.04)',
            border: '1px solid rgba(212,168,67,0.18)', borderRadius: 4,
          }}>
            <SectionLabel icon={<Radio size={11} />}>COACHING INSIGHT DATA</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 10 }}>
              <Stat label="PLATFORM PTS" value={draft.platformPoints ?? '-'} accent="#d4a843" />
              <Stat label="PUBLIC SOLVES" value={draft.platformSolveCount ?? '-'} accent="#06b6d4" />
              <Stat label="PROGRESS" value={draft.captainProgress != null ? `${draft.captainProgress}%` : '-'} accent="#10b981" />
              <Stat label="TIME SPENT" value={draft.captainTimeSpentMinutes != null ? `${draft.captainTimeSpentMinutes}m` : '-'} accent="#f59e0b" />
            </div>
            {decay.max > 0 && (
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 10,
                padding: '8px 0', borderTop: '1px dashed rgba(255,255,255,0.08)', borderBottom: '1px dashed rgba(255,255,255,0.08)',
              }}>
                <Stat label="MAX VALUE" value={decay.max} accent="#10b981" />
                <Stat label="CURRENT VALUE" value={decay.current} accent="#d4a843" />
                <Stat label="DECAY LOST" value={decay.lost} accent={decay.lost > 0 ? '#ef4444' : '#94a3b8'} />
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {draft.platformSource && <Badge color="#94a3b8">{draft.platformSource}</Badge>}
              {draft.resourceNeed && draft.resourceNeed !== 'none' && <Badge color={RESOURCE_NEEDS[draft.resourceNeed]?.color || '#94a3b8'}>{RESOURCE_NEEDS[draft.resourceNeed]?.label || draft.resourceNeed}</Badge>}
              {draft.coachDecision && <Badge color={COACH_DECISIONS[draft.coachDecision]?.color || '#94a3b8'}>{COACH_DECISIONS[draft.coachDecision]?.label || draft.coachDecision}</Badge>}
              {draft.lastMeetingAt && <Badge color="#d4a843">MEETING {fmtRelative(draft.lastMeetingAt)}</Badge>}
            </div>
            {publicSolves.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <SectionLabel icon={<Activity size={11} />}>PUBLIC SOLVE / DECAY TRACE</SectionLabel>
                <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
                  {publicSolves.slice(-8).map((s, i) => (
                    <div key={`${s.teamId || 'team'}-${s.userId || s.username || i}-${s.timestamp || i}`} style={{
                      display: 'grid', gridTemplateColumns: '1.2fr 1fr 0.7fr 1fr', gap: 8,
                      padding: '7px 10px', borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.05)',
                      fontSize: 12, color: 'rgba(255,255,255,0.72)', alignItems: 'center',
                    }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.teamName || `team ${s.teamId || '?'}`}</div>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: String(s.teamId) === String(draft.solver?.teamId) ? '#10b981' : 'rgba(255,255,255,0.6)' }}>{s.username || '-'}</div>
                      <div style={{ fontFamily: '"JetBrains Mono", monospace', color: '#d4a843' }}>{s.points || 0}pt</div>
                      <div style={{ fontFamily: '"JetBrains Mono", monospace', color: 'rgba(255,255,255,0.45)' }}>{s.timestamp ? fmtRelative(s.timestamp) : '-'}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ marginBottom: 18 }}>
          <SectionLabel icon={<ExternalLink size={11} />}>CHALLENGE URL</SectionLabel>
          <Input value={draft.url} onChange={e => update({ url: e.target.value })} placeholder="https://…" />
        </div>

        <div style={{ marginBottom: 18 }}>
          <SectionLabel icon={<Hash size={11} />}>TAGS / TECHNIQUES</SectionLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {draft.tags.map(t => (
              <span key={t} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: 11, padding: '4px 8px', background: 'rgba(212,168,67,0.1)',
                border: '1px solid rgba(212,168,67,0.3)', borderRadius: 2,
                color: '#d4a843', fontFamily: '"JetBrains Mono", monospace',
              }}>
                #{t}
                <button onClick={() => update({ tags: draft.tags.filter(x => x !== t) })}
                  style={{ background: 'none', border: 'none', color: '#d4a843', cursor: 'pointer', padding: 0, display: 'flex' }}>
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <Input value={tagInput} onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
              placeholder="Add a tag…" />
            <GhostBtn onClick={addTag}>Add</GhostBtn>
          </div>
        </div>

        <div style={{ marginBottom: 18 }}>
          <SectionLabel icon={<Flag size={11} />}>CAPTURED FLAG</SectionLabel>
          <Input value={draft.flag} onChange={e => update({ flag: e.target.value })}
            placeholder="flag{...}"
            style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 13, color: '#10b981' }} />
        </div>

        <div style={{ marginBottom: 18 }}>
          <SectionLabel icon={<AlertCircle size={11} />}>HINTS USED</SectionLabel>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => update({ hintsUsed: Math.max(0, draft.hintsUsed - 1) })}
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', width: 30, height: 30, borderRadius: 3, cursor: 'pointer' }}>−</button>
            <div style={{ width: 60, textAlign: 'center', fontSize: 18, fontWeight: 700, fontFamily: '"JetBrains Mono", monospace' }}>
              {draft.hintsUsed}
            </div>
            <button onClick={() => update({ hintsUsed: draft.hintsUsed + 1 })}
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', width: 30, height: 30, borderRadius: 3, cursor: 'pointer' }}>+</button>
          </div>
        </div>

        <div style={{ marginBottom: 18 }}>
          <SectionLabel icon={<Terminal size={11} />}>OPERATIONAL NOTES</SectionLabel>
          <textarea value={draft.notes} onChange={e => update({ notes: e.target.value })}
            placeholder="From captain's report: findings, blockers, time spent, ideas to try, etc."
            rows={6}
            style={{
              background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.12)',
              color: '#fff', padding: '10px 12px', borderRadius: 3, width: '100%',
              fontFamily: '"JetBrains Mono", monospace', fontSize: 13, outline: 'none',
              lineHeight: 1.5,
            }}
            onFocus={e => { e.target.style.borderColor = '#d4a843'; }}
            onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.12)'; }} />
        </div>

        <div style={{
          padding: '10px 12px', background: 'rgba(0,0,0,0.25)',
          border: '1px solid rgba(255,255,255,0.05)', borderRadius: 3,
          fontSize: 11, color: 'rgba(255,255,255,0.5)', fontFamily: '"JetBrains Mono", monospace',
          marginBottom: 18,
        }}>
          <div>CREATED: {new Date(draft.createdAt).toLocaleString()}</div>
          <div>UPDATED: {new Date(draft.updatedAt).toLocaleString()}</div>
          {draft.solvedAt && <div style={{ color: '#10b981' }}>SOLVED: {new Date(draft.solvedAt).toLocaleString()}</div>}
          {solverName && <div style={{ color: '#10b981' }}>SOLVER: {solverName} ({hasIccSolver ? 'ICC' : 'coach'})</div>}
        </div>

        {/* Footer: Delete + Save side-by-side, both prominent */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <GhostBtn danger onClick={handleDelete}>
            <Trash2 size={12} /> Delete Challenge
          </GhostBtn>
          <div style={{ display: 'flex', gap: 8 }}>
            <GhostBtn onClick={onClose}>Cancel</GhostBtn>
            <PrimaryBtn onClick={handleSave}><Check size={13} strokeWidth={3} /> Save Changes</PrimaryBtn>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================
// ADD MODAL
// ============================================================

function AddModal({ roster, onClose, onCreate }) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('web');
  const [difficulty, setDifficulty] = useState('medium');
  const [points, setPoints] = useState('');
  const [assignees, setAssignees] = useState([]);
  const toggle = (n) => setAssignees(a => a.includes(n) ? a.filter(x => x !== n) : [...a, n]);
  const handle = () => {
    if (!title.trim()) return;
    onCreate({
      title: title.trim(), category, difficulty, points: parseInt(points) || 0, assignees,
      status: assignees.length > 0 ? 'in-progress' : 'unsolved',
    });
  };
  return (
    <Modal onClose={onClose} width={540}>
      <div style={{ padding: 22, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ fontSize: 10, letterSpacing: '0.25em', color: '#d4a843', fontWeight: 600 }}>◆ NEW CHALLENGE</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 4 }}>Log from captain's report</div>
      </div>
      <div style={{ padding: 22 }}>
        <SectionLabel icon={<Crosshair size={11} />}>TITLE</SectionLabel>
        <Input value={title} onChange={e => setTitle(e.target.value)}
          placeholder="e.g. Buffer Overload, Crypto Vault…" autoFocus
          onKeyDown={e => { if (e.key === 'Enter' && title.trim()) handle(); }}
          style={{ marginBottom: 16, fontSize: 15 }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 16 }}>
          <div>
            <SectionLabel icon={<Tag size={11} />}>CATEGORY</SectionLabel>
            <Select value={category} onChange={e => setCategory(e.target.value)}
              options={Object.entries(CATEGORIES).map(([k, v]) => ({ value: k, label: v.label }))}
              style={{ width: '100%' }} />
          </div>
          <div>
            <SectionLabel icon={<Zap size={11} />}>DIFFICULTY</SectionLabel>
            <Select value={difficulty} onChange={e => setDifficulty(e.target.value)}
              options={Object.entries(DIFFICULTIES).map(([k, v]) => ({ value: k, label: v.label }))}
              style={{ width: '100%' }} />
          </div>
          <div>
            <SectionLabel icon={<Award size={11} />}>POINTS</SectionLabel>
            <Input type="number" value={points} onChange={e => setPoints(e.target.value)} placeholder="optional" />
          </div>
        </div>
        {roster.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <SectionLabel icon={<Users size={11} />}>ASSIGN (OPTIONAL)</SectionLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {roster.map(p => {
                const on = assignees.includes(p.name);
                return (
                  <button key={p.name} onClick={() => toggle(p.name)} style={{
                    background: on ? 'rgba(212,168,67,0.15)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${on ? '#d4a843' : 'rgba(255,255,255,0.1)'}`,
                    color: on ? '#d4a843' : 'rgba(255,255,255,0.7)',
                    padding: '5px 10px', borderRadius: 3, cursor: 'pointer',
                    fontFamily: '"Chakra Petch", sans-serif', fontSize: 12,
                  }}>{p.name}</button>
                );
              })}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <GhostBtn onClick={onClose}>Cancel</GhostBtn>
          <PrimaryBtn onClick={handle} disabled={!title.trim()}>
            <Plus size={13} strokeWidth={3} /> Add Challenge
          </PrimaryBtn>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================
// REPORT HTML (for PDF print)
// ============================================================

function escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function buildSnapshotHTML({ challenges, roster, settings }) {
  const phase = getPhase(settings);
  const now = new Date();
  const day = COMP_DAYS[settings.competitionDay] || COMP_DAYS.jeopardy;

  const stats = {
    total: challenges.length,
    solved: challenges.filter(c => c.status === 'solved').length,
    engaged: challenges.filter(c => c.status === 'in-progress').length,
    stuck: challenges.filter(c => c.status === 'stuck').length,
    points: challenges.filter(c => c.status === 'solved').reduce((s, c) => s + (c.points || 0), 0),
    solvedHR: challenges.filter(c => solvedPhase(c, settings) === 'locked').length,
    solvedRU: challenges.filter(c => solvedPhase(c, settings) === 'open').length,
    pendingHR: challenges.filter(c => solvedLockState(c, settings) === 'pending').length,
    lockedHR: challenges.filter(c => solvedLockState(c, settings) === 'locked').length,
    pointsHR: challenges.filter(c => solvedPhase(c, settings) === 'locked').reduce((s, c) => s + (c.points || 0), 0),
  };

  const byCat = Object.entries(CATEGORIES).map(([k, v]) => ({
    label: v.label, color: v.color,
    total: challenges.filter(c => c.category === k).length,
    solved: challenges.filter(c => c.category === k && c.status === 'solved').length,
  })).filter(b => b.total > 0);

  const operators = roster.map(p => {
    const assigned = challenges.filter(c => c.assignees.includes(p.name));
    const engaged = assigned.filter(c => c.status === 'in-progress' || c.status === 'stuck').length;
    const solved = challenges.filter(c => c.status === 'solved' && operatorMatchesSolver(c, p)).length;
    return { name: p.name, status: p.status, assigned: assigned.length, engaged, solved };
  });

  const lockedLabel = settings.lockedPhaseLabel || 'Phase 1';
  const openLabel = settings.openPhaseLabel || 'Phase 2';
  const phaseDesc = phase.phase === 'pending' ? 'Not started'
    : phase.phase === 'scheduled' ? `Scheduled to start ${new Date(settings.startTime).toLocaleString()}`
    : phase.phase === 'ended' ? 'Concluded'
    : phase.phase === 'locked' ? `${lockedLabel} · ${fmtCountdown(phase.phaseRemaining)} until score lock`
    : phase.phase === 'open' ? `${openLabel} · ${fmtCountdown(phase.phaseRemaining)} remaining`
    : `In Progress · ${fmtCountdown(phase.phaseRemaining)} remaining`;

  const sortedChallenges = [...challenges].sort((a, b) => {
    const order = { 'in-progress': 0, stuck: 1, unsolved: 2, solved: 3 };
    return order[a.status] - order[b.status];
  });

  const challengeRows = sortedChallenges.map(c => {
    const cat = CATEGORIES[c.category] || CATEGORIES.misc;
    const sp = solvedPhase(c, settings);
    const lockState = solvedLockState(c, settings);
    const phaseTag = lockState === 'pending' ? `⏳ ${lockedLabel} lock pending` : lockState === 'locked' ? `🔒 ${lockedLabel}` : sp === 'open' ? openLabel : '';
    return `
      <tr class="status-${c.status}">
        <td><span class="cat" style="background:${cat.color}22;color:${cat.color};border-color:${cat.color}">${escapeHTML(cat.label)}</span></td>
        <td>${escapeHTML(DIFFICULTIES[c.difficulty]?.label || '')}</td>
        <td class="title">${escapeHTML(c.title || 'Untitled')}${c.starred ? ' ★' : ''}</td>
        <td>${escapeHTML(STATUSES[c.status]?.label || c.status)} ${phaseTag}</td>
        <td>${c.points || ''}</td>
        <td>${escapeHTML(solverDisplayName(c) || '')}</td>
        <td>${escapeHTML(c.assignees.join(', '))}</td>
        <td>${escapeHTML(c.tags.join(', '))}</td>
      </tr>`;
  }).join('');

  return `<!doctype html>
<html><head>
<meta charset="utf-8" />
<title>${escapeHTML(settings.eventName)} — Snapshot ${now.toISOString().slice(0,16)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; color: #111; font-size: 11px; line-height: 1.4; margin: 0; }
  h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: 0.5px; }
  h2 { font-size: 13px; margin: 18px 0 6px; letter-spacing: 1.5px; color: #555; text-transform: uppercase; border-bottom: 1px solid #ddd; padding-bottom: 3px; }
  .meta { color: #666; font-size: 10px; margin-bottom: 12px; }
  .day { display: inline-block; padding: 2px 8px; background: ${day.color}22; color: ${day.color}; border: 1px solid ${day.color}; font-weight: 700; letter-spacing: 1px; border-radius: 2px; font-size: 10px; }
  .stats { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin: 12px 0; }
  .stat { border: 1px solid #ddd; padding: 8px; border-radius: 3px; }
  .stat-label { font-size: 9px; letter-spacing: 1.2px; text-transform: uppercase; color: #777; }
  .stat-value { font-size: 18px; font-weight: 700; margin-top: 2px; }
  .cat-bar { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
  .cat-chip { padding: 3px 8px; font-size: 10px; border: 1px solid #ddd; border-radius: 2px; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 10px; }
  th { text-align: left; background: #f3f3f3; padding: 5px 6px; border-bottom: 1px solid #ccc; font-size: 9px; letter-spacing: 1px; text-transform: uppercase; color: #444; }
  td { padding: 5px 6px; border-bottom: 1px solid #eee; vertical-align: top; }
  tr.status-solved td.title { text-decoration: line-through; color: #888; }
  .cat { display: inline-block; padding: 1px 6px; font-size: 9px; font-weight: 600; border: 1px solid; border-radius: 2px; letter-spacing: 0.8px; }
  .phase-banner { padding: 10px 12px; background: #fafafa; border: 1px solid #ddd; border-left: 4px solid ${day.color}; margin: 10px 0; border-radius: 2px; }
  .footer { margin-top: 20px; padding-top: 10px; border-top: 1px solid #ddd; font-size: 9px; color: #888; letter-spacing: 1px; text-transform: uppercase; }
  .auto-print { position: fixed; top: 10px; right: 10px; background: #d4a843; color: #111; padding: 8px 14px; border: none; cursor: pointer; font-weight: 700; border-radius: 3px; font-size: 12px; letter-spacing: 1px; }
  @media print { .auto-print { display: none; } }
</style>
</head>
<body>
  <button class="auto-print" onclick="window.print()">Print / Save as PDF</button>
  <h1>${escapeHTML(settings.eventName)} <span class="day">${day.label}</span></h1>
  <div class="meta">Coach Command Center snapshot · Generated ${now.toLocaleString()}</div>

  <div class="phase-banner"><b>Competition Phase:</b> ${escapeHTML(phaseDesc)}</div>

  <h2>Headline</h2>
  <div class="stats">
    <div class="stat"><div class="stat-label">Challenges</div><div class="stat-value">${stats.total}</div></div>
    <div class="stat"><div class="stat-label">Solved</div><div class="stat-value">${stats.solved}</div></div>
    <div class="stat"><div class="stat-label">Engaged</div><div class="stat-value">${stats.engaged}</div></div>
    <div class="stat"><div class="stat-label">Stuck</div><div class="stat-value">${stats.stuck}</div></div>
    <div class="stat"><div class="stat-label">${phase.phase === 'locked' ? 'HR Pending' : 'Locked HR'}</div><div class="stat-value">${stats.solvedHR} · ${stats.pointsHR}pt</div></div>
    <div class="stat"><div class="stat-label">Total Points</div><div class="stat-value">${stats.points}</div></div>
  </div>

  ${byCat.length ? `<h2>By Category</h2><div class="cat-bar">${byCat.map(b => `<span class="cat-chip" style="border-color:${b.color};color:${b.color}">${escapeHTML(b.label)} · ${b.solved}/${b.total}</span>`).join('')}</div>` : ''}

  ${operators.length ? `<h2>Operators</h2>
  <table>
    <thead><tr><th>Operator</th><th>Status</th><th>Assigned</th><th>Engaged</th><th>Solved</th></tr></thead>
    <tbody>${operators.map(o => `<tr><td><b>${escapeHTML(o.name)}</b></td><td>${o.status === 'subbed-out' ? '<i style="color:#c00">subbed out</i>' : 'active'}</td><td>${o.assigned}</td><td>${o.engaged}</td><td>${o.solved}</td></tr>`).join('')}</tbody>
  </table>` : ''}

  ${sortedChallenges.length ? `<h2>Challenges (${sortedChallenges.length})</h2>
  <table>
    <thead><tr><th>Cat</th><th>Diff</th><th>Title</th><th>Status</th><th>Pts</th><th>Solver</th><th>Assignees</th><th>Tags</th></tr></thead>
    <tbody>${challengeRows}</tbody>
  </table>` : '<p style="color:#999;font-style:italic">No challenges tracked yet.</p>'}

  <div class="footer">USCT · Coach Command Center · ${now.toISOString()}</div>
</body></html>`;
}

function exportPDF(data) {
  const html = buildSnapshotHTML(data);
  const w = window.open('', '_blank');
  if (!w) { alert('Please allow popups to export PDF. The browser blocked the new window.'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
  // Auto-trigger print after the new window's content settles
  setTimeout(() => { try { w.focus(); w.print(); } catch (e) { /* user can click button */ } }, 400);
}

function exportJSON(data) {
  const payload = {
    exportedAt: new Date().toISOString(),
    settings: data.settings,
    roster: data.roster,
    challenges: data.challenges,
    platformSnapshots: data.platformSnapshots || [],
    meetings: data.meetings || [],
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `coach-snapshot-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============================================================
// ROSTER & SETTINGS MODAL
// ============================================================

function RosterModal({ roster, settings, challenges, platformSnapshots = [], meetings = [], subsRemaining, onClose, onSaveRoster, onSaveSettings, onClearAll }) {
  const [newName, setNewName] = useState('');
  const [eventName, setEventName] = useState(settings.eventName || '');
  const [tab, setTab] = useState('competition');

  const add = () => {
    const n = newName.trim();
    if (!n || roster.some(p => p.name === n)) return;
    onSaveRoster([...roster, { name: n, status: 'active', subbedOutAt: null, strengths: [], experienceLevel: 'solid', availabilityStatus: 'available', fatigueNote: '', iccUsername: '', iccUserId: '' }]);
    setNewName('');
  };

  const remove = (name) => {
    if (window.confirm(`Remove ${name} from the roster? Their assignments will remain on challenges.`)) {
      onSaveRoster(roster.filter(p => p.name !== name));
    }
  };

  const subOut = (name) => {
    if (subsRemaining <= 0) return;
    if (!window.confirm(`Substitute out ${name}? Uses 1 of ${subsRemaining} remaining subs today.`)) return;
    onSaveRoster(roster.map(p => p.name === name ? { ...p, status: 'subbed-out', subbedOutAt: Date.now() } : p));
    onSaveSettings({ ...settings, subsUsed: (settings.subsUsed || 0) + 1 });
  };

  const reinstate = (name) => {
    onSaveRoster(roster.map(p => p.name === name ? { ...p, status: 'active', subbedOutAt: null } : p));
  };

  const updateOperator = (name, patch) => {
    onSaveRoster(roster.map(p => p.name === name ? { ...p, ...patch } : p));
  };

  const opStats = useMemo(() => roster.map(p => {
    const assigned = challenges.filter(c => c.assignees.includes(p.name));
    const engaged = assigned.filter(c => c.status === 'in-progress' || c.status === 'stuck').length;
    const solved = challenges.filter(c => c.status === 'solved' && operatorMatchesSolver(c, p)).length;
    return { ...p, assigned: assigned.length, engaged, solved };
  }), [roster, challenges]);

  const startLocal = settings.startTime
    ? new Date(settings.startTime - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)
    : '';

  return (
    <Modal onClose={onClose} width={760}>
      <div style={{
        padding: '18px 22px', borderBottom: '1px solid rgba(255,255,255,0.08)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: '0.25em', color: '#d4a843', fontWeight: 600 }}>◆ ROSTER & SETTINGS</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginTop: 4 }}>Coach Controls</div>
        </div>
        <IconBtn onClick={onClose}><X size={14} /></IconBtn>
      </div>

      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '0 22px' }}>
        {[
          { k: 'competition', label: 'COMPETITION', icon: <Clock size={12} /> },
          { k: 'roster', label: 'ROSTER', icon: <Users size={12} /> },
          { k: 'data', label: 'EXPORT', icon: <Download size={12} /> },
        ].map(t => (
          <button key={t.k} onClick={() => setTab(t.k)} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            padding: '12px 16px', display: 'inline-flex', alignItems: 'center', gap: 6,
            color: tab === t.k ? '#d4a843' : 'rgba(255,255,255,0.5)',
            fontFamily: '"Chakra Petch", sans-serif', fontWeight: 600,
            letterSpacing: '0.15em', fontSize: 11,
            borderBottom: `2px solid ${tab === t.k ? '#d4a843' : 'transparent'}`, marginBottom: -1,
          }}>{t.icon} {t.label}</button>
        ))}
      </div>

      <div style={{ padding: 22 }}>
        {tab === 'competition' && (
          <>
            <SectionLabel icon={<Radio size={11} />}>EVENT NAME</SectionLabel>
            <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
              <Input value={eventName} onChange={e => setEventName(e.target.value)}
                placeholder="e.g. ICC 2026 Day 1 — Jeopardy" />
              <GhostBtn onClick={() => onSaveSettings({ ...settings, eventName: eventName.trim() || 'COACH COMMAND CENTER' })}>Save</GhostBtn>
            </div>

            <SectionLabel icon={<Target size={11} />}>COMPETITION TYPE</SectionLabel>
            <div style={{ marginBottom: 18 }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '10px 16px', background: 'rgba(212,168,67,0.1)',
                border: '1px solid rgba(212,168,67,0.4)', borderRadius: 4,
                color: '#d4a843', fontFamily: '"Chakra Petch", sans-serif',
                fontSize: 13, fontWeight: 600, letterSpacing: '0.1em',
              }}>
                <span style={{ fontSize: 16 }}>◆</span> JEOPARDY
              </span>
            </div>

            <SectionLabel icon={<Clock size={11} />}>START TIME</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 6, marginBottom: 18 }}>
              <Input type="datetime-local" value={startLocal}
                onChange={e => {
                  const v = e.target.value;
                  onSaveSettings({ ...settings, startTime: v ? new Date(v).getTime() : null });
                }} />
              <GhostBtn onClick={() => onSaveSettings({ ...settings, startTime: Date.now() })}>
                <Play size={11} fill="currentColor" /> Start Now
              </GhostBtn>
              <GhostBtn onClick={() => onSaveSettings({ ...settings, startTime: null })}>
                <TimerReset size={11} /> Clear
              </GhostBtn>
            </div>

            <SectionLabel icon={<Clock size={11} />}>TOTAL DURATION (HOURS)</SectionLabel>
            <div style={{ marginBottom: 18 }}>
              <Input type="number" min="0" max="48" step="0.5"
                value={settings.durationHours ?? DEFAULT_DURATION_HOURS}
                onChange={e => onSaveSettings({ ...settings, durationHours: parseFloat(e.target.value) || 0 })} />
            </div>

            <SectionLabel icon={<Lock size={11} />}>LOCKED PHASE</SectionLabel>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'rgba(255,255,255,0.8)' }}>
                <input type="checkbox"
                  checked={settings.useLockedPhase ?? false}
                  onChange={e => onSaveSettings({ ...settings, useLockedPhase: e.target.checked })}
                  style={{ width: 14, height: 14, cursor: 'pointer', accentColor: '#d4a843' }} />
                Enable locked phase (score freeze at phase boundary)
              </label>
            </div>

            {(settings.useLockedPhase ?? false) && (
              <div style={{ marginBottom: 18 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 12 }}>
                  <div>
                    <SectionLabel icon={<ShieldAlert size={11} />}>LOCKED PHASE HOURS</SectionLabel>
                    <Input type="number" min="0" max="48" step="0.5"
                      value={settings.lockedPhaseHours ?? DEFAULT_HR_HOURS}
                      onChange={e => onSaveSettings({ ...settings, lockedPhaseHours: parseFloat(e.target.value) || 0 })} />
                  </div>
                  <div />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 12 }}>
                  <div>
                    <SectionLabel icon={<ShieldAlert size={11} />}>LOCKED PHASE LABEL</SectionLabel>
                    <Input value={settings.lockedPhaseLabel || ''}
                      placeholder="e.g. Human Resistance"
                      onChange={e => onSaveSettings({ ...settings, lockedPhaseLabel: e.target.value })} />
                  </div>
                  <div>
                    <SectionLabel icon={<Cpu size={11} />}>OPEN PHASE LABEL</SectionLabel>
                    <Input value={settings.openPhaseLabel || ''}
                      placeholder="e.g. Robot Uprising"
                      onChange={e => onSaveSettings({ ...settings, openPhaseLabel: e.target.value })} />
                  </div>
                </div>
              </div>
            )}

            <div style={{
              padding: 12, background: 'rgba(212,168,67,0.05)', border: '1px solid rgba(212,168,67,0.2)',
              borderRadius: 3, fontSize: 12, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5, marginBottom: 10,
            }}>
              <b style={{ color: '#d4a843' }}>ICC 2026 default:</b> 9-hour competition = 7h Human Resistance (simple AI only) + 2h Robot Uprising (approved AI permitted).
              On Jeopardy day, challenges solved during HR have their score locked at end-of-HR value.
            </div>
            <div style={{ marginBottom: 18 }}>
              <GhostBtn onClick={() => onSaveSettings({
                ...settings,
                durationHours: 9,
                useLockedPhase: true,
                lockedPhaseHours: 7,
                lockedPhaseLabel: 'Human Resistance',
                openPhaseLabel: 'Robot Uprising',
              })}>
                <Zap size={12} /> ICC 2026 Preset
              </GhostBtn>
            </div>

            <div style={{
              marginTop: 18, padding: 14,
              background: 'rgba(212,168,67,0.05)', border: '1px solid rgba(212,168,67,0.2)',
              borderRadius: 4,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <SectionLabel icon={<ArrowLeftRight size={11} />}>SUBSTITUTIONS (ICC RULE)</SectionLabel>
                <GhostBtn onClick={() => onSaveSettings({ ...settings, subsUsed: 0 })} style={{ fontSize: 10, padding: '4px 10px' }}>
                  <RefreshCw size={10} /> Reset Day
                </GhostBtn>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  fontFamily: '"JetBrains Mono", monospace', fontSize: 24, fontWeight: 700,
                  color: subsRemaining > 0 ? '#d4a843' : '#ef4444',
                }}>
                  {subsRemaining}/{MAX_SUBS_PER_DAY}
                </div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.4 }}>
                  Substitutions remaining today. ICC allows 2 per day. Once subbed out, a player cannot return until the next day.
                </div>
              </div>
            </div>
          </>
        )}

        {tab === 'roster' && (
          <>
            <SectionLabel icon={<Plus size={11} />}>ADD OPERATOR</SectionLabel>
            <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
              <Input value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="Operator handle…" onKeyDown={e => { if (e.key === 'Enter') add(); }} />
              <GhostBtn onClick={add}>Add</GhostBtn>
            </div>

            <SectionLabel icon={<Users size={11} />}>ROSTER ({roster.length})</SectionLabel>
            {roster.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 12, border: '1px dashed rgba(255,255,255,0.1)', borderRadius: 3 }}>
                No operators on roster yet.
              </div>
            ) : (
              <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{
                  display: 'grid', gridTemplateColumns: '1.6fr 0.8fr 0.7fr 0.7fr 0.7fr 110px',
                  padding: '8px 12px', background: 'rgba(255,255,255,0.03)',
                  fontSize: 10, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.5)', fontWeight: 600, gap: 8,
                }}>
                  <div>OPERATOR</div><div>STATUS</div><div>ASSIGNED</div><div>ENGAGED</div><div>SOLVED</div><div></div>
                </div>
                {opStats.map(op => (
                  <div key={op.name} style={{ borderTop: '1px solid rgba(255,255,255,0.05)', opacity: op.status === 'subbed-out' ? 0.5 : 1 }}>
                    <div style={{
                      display: 'grid', gridTemplateColumns: '1.6fr 0.8fr 0.7fr 0.7fr 0.7fr 110px',
                      padding: '10px 12px 6px', fontSize: 13, alignItems: 'center', gap: 8,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Avatar name={op.name} index={0} size={22} />
                        <span style={{ fontWeight: 500, textDecoration: op.status === 'subbed-out' ? 'line-through' : 'none' }}>{op.name}</span>
                      </div>
                      <div>
                        {op.status === 'subbed-out' ? (
                          <span style={{ fontSize: 9, color: '#ef4444', letterSpacing: '0.1em', fontWeight: 600 }}>SUBBED OUT</span>
                        ) : (
                          <span style={{ fontSize: 9, color: '#10b981', letterSpacing: '0.1em', fontWeight: 600 }}>ACTIVE</span>
                        )}
                      </div>
                      <div style={{ fontFamily: '"JetBrains Mono", monospace' }}>{op.assigned}</div>
                      <div style={{ fontFamily: '"JetBrains Mono", monospace', color: '#f59e0b' }}>{op.engaged}</div>
                      <div style={{ fontFamily: '"JetBrains Mono", monospace', color: '#10b981' }}>{op.solved}</div>
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        {op.status === 'active' ? (
                          <button onClick={() => subOut(op.name)} disabled={subsRemaining <= 0}
                            title={subsRemaining > 0 ? 'Substitute out' : 'No substitutions remaining'}
                            style={{
                              background: 'rgba(245,158,11,0.1)',
                              border: '1px solid rgba(245,158,11,0.3)',
                              color: subsRemaining > 0 ? '#f59e0b' : 'rgba(255,255,255,0.2)',
                              padding: '3px 8px', borderRadius: 2,
                              cursor: subsRemaining > 0 ? 'pointer' : 'not-allowed',
                              fontSize: 10, letterSpacing: '0.1em',
                            }}>
                            <ArrowLeftRight size={10} style={{ verticalAlign: -1 }} /> SUB
                          </button>
                        ) : (
                          <button onClick={() => reinstate(op.name)} style={{
                            background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)',
                            color: '#10b981', padding: '3px 8px', borderRadius: 2, cursor: 'pointer',
                            fontSize: 10, letterSpacing: '0.1em',
                          }}>REINSTATE</button>
                        )}
                        <button onClick={() => remove(op.name)} style={{
                          background: 'none', border: 'none', color: 'rgba(239,68,68,0.6)', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px',
                        }} title="Remove from roster"><Trash2 size={13} /></button>
                      </div>
                    </div>
                    <div style={{
                      display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1.2fr', gap: 8,
                      padding: '0 12px 10px', alignItems: 'center',
                    }}>
                      <Input value={op.iccUsername || ''}
                        onChange={e => updateOperator(op.name, { iccUsername: e.target.value.trim() })}
                        placeholder="icc username" style={{ fontSize: 11 }} />
                      <Select value={op.experienceLevel || 'solid'}
                        onChange={e => updateOperator(op.name, { experienceLevel: e.target.value })}
                        options={Object.entries(EXPERIENCE_LEVELS).map(([k, v]) => ({ value: k, label: v.label }))}
                        style={{ width: '100%', fontSize: 11 }} />
                      <Select value={op.availabilityStatus || 'available'}
                        onChange={e => updateOperator(op.name, { availabilityStatus: e.target.value })}
                        options={Object.entries(AVAILABILITY_STATUSES).map(([k, v]) => ({ value: k, label: v.label }))}
                        style={{ width: '100%', fontSize: 11 }} />
                      <Input value={(op.strengths || []).join(', ')}
                        onChange={e => updateOperator(op.name, {
                          strengths: e.target.value.split(',').map(x => x.trim().toLowerCase()).filter(x => CATEGORIES[x]),
                        })}
                        placeholder="strengths: web, crypto" style={{ fontSize: 11 }} />
                    </div>
                    <div style={{ padding: '0 12px 10px' }}>
                      <Input value={op.fatigueNote || ''}
                        onChange={e => updateOperator(op.name, { fatigueNote: e.target.value })}
                        placeholder="fatigue / availability note" style={{ fontSize: 11 }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'data' && (
          <>
            <SectionLabel icon={<Download size={11} />}>EXPORT SNAPSHOTS</SectionLabel>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginBottom: 12, lineHeight: 1.5 }}>
              Download the current state of the tracker as a snapshot. JSON for backup or post-event analysis; PDF for sharing with captains, jury, or post-competition retros.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 22 }}>
              <button onClick={() => exportJSON({ challenges, roster, settings, platformSnapshots, meetings })} style={{
                padding: 16, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 4, cursor: 'pointer', color: '#fff', textAlign: 'left',
                fontFamily: '"Chakra Petch", sans-serif', display: 'flex', flexDirection: 'column', gap: 6,
                transition: 'all 120ms',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#d4a843'; e.currentTarget.style.background = 'rgba(212,168,67,0.06)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; e.currentTarget.style.background = 'rgba(255,255,255,0.025)'; }}>
                <FileJson size={22} color="#d4a843" />
                <div style={{ fontWeight: 700, fontSize: 13, letterSpacing: '0.1em' }}>JSON SNAPSHOT</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', lineHeight: 1.4 }}>
                  Complete machine-readable export — challenges, roster, settings.
                </div>
              </button>
              <button onClick={() => exportPDF({ challenges, roster, settings })} style={{
                padding: 16, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 4, cursor: 'pointer', color: '#fff', textAlign: 'left',
                fontFamily: '"Chakra Petch", sans-serif', display: 'flex', flexDirection: 'column', gap: 6,
                transition: 'all 120ms',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#d4a843'; e.currentTarget.style.background = 'rgba(212,168,67,0.06)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; e.currentTarget.style.background = 'rgba(255,255,255,0.025)'; }}>
                <FileText size={22} color="#d4a843" />
                <div style={{ fontWeight: 700, fontSize: 13, letterSpacing: '0.1em' }}>PDF SNAPSHOT</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', lineHeight: 1.4 }}>
                  Printable report — opens a new window, then "Save as PDF" from the print dialog.
                </div>
              </button>
            </div>

            <SectionLabel icon={<AlertTriangle size={11} />}>DANGER ZONE</SectionLabel>
            <div style={{
              padding: 14, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)',
              borderRadius: 4,
            }}>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginBottom: 10, lineHeight: 1.5 }}>
                Wipe all challenges, roster, and competition settings from shared storage. Useful before re-publishing this artifact to give it a clean slate. <b>This affects everyone using this artifact and cannot be undone.</b>
              </div>
              <GhostBtn danger onClick={onClearAll}>
                <Trash2 size={12} /> Clear All Data
              </GhostBtn>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
