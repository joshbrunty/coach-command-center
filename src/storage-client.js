const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

async function request(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(`Storage request failed (${response.status}): ${message}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

window.storage = {
  async list(prefix = '', shared = false) {
    const params = new URLSearchParams({
      prefix,
      shared: String(Boolean(shared)),
    });

    return request(`/api/storage?${params.toString()}`);
  },

  async get(key, shared = false) {
    const params = new URLSearchParams({
      shared: String(Boolean(shared)),
    });

    return request(`/api/storage/${encodeURIComponent(key)}?${params.toString()}`);
  },

  async set(key, value, shared = false) {
    return request(`/api/storage/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ value, shared: Boolean(shared) }),
    });
  },

  async delete(key, shared = false) {
    const params = new URLSearchParams({
      shared: String(Boolean(shared)),
    });

    return request(`/api/storage/${encodeURIComponent(key)}?${params.toString()}`, {
      method: 'DELETE',
    });
  },
};
