import express from 'express';
import pg from 'pg';
import { fetchIccBundle, isIccConfigured } from './icc.js';

const { Pool } = pg;

const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL;
const APP_NAMESPACE = process.env.APP_NAMESPACE || 'coach-command-center';
const CORS_ORIGIN = process.env.CORS_ORIGIN;
const METACTF_API_BASE_URL = process.env.METACTF_API_BASE_URL;
const METACTF_API_TOKEN = process.env.METACTF_API_TOKEN;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: Number(process.env.PG_POOL_SIZE || 10),
});

const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

if (CORS_ORIGIN) {
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  });
}

function scopeFor(shared) {
  return shared === 'false' || shared === false ? 'local' : 'shared';
}

function namespaceFor(shared) {
  return `${APP_NAMESPACE}:${scopeFor(shared)}`;
}

async function migrate() {
  await pool.query(`
    create table if not exists storage_items (
      namespace text not null,
      key text not null,
      value text not null,
      updated_at timestamptz not null default now(),
      primary key (namespace, key)
    )
  `);
}

app.get('/health', async (_req, res, next) => {
  try {
    await pool.query('select 1');
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/storage', async (req, res, next) => {
  try {
    const prefix = String(req.query.prefix || '');
    const namespace = namespaceFor(req.query.shared);
    const result = await pool.query(
      `
        select key
        from storage_items
        where namespace = $1 and key like $2
        order by key asc
      `,
      [namespace, `${prefix}%`],
    );

    res.json({ keys: result.rows.map((row) => row.key) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/storage/:key', async (req, res, next) => {
  try {
    const namespace = namespaceFor(req.query.shared);
    const result = await pool.query(
      'select key, value, updated_at from storage_items where namespace = $1 and key = $2',
      [namespace, req.params.key],
    );

    if (result.rowCount === 0) return res.json(null);
    return res.json(result.rows[0]);
  } catch (error) {
    return next(error);
  }
});

app.put('/api/storage/:key', async (req, res, next) => {
  try {
    if (typeof req.body?.value !== 'string') {
      return res.status(400).json({ error: 'value must be a string' });
    }

    const namespace = namespaceFor(req.body.shared);
    const result = await pool.query(
      `
        insert into storage_items (namespace, key, value, updated_at)
        values ($1, $2, $3, now())
        on conflict (namespace, key)
        do update set value = excluded.value, updated_at = now()
        returning key, value, updated_at
      `,
      [namespace, req.params.key, req.body.value],
    );

    return res.json(result.rows[0]);
  } catch (error) {
    return next(error);
  }
});

app.delete('/api/storage/:key', async (req, res, next) => {
  try {
    const namespace = namespaceFor(req.query.shared);
    await pool.query(
      'delete from storage_items where namespace = $1 and key = $2',
      [namespace, req.params.key],
    );

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/icc/status', (_req, res) => {
  res.json({ configured: isIccConfigured() });
});

app.get('/api/icc/bundle', async (_req, res, next) => {
  try {
    if (!isIccConfigured()) {
      return res.status(503).json({
        error: 'ICC live sync is not configured',
        needs: ['ICC_COACH_TOKEN'],
      });
    }
    const bundle = await fetchIccBundle();
    return res.json(bundle);
  } catch (error) {
    return next(error);
  }
});

app.get('/api/platform/metactf/snapshot', async (_req, res) => {
  if (!METACTF_API_BASE_URL || !METACTF_API_TOKEN) {
    return res.status(501).json({
      error: 'MetaCTF platform adapter is not configured yet',
      needs: ['METACTF_API_BASE_URL', 'METACTF_API_TOKEN', 'Swagger/OpenAPI field mapping'],
      normalizedShape: {
        source: 'metactf',
        scoreboard: { ourRank: null, ourScore: null, gapAbove: null, gapBelow: null },
        challenges: [
          {
            platformId: 'string',
            title: 'string',
            category: 'web|pwn|crypto|re|forensics|ai|hardware|misc',
            currentPoints: 0,
            solveCount: 0,
            ourSolved: false,
            rankImpact: null,
          },
        ],
      },
    });
  }

  return res.status(501).json({
    error: 'MetaCTF adapter route is reserved; wire this to the Swagger/OpenAPI response once endpoint details are available',
  });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  const status = Number(error.status) || 500;
  const message = error.message || 'Internal server error';
  if (status >= 500) return res.status(500).json({ error: 'Internal server error' });
  return res.status(status).json({ error: message });
});

await migrate();

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Storage API listening on ${PORT}`);
});

function shutdown(signal) {
  console.log(`Received ${signal}, shutting down`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
