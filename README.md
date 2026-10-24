# OmniSync — a practice project for Vercel + Railway + n8n

A small, complete example of the thing your company actually sells:

```
Browser (Vercel)  ──POST /api/sync──▶  API (Railway)  ──webhook──▶  n8n  ──▶  CRM
                                            ▲                        │
                                            └──── callback ──────────┘
```

**The one rule this project exists to teach:** the dashboard never decides that a
sync worked. Only n8n's answer can mark a lead `synced`. If n8n is down, the UI
says so instead of inventing a success.

That single rule is the difference between a demo and something you can bill for.

---

## 1. What is real and what is still a placeholder

| Piece | Status |
|---|---|
| Browser → Railway API (HTTP, CORS, validation) | ✅ real |
| API → n8n webhook (timeout, secret header, idempotency key) | ✅ real |
| n8n → API callback (secret check, idempotent) | ✅ real |
| Run history + honest error messages | ✅ real |
| CRM write | ⚠️ simulated inside the n8n Code node — swap in HubSpot / Sheets there |
| Database | ⚠️ in-memory (Railway Postgres is the next step) |
| Login / multi-tenant | ❌ not included — see "before a real client" |

---

## 2. Run it locally (3 commands)

You need Node 20+.

```bash
npm install
npm start
```

Open <http://localhost:3001>.

The first run has `DEMO_MODE=true` in `.env`, so clicking **Sync now** works
without n8n and shows a clear "demo" label. That is intentional: a working demo
that tells the truth about being a demo.

Run the tests:

```bash
npm test
```

---

## 3. Connect a real n8n

### Option A — import the workflow

1. Start n8n locally: `npx n8n` (you already have Node 22)
2. Open <http://localhost:5678>
3. Top-right menu → **Import from File** → choose `n8n/crm-sync.workflow.json`
4. Open the **Webhook** node and click **Test workflow**
5. Copy the **Test URL** (it looks like `http://localhost:5678/webhook-test/crm-sync`)

### Option B — build it by hand (3 nodes, 2 minutes)

1. **Webhook** node → Method `POST`, Path `crm-sync`, Respond `Immediately`
2. **Code** node → paste the body from the Code node in the JSON file
3. **HTTP Request** node → POST to `http://localhost:3001/api/webhooks/n8n`
   with header `X-Webhook-Secret: dev-secret-change-me` and JSON body
   `={{ JSON.stringify($json) }}`

### Point the app at n8n

In `.env`:

```ini
N8N_WEBHOOK_URL=http://localhost:5678/webhook-test/crm-sync
DEMO_MODE=false
```

Restart `npm start`, then click **Sync now**.

> **Gotcha that costs everyone an hour:** n8n's **Test URL only listens once**
> after you click "Test workflow". If you take too long, the first request
> works and the next one 404s. For stable testing, **activate** the workflow and
> use the **Production URL** (`/webhook/crm-sync`).

> **Docker gotcha:** if n8n runs in Docker and the API runs on your laptop,
> the callback URL must be `http://host.docker.internal:3001/api/webhooks/n8n`,
> not `localhost`.

### What you should see

1. The lead goes `pending → running`.
2. n8n's **Executions** tab shows one successful run.
3. Within ~3 seconds the dashboard polls `/api/runs`, shows `Synced`, and the
   row's "Took" column shows the real duration.

Then break it on purpose: stop n8n, click Sync again. The run must say
`failed — Cannot reach n8n (ECONNREFUSED)`. **That is the feature.** Most
dashboards hide this; yours should not.

---

## 4. The contract between the API and n8n

**API → n8n** (what your workflow receives):

```json
{
  "runId": "run_9f3a12bc",
  "lead": {
    "id": "lead_002",
    "name": "Marcus Vance",
    "company": "Vance Logistics",
    "email": "m.vance@vancelog.com",
    "dealValue": 34000,
    "status": "running"
  }
}
```

Headers: `X-Webhook-Secret`, `X-Idempotency-Key: <runId>`.

**n8n → API** (the callback):

```json
{ "runId": "run_9f3a12bc", "status": "synced", "message": "Created contact 88421" }
```

`status` must be `synced` or `failed`. A duplicate callback is accepted and
ignored, so n8n retries can never overwrite finished history.

The API can also accept a final result in the *first* HTTP response (that is
why the demo workflow works without an explicit callback). Both styles are
supported; the callback is the one that survives long-running workflows.

---

## 5. Project structure

```
server.js                  the bridge: API + n8n + run log
public/
  index.html               dashboard markup
  app.js                   fetch → state → render (safe DOM, no innerHTML)
  config.js                the ONE place the API URL lives
test/server.test.js        real HTTP tests, no extra libraries
n8n/crm-sync.workflow.json importable workflow
backend/                   legacy Python version — unused, safe to delete
```

---

## 6. Deploy: Railway (API) + Vercel (frontend)

### Railway — the API

1. **New Project → Deploy from GitHub repo**
2. Start command: `npm start` (Railway sets `PORT` automatically)
3. Healthcheck path: `/api/health`
4. Variables:

```ini
N8N_WEBHOOK_URL=https://your-n8n-host/webhook/crm-sync
N8N_WEBHOOK_SECRET=<long random string>
CORS_ORIGINS=https://your-project.vercel.app
DEMO_MODE=false
```

5. Copy the public domain, e.g. `https://omnisync-api.up.railway.app`

**Important:** Railway cannot reach `http://localhost:5678`. Your n8n must be
publicly reachable too — host it on Railway, a VPS, or use n8n Cloud. This is
the same constraint every client project has.

### Vercel — the dashboard

1. **Add New Project → import the repo**
2. Framework preset: **Other**
3. Output directory: `public` (already set in `vercel.json`)
4. Edit `public/config.js` before deploying:

```js
window.APP_CONFIG = { API_URL: "https://omnisync-api.up.railway.app" };
```

5. Deploy, then add the Vercel URL to `CORS_ORIGINS` on Railway and redeploy.

> Plain static HTML cannot read Vercel environment variables. That is one of
> several reasons real projects move to **Vite + React**, where
> `import.meta.env.VITE_API_URL` is baked in at build time. When you make that
> move, delete `config.js` and use the Vite env variable instead.

---

## 7. Before a real client (the honest checklist)

This repo is a good *practice* project. It is not client-ready until:

- [ ] **Login.** One user per client, or at least one password. Right now anyone
      with the URL can press Sync.
- [ ] **Postgres.** Railway → add PostgreSQL → move `leads` and `runs` into it.
      In-memory dies on every redeploy.
- [ ] **Rate limiting** on `/api/sync` and the callback.
- [ ] **HMAC signatures** instead of a static shared secret (n8n Code node:
      `crypto.createHmac('sha256', secret).update(rawBody).digest('hex')`).
- [ ] **Real CRM credentials only inside n8n**, never in this repo, never in the
      browser, never in Vercel env vars.
- [ ] **Pagination** on `/api/leads` once there are more than a few hundred rows.
- [ ] **Background retries**: a run stuck in `running` should be marked
      `timed out` by a scheduled job (n8n can call a `/api/runs/:id/timeout`).
- [ ] **Backups + a support window** written into the contract.
- [ ] **Handover pack**: README, `.env.example`, n8n workflow export, a 10-minute
      screen recording, and who owns which credential.

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Cannot reach n8n (ECONNREFUSED)` | n8n not running, or wrong URL | Start n8n, check the port in `N8N_WEBHOOK_URL` |
| First sync works, second 404s | You used n8n's **Test URL** | Activate the workflow and use the **Production URL** |
| `401 Invalid webhook secret` | Secret differs between `.env` and the HTTP Request node | Make both identical |
| `CORS error` in the browser console | Vercel domain missing from `CORS_ORIGINS` | Add the exact origin, no trailing slash |
| Run stuck on `running` | The workflow never called back | Check n8n → Executions; the callback node probably failed |
| Dashboard says "API unreachable" | `config.js` still empty on Vercel | Put the Railway URL in `config.js` and redeploy |

---

## 9. Glossary (the words used in this repo)

- **API** — a set of URLs the dashboard can call (`/api/leads`, `/api/sync`).
- **Webhook** — a URL you POST to in order to *trigger* something. Your n8n
  webhook is a phone number for a workflow.
- **Callback** — the reverse: n8n calls *your* URL to report the result.
- **Run** — one attempt to sync one lead. Runs are the audit trail.
- **Idempotent** — safe to call twice. A duplicate callback returns
  `duplicate: true` instead of double-writing.
- **DEMO_MODE** — a visible, honest simulation. Not a hidden fake.
- **CORS** — the browser rule that decides which websites may call this API.
- **Port** — a numbered door on your machine (`3001` API, `5678` n8n).
- **Environment variable** — a setting kept outside the code, in `.env`.

---

## 10. The 20-minute exercise that makes this stick

1. Run the app in `DEMO_MODE`. Click Sync. Find the run in **Sync runs**.
2. Read `server.js` from `POST /api/sync` to `finishRun`. Say out loud where the
   word "synced" comes from.
3. Set `DEMO_MODE=false` with n8n stopped. Click Sync. Watch it fail honestly.
4. Start n8n, activate the workflow, click Sync. Watch it succeed.
5. Change the secret in `.env` only. Click Sync. Watch the callback get `401`.
   That is the security control working.

If you can explain those five steps to your lead, you understand the project
better than most people who ship dashboards.
