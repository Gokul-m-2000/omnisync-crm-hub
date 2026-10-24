// test/server.test.js
// ---------------------------------------------------------------------------
// Run with:  npm test
//
// These are real HTTP calls against the app on a random port. No extra
// libraries, just the test runner that ships with Node.
// ---------------------------------------------------------------------------

process.env.DEMO_MODE = 'true';
process.env.N8N_WEBHOOK_SECRET = 'test-secret';
process.env.CORS_ORIGINS = 'http://localhost:3001';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { app } = require('../server');

let server;
let base;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.closeAllConnections?.();
  server.close();
});

async function call(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

test('health reports demo mode', async () => {
  const { status, body } = await call('/api/health');
  assert.equal(status, 200);
  assert.equal(body.status, 'healthy');
  assert.equal(body.mode, 'demo');
});

test('leads come back with metrics', async () => {
  const { status, body } = await call('/api/leads');
  assert.equal(status, 200);
  assert.ok(body.leads.length >= 4);
  assert.equal(body.metrics.totalLeads, body.leads.length);
  assert.equal(typeof body.metrics.syncHealth, 'number');
});

test('unknown lead returns 404 JSON, not HTML', async () => {
  const { status, body } = await call('/api/leads/nope');
  assert.equal(status, 404);
  assert.match(body.error, /not found/i);
});

test('sync without leadId returns 400', async () => {
  const { status } = await call('/api/sync', { method: 'POST', body: '{}' });
  assert.equal(status, 400);
});

test('syncing a real lead creates a completed run in demo mode', async () => {
  const { status, body } = await call('/api/sync', {
    method: 'POST',
    body: JSON.stringify({ leadId: 'lead_002' }),
  });

  assert.equal(status, 200);
  assert.equal(body.run.status, 'synced');
  assert.equal(body.run.mode, 'demo');
  assert.match(body.run.message, /DEMO_MODE/);

  const leads = await call('/api/leads');
  const lead = leads.body.leads.find((item) => item.id === 'lead_002');
  assert.equal(lead.status, 'synced');
  assert.ok(lead.lastSync);
});

test('run history is newest first and capped', async () => {
  const { status, body } = await call('/api/runs?limit=10');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.runs));
  assert.ok(body.runs.length <= 10);
});

test('callback rejects a bad secret', async () => {
  const { status } = await call('/api/webhooks/n8n', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': 'wrong' },
    body: JSON.stringify({ runId: 'run_x', status: 'synced' }),
  });
  assert.equal(status, 401);
});

test('callback is idempotent for an already finished run', async () => {
  const started = await call('/api/sync', {
    method: 'POST',
    body: JSON.stringify({ leadId: 'lead_001' }),
  });
  const runId = started.body.run.id;

  const first = await call('/api/webhooks/n8n', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': 'test-secret' },
    body: JSON.stringify({ runId, status: 'failed', message: 'late retry' }),
  });

  // The run finished in demo mode already, so a late callback must not
  // overwrite history. This is what stops retries corrupting the audit log.
  assert.equal(first.status, 200);
  assert.equal(first.body.duplicate, true);
  assert.equal(first.body.run.status, 'synced');
});

test('creating a lead validates its input', async () => {
  const bad = await call('/api/leads', { method: 'POST', body: JSON.stringify({ name: 'x' }) });
  assert.equal(bad.status, 400);

  const good = await call('/api/leads', {
    method: 'POST',
    body: JSON.stringify({ name: 'Priya Nair', company: 'Northwind', email: 'p@northwind.io', dealValue: 5000 }),
  });
  assert.equal(good.status, 201);
  assert.equal(good.body.status, 'pending');
});
