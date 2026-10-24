// server.js
// ---------------------------------------------------------------------------
// This is the "brain" of the demo.
//
//   Browser (Vercel)  --POST /api/sync-->  THIS SERVER  --webhook-->  n8n
//   n8n              --POST /api/webhooks/n8n-->  THIS SERVER  -->  Browser
//
// The golden rule: this server NEVER marks a lead as "synced" by itself.
// It only trusts an answer that came back from n8n.
//
// n8n is where HubSpot / Salesforce / Sheets / WhatsApp calls belong.
// This file deliberately knows nothing about any CRM.
// ---------------------------------------------------------------------------

require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

// ---------------------------------------------------------------------------
// 1. Configuration - everything sensitive comes from .env, never the code
// ---------------------------------------------------------------------------
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || '';
const WEBHOOK_SECRET = process.env.N8N_WEBHOOK_SECRET || '';
const DEMO_MODE = process.env.DEMO_MODE === 'true';
const N8N_TIMEOUT_MS = Number(process.env.N8N_TIMEOUT_MS || 15000);

// Allowed origins for browser calls. Defaults include local dev and your Vercel domain.
const defaultOrigins = [
  'http://localhost:3001',
  'http://localhost:5173',
  'https://omnisync-crm-hub-public.vercel.app',
];
const envOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = envOrigins.length > 0 ? envOrigins : defaultOrigins;

app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser requests (e.g. n8n webhooks, curl, Postman) where origin is undefined
    if (!origin) return callback(null, true);
    if (
      allowedOrigins.includes('*') ||
      allowedOrigins.includes(origin) ||
      origin.endsWith('.vercel.app')
    ) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
}));
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// 2. Storage
//    In-memory for practice. On Railway you would replace this with Postgres
//    (one table for leads, one for runs). Everything else stays the same.
// ---------------------------------------------------------------------------
let leads = [
  {
    id: 'lead_001',
    name: 'Sarah Chen',
    company: 'Apex Technologies',
    email: 'sarah.chen@apextech.io',
    dealValue: 18500,
    status: 'synced',
    lastSync: '2026-10-21T10:15:00Z',
  },
  {
    id: 'lead_002',
    name: 'Marcus Vance',
    company: 'Vance Logistics',
    email: 'm.vance@vancelog.com',
    dealValue: 34000,
    status: 'pending',
    lastSync: null,
  },
  {
    id: 'lead_003',
    name: 'Elena Rostova',
    company: 'Nordic AI Labs',
    email: 'elena@nordicai.se',
    dealValue: 12000,
    status: 'synced',
    lastSync: '2026-10-21T11:45:00Z',
  },
  {
    id: 'lead_004',
    name: 'Devon Brooks',
    company: 'Horizon Retail Group',
    email: 'devon@horizonretail.com',
    dealValue: 8200,
    status: 'failed',
    lastSync: '2026-10-21T08:30:00Z',
  },
];

// A log of every sync attempt. This is the audit trail a client actually pays for.
const runs = new Map();
const MAX_RUNS = 200;

const nowIso = () => new Date().toISOString();

function metrics() {
  const total = leads.length;
  const count = (status) => leads.filter((lead) => lead.status === status).length;
  const synced = count('synced');

  return {
    totalLeads: total,
    syncedCount: synced,
    pendingCount: count('pending'),
    failedCount: count('failed'),
    runningCount: count('running'),
    totalPipelineValue: leads.reduce((sum, lead) => sum + Number(lead.dealValue || 0), 0),
    syncHealth: total > 0 ? Math.round((synced / total) * 100) : 0,
  };
}

function createRun(lead) {
  const run = {
    id: `run_${crypto.randomBytes(4).toString('hex')}`,
    leadId: lead.id,
    leadName: lead.name,
    status: 'running',
    mode: DEMO_MODE ? 'demo' : 'live',
    message: 'Sent to n8n, waiting for the callback...',
    startedAt: nowIso(),
    finishedAt: null,
  };

  runs.set(run.id, run);

  // Keep the log from growing forever in memory.
  if (runs.size > MAX_RUNS) runs.delete(runs.keys().next().value);

  lead.status = 'running';
  return run;
}

// Only n8n (or DEMO_MODE) may finish a run. Calling this twice is safe:
// the second call changes nothing, which is what "idempotent" means.
function finishRun(runId, status, message) {
  const run = runs.get(runId);
  if (!run) return null;
  if (run.status !== 'running') return run;

  run.status = status;
  run.message = message || (status === 'synced' ? 'Synced by n8n' : 'Failed');
  run.finishedAt = nowIso();

  const lead = leads.find((item) => item.id === run.leadId);
  if (lead) {
    lead.status = status;
    if (status === 'synced') lead.lastSync = run.finishedAt;
  }

  return run;
}

// Compare two secrets in constant time without leaking secret length via response timing.
function secretsMatch(a, b) {
  if (!a || !b) return false;
  const hashA = crypto.createHash('sha256').update(String(a)).digest();
  const hashB = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function describeFetchError(error) {
  if (error.name === 'AbortError') return `n8n did not answer within ${N8N_TIMEOUT_MS} ms`;
  if (error.cause && error.cause.code) return `Cannot reach n8n (${error.cause.code})`;
  return error.message || 'Unknown network error';
}

// ---------------------------------------------------------------------------
// 3. Health
// ---------------------------------------------------------------------------
function healthHandler(req, res) {
  res.json({
    status: 'healthy',
    service: 'OmniSync bridge',
    // "demo" means the sync button clicks never leave this process.
    mode: DEMO_MODE ? 'demo' : 'live',
    n8nConfigured: Boolean(N8N_WEBHOOK_URL),
    uptime: Math.floor(process.uptime()),
    timestamp: nowIso(),
  });
}

app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

// ---------------------------------------------------------------------------
// 4. Leads (the read side of the dashboard)
// ---------------------------------------------------------------------------
app.get('/api/leads', (req, res) => {
  res.json({ metrics: metrics(), leads });
});

app.get('/api/leads/:leadId', (req, res) => {
  const lead = leads.find((item) => item.id === req.params.leadId);
  if (!lead) return res.status(404).json({ error: `Lead '${req.params.leadId}' not found` });
  res.json(lead);
});

// Used by the practice demo only. A real client's leads come from the CRM via n8n.
app.post('/api/leads', (req, res) => {
  const { name, company, email, dealValue = 0, status = 'pending' } = req.body || {};

  if (![name, company, email].every((value) => typeof value === 'string' && value.trim())) {
    return res.status(400).json({ error: 'name, company and email are required' });
  }
  if (typeof dealValue !== 'number' || dealValue < 0) {
    return res.status(400).json({ error: 'dealValue must be a positive number' });
  }
  if (!['pending', 'synced', 'failed'].includes(status)) {
    return res.status(400).json({ error: 'status must be pending, synced or failed' });
  }

  const nextNumber = leads.length + 1;
  const lead = {
    id: `lead_${String(nextNumber).padStart(3, '0')}`,
    name: name.trim(),
    company: company.trim(),
    email: email.trim(),
    dealValue,
    status,
    lastSync: null,
  };

  leads.push(lead);
  res.status(201).json(lead);
});

// ---------------------------------------------------------------------------
// 5. Trigger a sync  (Browser -> this server -> n8n)
// ---------------------------------------------------------------------------
app.post('/api/sync', async (req, res) => {
  const { leadId } = req.body || {};
  if (typeof leadId !== 'string' || !leadId) {
    return res.status(400).json({ error: 'leadId is required' });
  }

  const lead = leads.find((item) => item.id === leadId);
  if (!lead) return res.status(404).json({ error: `Lead '${leadId}' not found` });

  const alreadyRunning = [...runs.values()].find(
    (run) => run.leadId === lead.id && run.status === 'running',
  );
  if (alreadyRunning) {
    return res.status(409).json({ error: 'This lead is already syncing', run: alreadyRunning });
  }

  const run = createRun(lead);

  // DEMO_MODE is the only place allowed to invent a success.
  // It is always labelled "demo" in the UI, so nobody is misled.
  if (DEMO_MODE) {
    const finished = finishRun(
      run.id,
      'synced',
      'Simulated: DEMO_MODE is on, n8n was never called',
    );
    return res.status(200).json({
      success: true,
      demo: true,
      message: 'Demo sync complete (n8n was not called)',
      run: finished,
    });
  }

  if (!N8N_WEBHOOK_URL) {
    const failed = finishRun(run.id, 'failed', 'N8N_WEBHOOK_URL is not set');
    return res.status(503).json({ success: false, error: 'N8N_WEBHOOK_URL is not set', run: failed });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), N8N_TIMEOUT_MS);

  try {
    const response = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': WEBHOOK_SECRET,
        'X-Idempotency-Key': run.id,
      },
      // n8n needs the runId so it can report back later.
      body: JSON.stringify({ runId: run.id, lead }),
      signal: controller.signal,
    });

    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`n8n answered ${response.status}: ${raw.slice(0, 200)}`);
    }

    // If the workflow answers with a final result, use it.
    // If it answers "accepted" and calls us back later, the run stays running.
    let payload = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      payload = {};
    }

    if (payload.status === 'synced' || payload.status === 'failed') {
      const finished = finishRun(run.id, payload.status, payload.message);
      return res.status(200).json({
        success: payload.status === 'synced',
        message: finished.message,
        run: finished,
      });
    }

    return res.status(202).json({
      success: true,
      message: 'n8n accepted the job. Waiting for its callback...',
      run,
    });
  } catch (error) {
    const failed = finishRun(run.id, 'failed', describeFetchError(error));
    return res.status(502).json({
      success: false,
      error: failed.message,
      run: failed,
    });
  } finally {
    clearTimeout(timeout);
  }
});

// ---------------------------------------------------------------------------
// 6. n8n calls us back  (n8n -> this server)
//    This is the step the original prototype was missing entirely.
// ---------------------------------------------------------------------------
app.post('/api/webhooks/n8n', (req, res) => {
  if (!WEBHOOK_SECRET) {
    return res.status(503).json({ error: 'N8N_WEBHOOK_SECRET is not set on the server' });
  }

  const provided = req.get('X-Webhook-Secret') || '';
  if (!secretsMatch(provided, WEBHOOK_SECRET)) {
    return res.status(401).json({ error: 'Invalid webhook secret' });
  }

  const { runId, status, message } = req.body || {};
  if (typeof runId !== 'string' || !runId) {
    return res.status(400).json({ error: 'runId is required' });
  }
  if (!['synced', 'failed'].includes(status)) {
    return res.status(400).json({ error: "status must be 'synced' or 'failed'" });
  }

  const existing = runs.get(runId);
  if (!existing) return res.status(404).json({ error: `Run '${runId}' not found` });

  // Retries and double-sends are normal. A finished run is never overwritten.
  if (existing.status !== 'running') {
    return res.json({ ok: true, duplicate: true, run: existing });
  }

  const run = finishRun(runId, status, message);
  res.json({ ok: true, duplicate: false, run });
});

// ---------------------------------------------------------------------------
// 7. Run history (what the "Sync runs" table reads)
// ---------------------------------------------------------------------------
app.get('/api/runs', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 25, 100);
  const newestFirst = [...runs.values()].reverse().slice(0, limit);
  res.json({ runs: newestFirst });
});

// ---------------------------------------------------------------------------
// 8. Fallbacks
// ---------------------------------------------------------------------------
app.use('/api', (req, res) => {
  res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl}` });
});

app.use((error, req, res, next) => {
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  console.error(error);
  res.status(500).json({ error: 'Unexpected server error' });
});

// ---------------------------------------------------------------------------
// 9. Start
//    `if (require.main === module)` lets the tests import this file without
//    starting a real server on port 3001.
// ---------------------------------------------------------------------------
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  OmniSync bridge running on http://localhost:${PORT}`);
    console.log(`  Mode: ${DEMO_MODE ? 'DEMO (n8n is not called)' : 'LIVE'}`);
    console.log(`  n8n webhook: ${N8N_WEBHOOK_URL || 'NOT CONFIGURED'}`);
    console.log(`  Health: http://localhost:${PORT}/api/health\n`);
  });
}

module.exports = { app };
