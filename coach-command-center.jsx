import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
  ad:       { label: 'A & D',    color: '#06b6d4', icon: '⚔' },
};

const DEFAULT_HR_HOURS = 7;
const DEFAULT_RU_HOURS = 2;
const MAX_SUBS_PER_DAY = 2;
const STALE_THRESHOLD_MS = 30 * 60 * 1000;
const LOCK_WARN_MS = 60 * 60 * 1000;
const LOCK_URGENT_MS = 30 * 60 * 1000;

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
  const hrMs = (settings.hrHours ?? DEFAULT_HR_HOURS) * 3600_000;
  const ruMs = (settings.ruHours ?? DEFAULT_RU_HOURS) * 3600_000;
  const totalMs = hrMs + ruMs;
  const hrEndsAt = start + hrMs;
  const ruEndsAt = start + totalMs;
  const elapsed = now - start;
  if (elapsed < 0) return { phase: 'scheduled', startsIn: -elapsed, elapsed: 0, totalMs, hrMs, ruMs, hrEndsAt, ruEndsAt };
  if (elapsed >= totalMs) return { phase: 'ended', elapsed: totalMs, totalMs, hrMs, ruMs, hrEndsAt, ruEndsAt };
  if (elapsed < hrMs) {
    return { phase: 'human-resistance', elapsed, totalMs, hrMs, ruMs, hrEndsAt, ruEndsAt,
      phaseElapsed: elapsed, phaseTotal: hrMs, phaseRemaining: hrMs - elapsed };
  }
  return { phase: 'robot-uprising', elapsed, totalMs, hrMs, ruMs, hrEndsAt, ruEndsAt,
    phaseElapsed: elapsed - hrMs, phaseTotal: ruMs, phaseRemaining: totalMs - elapsed };
}

function solvedPhase(challenge, settings) {
  if (challenge.status !== 'solved' || !challenge.solvedAt || !settings.startTime) return null;
  const hrEndsAt = settings.startTime + (settings.hrHours ?? DEFAULT_HR_HOURS) * 3600_000;
  return challenge.solvedAt <= hrEndsAt ? 'human-resistance' : 'robot-uprising';
}

const newChallenge = (overrides = {}) => ({
  id: uid(), title: '', category: 'misc', difficulty: 'medium', points: 0,
  status: 'unsolved', assignees: [], flag: '', notes: '', url: '', tags: [],
  createdAt: Date.now(), updatedAt: Date.now(), solvedAt: null, solvedBy: [],
  starred: false, hintsUsed: 0, ...overrides,
});

const migrate = (ch) => ({
  ...ch, points: ch.points || 0, tags: ch.tags || [],
  assignees: ch.assignees || [], solvedBy: ch.solvedBy || [],
  hintsUsed: ch.hintsUsed || 0,
});

const migrateRoster = (roster) => {
  if (!Array.isArray(roster)) return [];
  return roster.map(p => typeof p === 'string'
    ? { name: p, status: 'active', subbedOutAt: null }
    : { status: 'active', subbedOutAt: null, ...p });
};

// ============================================================
// STORAGE
// ============================================================
const SHARED = true;
const CH_PREFIX = 'challenge:';
const TEAM_KEY = 'team-roster';
const SETTINGS_KEY = 'event-settings';

const DEFAULT_SETTINGS = {
  eventName: 'COACH COMMAND CENTER', competitionDay: 'jeopardy',
  startTime: null, hrHours: DEFAULT_HR_HOURS, ruHours: DEFAULT_RU_HOURS,
  subsUsed: 0,
};

const storage = {
  async listChallenges() {
    try {
      const res = await window.storage.list(CH_PREFIX, SHARED);
      const keys = res?.keys || [];
      const items = await Promise.all(keys.map(async (k) => {
        try { const r = await window.storage.get(k, SHARED); return r ? migrate(JSON.parse(r.value)) : null; }
        catch { return null; }
      }));
      return items.filter(Boolean);
    } catch (e) { console.error('listChallenges', e); return []; }
  },
  async saveChallenge(ch) {
    try { await window.storage.set(`${CH_PREFIX}${ch.id}`, JSON.stringify(ch), SHARED); return true; }
    catch (e) { console.error('saveChallenge', e); return false; }
  },
  async deleteChallenge(id) {
    try { await window.storage.delete(`${CH_PREFIX}${id}`, SHARED); return true; }
    catch (e) { console.error('deleteChallenge', e); return false; }
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
      return r ? { ...DEFAULT_SETTINGS, ...JSON.parse(r.value) } : DEFAULT_SETTINGS;
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

// ============================================================
// USCT LOGO (inline SVG)
// ============================================================

function USCTLogo({ size = 64 }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="usct-bg" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#1e3a8a" />
          <stop offset="100%" stopColor="#0c1a3c" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill="url(#usct-bg)" stroke="#d4a843" strokeWidth="1.8" />
      <circle cx="50" cy="50" r="43" fill="none" stroke="#d4a843" strokeWidth="0.3" strokeDasharray="1.5,1.5" opacity="0.55" />
      {/* Eagle wing hint */}
      <path d="M40 21 Q45 17 50 16 Q55 17 60 21 L57 22 L54 21 L50 22 L46 21 L43 22 Z" fill="#d4a843" />
      {/* Flanking stars */}
      <polygon points="29,21 30,23.5 32.5,23.5 30.5,25 31.3,27.5 29,26 26.7,27.5 27.5,25 25.5,23.5 28,23.5" fill="#d4a843" />
      <polygon points="71,21 72,23.5 74.5,23.5 72.5,25 73.3,27.5 71,26 68.7,27.5 69.5,25 67.5,23.5 70,23.5" fill="#d4a843" />
      {/* Shield body */}
      <path d="M50 30 L66 34 L66 54 Q66 65 50 72 Q34 65 34 54 L34 34 Z" fill="#1e3a8a" stroke="#fff" strokeWidth="0.4" />
      <rect x="34" y="34" width="32" height="10" fill="#1e3a8a" />
      {/* Three stars */}
      <g fill="#fff">
        <polygon points="42,36.5 42.5,38 44,38 42.8,38.9 43.2,40.4 42,39.5 40.8,40.4 41.2,38.9 40,38 41.5,38" />
        <polygon points="50,36.5 50.5,38 52,38 50.8,38.9 51.2,40.4 50,39.5 48.8,40.4 49.2,38.9 48,38 49.5,38" />
        <polygon points="58,36.5 58.5,38 60,38 58.8,38.9 59.2,40.4 58,39.5 56.8,40.4 57.2,38.9 56,38 57.5,38" />
      </g>
      {/* Red stripes */}
      <rect x="34" y="44" width="32" height="2.4" fill="#dc2626" />
      <rect x="34" y="49" width="32" height="2.4" fill="#dc2626" />
      <rect x="34" y="54" width="32" height="2.4" fill="#dc2626" />
      <path d="M34 58.4 L66 58.4 L66 62 Q60 67 50 70 Q40 67 34 62 Z" fill="#dc2626" />
      {/* Subtle globe hint */}
      <circle cx="50" cy="55" r="22" fill="none" stroke="#06b6d4" strokeWidth="0.3" opacity="0.35" />
      {/* Bottom text */}
      <text x="50" y="89" textAnchor="middle" fontSize="5" fontWeight="700" fill="#fff" letterSpacing="1.2">US CYBER TEAM</text>
    </svg>
  );
}

// ============================================================
// PRIMITIVES
// ============================================================

const Badge = ({ children, color = '#94a3b8', variant = 'soft', size = 'sm', style = {} }) => {
  const base = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    fontFamily: '"Chakra Petch", sans-serif', fontWeight: 600,
    letterSpacing: '0.08em', textTransform: 'uppercase',
    borderRadius: 3, padding: size === 'sm' ? '3px 8px' : '5px 12px',
    fontSize: size === 'sm' ? 10 : 11, border: `1px solid ${color}`,
  };
  if (variant === 'soft') { base.background = `${color}1a`; base.color = color; }
  else { base.background = color; base.color = '#0a0e1a'; }
  return <span style={{ ...base, ...style }}>{children}</span>;
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

const Select = ({ value, onChange, options, style = {} }) => (
  <select value={value} onChange={onChange} style={{
    background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.12)',
    color: '#fff', padding: '9px 12px', borderRadius: 3,
    fontFamily: '"Chakra Petch", sans-serif', fontSize: 13, outline: 'none',
    cursor: 'pointer', appearance: 'none',
    backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23d4a843' stroke-width='2'><polyline points='6 9 12 15 18 9'/></svg>")`,
    backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center', paddingRight: 30, ...style,
  }}>
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
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const [view, setView] = useState('challenges');
  const [selectedId, setSelectedId] = useState(null);
  const [selectedOp, setSelectedOp] = useState(null);
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
      const [chs, rs, st] = await Promise.all([
        storage.listChallenges(), storage.getRoster(), storage.getSettings(),
      ]);
      setChallenges(chs); setRoster(rs); setSettings(st); setLoading(false);
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
    const [chs, rs, st] = await Promise.all([
      storage.listChallenges(), storage.getRoster(), storage.getSettings(),
    ]);
    setChallenges(chs); setRoster(rs); setSettings(st);
  }, []);

  const upsertChallenge = useCallback(async (ch) => {
    const updated = { ...ch, updatedAt: Date.now() };
    setChallenges(prev => {
      const idx = prev.findIndex(c => c.id === updated.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = updated; return next; }
      return [...prev, updated];
    });
    await storage.saveChallenge(updated);
  }, []);

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
    setShowRoster(false);
  }, []);

  const activeRoster = useMemo(() => roster.filter(p => p.status !== 'subbed-out'), [roster]);

  const phase = useMemo(() => getPhase(settings), [settings, tick]);

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
    const solvedHR = challenges.filter(c => solvedPhase(c, settings) === 'human-resistance').length;
    const pointsHR = challenges.filter(c => solvedPhase(c, settings) === 'human-resistance').reduce((s, c) => s + (c.points || 0), 0);
    return { total, solved, inProg, stuck, points, totalOps, engagedOps: engagedOps.size, byCat, solvedHR, pointsHR };
  }, [challenges, activeRoster, settings, tick]);

  const selected = challenges.find(c => c.id === selectedId);
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
          {settings.competitionDay === 'jeopardy' && settings.startTime ? (
            <StatCard label="LOCKED IN HR" value={`${stats.solvedHR} · ${stats.pointsHR}pt`} icon={<Lock size={14} />} accent="#10b981" />
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
                  <ChallengeCard key={c.id} challenge={c} settings={settings}
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

        <footer style={{
          marginTop: 60, paddingTop: 20, borderTop: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontSize: 10, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.35)',
        }}>
          <div>◆ COACH COMMAND CENTER · USCT · ICC 2026</div>
          <div style={{ fontFamily: '"JetBrains Mono", monospace' }}>
            {view === 'challenges' ? `SHOWING ${visible.length} / ${challenges.length}` : `${activeRoster.length} ACTIVE OPERATOR${activeRoster.length === 1 ? '' : 'S'}`}
          </div>
        </footer>
      </div>

      {selected && (
        <ChallengeDetail challenge={selected} roster={activeRoster} settings={settings} phase={phase}
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
          subsRemaining={subsRemaining}
          onClose={() => setShowRoster(false)}
          onSaveRoster={saveRoster}
          onSaveSettings={saveSettings}
          onClearAll={clearAllData} />
      )}
      {selectedOp && (
        <OperatorDetailModal name={selectedOp} challenges={challenges} settings={settings}
          onClose={() => setSelectedOp(null)}
          onOpenChallenge={(id) => { setSelectedOp(null); setSelectedId(id); }} />
      )}
    </div>
  );
}

// ============================================================
// COMPETITION PANEL
// ============================================================

function CompetitionPanel({ phase, settings, onConfigureTime, onSaveSettings }) {
  const day = COMP_DAYS[settings.competitionDay] || COMP_DAYS.jeopardy;
  const isJeopardy = settings.competitionDay === 'jeopardy';

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
              Set the start time and day type to begin tracking competition phase (Human Resistance / Robot Uprising).
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

  const isHR = phase.phase === 'human-resistance';
  const phaseColor = isHR ? '#d4a843' : '#ef4444';
  const phaseIcon = isHR ? <ShieldAlert size={20} /> : <Cpu size={20} />;
  const phaseLabel = isHR ? 'HUMAN RESISTANCE' : 'ROBOT UPRISING';
  const phaseDesc = isHR ? 'Simple AI only · Score-lock zone' : 'Approved AI enabled · Score decaying';

  const showLockUrgent = isJeopardy && isHR && phase.phaseRemaining <= LOCK_URGENT_MS;
  const showLockWarn = isJeopardy && isHR && phase.phaseRemaining <= LOCK_WARN_MS && !showLockUrgent;

  const hrPct = (phase.hrMs / phase.totalMs) * 100;
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
              {isHR ? 'SCORE LOCK IN' : 'COMPETITION ENDS'}
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
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0, width: `${hrPct}%`,
          background: 'rgba(212, 168, 67, 0.15)',
          borderRight: '1px solid rgba(255,255,255,0.3)',
        }} />
        <div style={{
          position: 'absolute', left: `${hrPct}%`, top: 0, bottom: 0, right: 0,
          background: 'rgba(239, 68, 68, 0.15)',
        }} />
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0, width: `${elapsedPct}%`,
          background: `linear-gradient(90deg, #d4a843 0%, #d4a843 ${hrPct/Math.max(elapsedPct,0.01)*100}%, #ef4444 100%)`,
          opacity: 0.85,
        }} />
        <div style={{
          position: 'absolute', left: `${elapsedPct}%`, top: -2, bottom: -2, width: 2,
          background: '#fff', boxShadow: '0 0 8px #fff',
        }} />
      </div>
      <div style={{
        display: 'flex', justifyContent: 'space-between', fontSize: 9, letterSpacing: '0.15em',
        color: 'rgba(255,255,255,0.4)', fontFamily: '"JetBrains Mono", monospace',
      }}>
        <span>HR · {settings.hrHours ?? DEFAULT_HR_HOURS}H</span>
        <span style={{ color: phaseColor }}>▲ NOW</span>
        <span>RU · {settings.ruHours ?? DEFAULT_RU_HOURS}H</span>
      </div>
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

function ChallengeCard({ challenge, settings, onClick, onToggleStar }) {
  const cat = CATEGORIES[challenge.category] || CATEGORIES.misc;
  const stat = STATUSES[challenge.status];
  const isSolved = challenge.status === 'solved';
  const solvedIn = solvedPhase(challenge, settings);
  const isJeopardy = settings.competitionDay === 'jeopardy';
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
          {solvedIn === 'human-resistance' && (
            <span title={isJeopardy ? 'Score locked at end-of-HR value' : 'Solved during Human Resistance phase'} style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              fontSize: 9, padding: '2px 6px', background: 'rgba(16,185,129,0.12)',
              border: '1px solid rgba(16,185,129,0.4)', color: '#10b981',
              borderRadius: 2, letterSpacing: '0.1em', fontWeight: 600,
            }}>
              <Lock size={9} /> {isJeopardy ? 'LOCKED' : 'HR'}
            </span>
          )}
          {solvedIn === 'robot-uprising' && (
            <span title="Solved during Robot Uprising phase" style={{
              fontSize: 9, padding: '2px 6px', background: 'rgba(239,68,68,0.12)',
              border: '1px solid rgba(239,68,68,0.4)', color: '#ef4444',
              borderRadius: 2, letterSpacing: '0.1em', fontWeight: 600,
            }}>
              <Cpu size={9} style={{ verticalAlign: -1, marginRight: 2 }} />RU
            </span>
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
  const ops = useMemo(() => {
    return roster.map(p => {
      const assigned = challenges.filter(c => c.assignees.includes(p.name));
      const engaged = assigned.filter(c => c.status === 'in-progress' || c.status === 'stuck');
      const solved = assigned.filter(c => c.status === 'solved');
      const catCount = {};
      assigned.forEach(c => { catCount[c.category] = (catCount[c.category] || 0) + 1; });
      return { player: p, assigned, engaged, solved, catCount };
    });
  }, [roster, challenges]);

  const subbedOut = allRoster.filter(p => p.status === 'subbed-out');

  if (roster.length === 0) {
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
            {statusLabel}
          </div>
        </div>
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

function OperatorDetailModal({ name, challenges, settings, onClose, onOpenChallenge }) {
  const assigned = challenges.filter(c => c.assignees.includes(name));
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
        </div>
        <IconBtn onClick={onClose}><X size={14} /></IconBtn>
      </div>
      <div style={{ padding: 22 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 20 }}>
          <Stat label="ASSIGNED" value={assigned.length} />
          <Stat label="ENGAGED" value={grouped['in-progress'].length} accent="#f59e0b" />
          <Stat label="STUCK" value={grouped.stuck.length} accent="#ef4444" />
          <Stat label="SOLVED" value={grouped.solved.length} accent="#10b981" />
        </div>

        {assigned.length === 0 ? (
          <div style={{
            padding: 20, textAlign: 'center', border: '1px dashed rgba(255,255,255,0.1)',
            borderRadius: 3, color: 'rgba(255,255,255,0.5)', fontSize: 13,
          }}>
            Not assigned to any challenges yet.
          </div>
        ) : (
          <>
            {['in-progress', 'stuck', 'unsolved', 'solved'].map(s => (
              grouped[s].length > 0 && (
                <div key={s} style={{ marginBottom: 16 }}>
                  <SectionLabel icon={<ChevronRight size={11} />}>{STATUSES[s].label} · {grouped[s].length}</SectionLabel>
                  {grouped[s].map(c => {
                    const sp = solvedPhase(c, settings);
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
                          {sp === 'human-resistance' && (
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

  const addTag = () => {
    const t = tagInput.trim().toLowerCase().replace(/\s+/g, '-');
    if (t && !draft.tags.includes(t)) update({ tags: [...draft.tags, t] });
    setTagInput('');
  };

  const markSolved = async () => {
    const now = Date.now();
    await onSave({ ...draft, status: 'solved', solvedAt: now, solvedBy: draft.assignees });
    onClose();
  };

  const cat = CATEGORIES[draft.category] || CATEGORIES.misc;
  const sp = solvedPhase(draft, settings);
  const isJeopardy = settings.competitionDay === 'jeopardy';

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
          {sp === 'human-resistance' && (
            <Badge color="#10b981"><Lock size={10} /> {isJeopardy ? 'SCORE LOCKED · HR' : 'SOLVED IN HR'}</Badge>
          )}
          {sp === 'robot-uprising' && (
            <Badge color="#ef4444"><Cpu size={10} /> SOLVED IN RU</Badge>
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

        {isJeopardy && draft.status !== 'solved' && phase.phase === 'human-resistance' && phase.phaseRemaining < LOCK_WARN_MS && (
          <div style={{
            marginBottom: 18, padding: 12,
            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 3, display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <AlertTriangle size={18} color="#ef4444" />
            <div style={{ flex: 1, fontSize: 12, color: '#fca5a5' }}>
              <b>LOCK-IN PRIORITY:</b> Robot Uprising starts in <b style={{ fontFamily: '"JetBrains Mono", monospace' }}>{fmtCountdown(phase.phaseRemaining)}</b>. Score will continue decaying if not solved before then.
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
                    color: on ? '#d4a843' : 'rgba(255,255,255,0.7)',
                    padding: '6px 12px', borderRadius: 3, cursor: 'pointer',
                    fontFamily: '"Chakra Petch", sans-serif', fontSize: 12, fontWeight: 500,
                  }}>
                    {on && <Check size={11} style={{ marginRight: 4, verticalAlign: -1 }} />}
                    {p.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

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
            <Select value={draft.status} onChange={e => update({ status: e.target.value })}
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
    solvedHR: challenges.filter(c => solvedPhase(c, settings) === 'human-resistance').length,
    solvedRU: challenges.filter(c => solvedPhase(c, settings) === 'robot-uprising').length,
    pointsHR: challenges.filter(c => solvedPhase(c, settings) === 'human-resistance').reduce((s, c) => s + (c.points || 0), 0),
  };

  const byCat = Object.entries(CATEGORIES).map(([k, v]) => ({
    label: v.label, color: v.color,
    total: challenges.filter(c => c.category === k).length,
    solved: challenges.filter(c => c.category === k && c.status === 'solved').length,
  })).filter(b => b.total > 0);

  const operators = roster.map(p => {
    const assigned = challenges.filter(c => c.assignees.includes(p.name));
    const engaged = assigned.filter(c => c.status === 'in-progress' || c.status === 'stuck').length;
    const solved = assigned.filter(c => c.status === 'solved').length;
    return { name: p.name, status: p.status, assigned: assigned.length, engaged, solved };
  });

  const phaseDesc = phase.phase === 'pending' ? 'Not started'
    : phase.phase === 'scheduled' ? `Scheduled to start ${new Date(settings.startTime).toLocaleString()}`
    : phase.phase === 'ended' ? 'Concluded'
    : phase.phase === 'human-resistance' ? `Human Resistance · ${fmtCountdown(phase.phaseRemaining)} until score lock`
    : `Robot Uprising · ${fmtCountdown(phase.phaseRemaining)} remaining`;

  const sortedChallenges = [...challenges].sort((a, b) => {
    const order = { 'in-progress': 0, stuck: 1, unsolved: 2, solved: 3 };
    return order[a.status] - order[b.status];
  });

  const challengeRows = sortedChallenges.map(c => {
    const cat = CATEGORIES[c.category] || CATEGORIES.misc;
    const sp = solvedPhase(c, settings);
    const phaseTag = sp === 'human-resistance' ? '🔒 HR' : sp === 'robot-uprising' ? 'RU' : '';
    return `
      <tr class="status-${c.status}">
        <td><span class="cat" style="background:${cat.color}22;color:${cat.color};border-color:${cat.color}">${escapeHTML(cat.label)}</span></td>
        <td>${escapeHTML(DIFFICULTIES[c.difficulty]?.label || '')}</td>
        <td class="title">${escapeHTML(c.title || 'Untitled')}${c.starred ? ' ★' : ''}</td>
        <td>${escapeHTML(STATUSES[c.status]?.label || c.status)} ${phaseTag}</td>
        <td>${c.points || ''}</td>
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
    <div class="stat"><div class="stat-label">Locked HR</div><div class="stat-value">${stats.solvedHR} · ${stats.pointsHR}pt</div></div>
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
    <thead><tr><th>Cat</th><th>Diff</th><th>Title</th><th>Status</th><th>Pts</th><th>Assignees</th><th>Tags</th></tr></thead>
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

function RosterModal({ roster, settings, challenges, subsRemaining, onClose, onSaveRoster, onSaveSettings, onClearAll }) {
  const [newName, setNewName] = useState('');
  const [eventName, setEventName] = useState(settings.eventName || '');
  const [tab, setTab] = useState('competition');

  const add = () => {
    const n = newName.trim();
    if (!n || roster.some(p => p.name === n)) return;
    onSaveRoster([...roster, { name: n, status: 'active', subbedOutAt: null }]);
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

  const opStats = useMemo(() => roster.map(p => {
    const assigned = challenges.filter(c => c.assignees.includes(p.name));
    const engaged = assigned.filter(c => c.status === 'in-progress' || c.status === 'stuck').length;
    const solved = assigned.filter(c => c.status === 'solved').length;
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

            <SectionLabel icon={<Target size={11} />}>COMPETITION DAY</SectionLabel>
            <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
              {Object.entries(COMP_DAYS).map(([k, d]) => {
                const on = settings.competitionDay === k;
                return (
                  <button key={k} onClick={() => onSaveSettings({ ...settings, competitionDay: k })} style={{
                    flex: 1, background: on ? `${d.color}15` : 'rgba(255,255,255,0.02)',
                    border: `1px solid ${on ? d.color : 'rgba(255,255,255,0.1)'}`,
                    color: on ? d.color : 'rgba(255,255,255,0.6)',
                    padding: '12px', borderRadius: 4, cursor: 'pointer',
                    fontFamily: '"Chakra Petch", sans-serif', fontSize: 13, fontWeight: 600,
                    letterSpacing: '0.1em', textTransform: 'uppercase',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  }}>
                    <span style={{ fontSize: 18 }}>{d.icon}</span> {d.label}
                  </button>
                );
              })}
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

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 18 }}>
              <div>
                <SectionLabel icon={<ShieldAlert size={11} />}>HUMAN RESISTANCE HOURS</SectionLabel>
                <Input type="number" min="0" max="24" step="0.5"
                  value={settings.hrHours ?? DEFAULT_HR_HOURS}
                  onChange={e => onSaveSettings({ ...settings, hrHours: parseFloat(e.target.value) || 0 })} />
              </div>
              <div>
                <SectionLabel icon={<Cpu size={11} />}>ROBOT UPRISING HOURS</SectionLabel>
                <Input type="number" min="0" max="24" step="0.5"
                  value={settings.ruHours ?? DEFAULT_RU_HOURS}
                  onChange={e => onSaveSettings({ ...settings, ruHours: parseFloat(e.target.value) || 0 })} />
              </div>
            </div>

            <div style={{
              padding: 12, background: 'rgba(212,168,67,0.05)', border: '1px solid rgba(212,168,67,0.2)',
              borderRadius: 3, fontSize: 12, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5,
            }}>
              <b style={{ color: '#d4a843' }}>ICC 2026 default:</b> 9-hour competition = 7h Human Resistance (simple AI only) + 2h Robot Uprising (approved AI permitted).
              On Jeopardy day, challenges solved during HR have their score locked at end-of-HR value.
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
                  <div key={op.name} style={{
                    display: 'grid', gridTemplateColumns: '1.6fr 0.8fr 0.7fr 0.7fr 0.7fr 110px',
                    padding: '10px 12px', borderTop: '1px solid rgba(255,255,255,0.05)',
                    fontSize: 13, alignItems: 'center', gap: 8,
                    opacity: op.status === 'subbed-out' ? 0.5 : 1,
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
              <button onClick={() => exportJSON({ challenges, roster, settings })} style={{
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
