const LIVE_SNAPSHOT_ID = 'platform-snapshot:icc-live';

export { LIVE_SNAPSHOT_ID };

export async function fetchIccStatus() {
  const res = await fetch('/api/icc/status');
  if (!res.ok) return { configured: false };
  return res.json();
}

export async function fetchIccBundle() {
  const res = await fetch('/api/icc/bundle');
  if (!res.ok) {
    let message = `ICC sync failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json();
}
