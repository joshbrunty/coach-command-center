const ICC_API_BASE_URL = (process.env.ICC_API_BASE_URL || 'https://api.icc2026.metactf.io').replace(/\/$/, '');
const ICC_API_PREFIX = '/integrations/icc/v1';
const ICC_COACH_TOKEN = process.env.ICC_COACH_TOKEN || process.env.METACTF_API_TOKEN || '';

export function isIccConfigured() {
  return Boolean(ICC_COACH_TOKEN);
}

export async function iccFetch(path) {
  if (!ICC_COACH_TOKEN) {
    const err = new Error('ICC coach token is not configured');
    err.status = 503;
    throw err;
  }

  const url = `${ICC_API_BASE_URL}${ICC_API_PREFIX}${path}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${ICC_COACH_TOKEN}`,
    },
  });

  let body = null;
  const text = await res.text();
  if (text) {
    try { body = JSON.parse(text); }
    catch { body = text; }
  }

  if (!res.ok) {
    const detail = typeof body === 'object' && body != null
      ? (body.detail || body.message || body.error)
      : body;
    const err = new Error(detail ? String(detail) : `ICC API ${res.status} for ${path}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }

  return body;
}

export async function fetchIccBundle() {
  const [me, competition, scoreboard, challengesSolves, feed, timeline] = await Promise.all([
    iccFetch('/me'),
    iccFetch('/competition'),
    iccFetch('/scoreboard'),
    iccFetch('/challenges/solves'),
    iccFetch('/feed'),
    iccFetch('/scoreboard/timeline'),
  ]);

  return {
    me,
    competition,
    scoreboard,
    challengesSolves,
    feed,
    timeline,
    fetchedAt: Date.now(),
  };
}
