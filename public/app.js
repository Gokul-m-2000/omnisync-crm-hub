// public/app.js
// ---------------------------------------------------------------------------
// The dashboard. It does four things and nothing else:
//   1. Ask the API for leads + runs
//   2. Remember the answer in a variable
//   3. Put it on the screen safely
//   4. Send a sync request when a button is clicked
//
// Safety rule used everywhere below: data from the API is written with
// textContent / createElement, never innerHTML. That is what stops XSS.
// ---------------------------------------------------------------------------

const API_BASE = (window.APP_CONFIG && window.APP_CONFIG.API_URL) || '';

const state = {
  leads: [],
  runs: [],
  health: null,
  search: '',
  statusFilter: 'ALL',
};

let pollTimer = null;

// ---------------------------------------------------------------------------
// Tiny DOM helper: el('td', { class: 'px-6' }, 'hello')
// Children are inserted as TEXT, so they can never become HTML.
// ---------------------------------------------------------------------------
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value);
  }

  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }

  return node;
}

// ---------------------------------------------------------------------------
// API helper: one place that knows how to fetch and how to fail honestly.
// ---------------------------------------------------------------------------
async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  const raw = await response.text();
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = { error: raw.slice(0, 200) };
  }

  if (!response.ok) {
    const error = new Error((body && (body.error || body.detail)) || `Request failed (${response.status})`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-sync-all').addEventListener('click', syncAll);
  document.getElementById('btn-refresh-runs').addEventListener('click', refresh);
  document.getElementById('btn-retry').addEventListener('click', loadAll);

  const search = document.getElementById('search-input');
  search.addEventListener('input', () => {
    state.search = search.value.toLowerCase().trim();
    renderLeads();
  });

  const filter = document.getElementById('status-filter');
  filter.addEventListener('change', () => {
    state.statusFilter = filter.value;
    renderLeads();
  });

  // One listener for every "Sync now" button, including future rows.
  document.getElementById('leads-table-body').addEventListener('click', (event) => {
    const button = event.target.closest('[data-sync-lead]');
    if (button && !button.disabled) syncOne(button.dataset.syncLead);
  });

  loadAll();
  if (window.lucide) lucide.createIcons();
});

async function loadAll() {
  setConnection('checking');

  try {
    const health = await api('/api/health');
    state.health = health;
    setConnection(health.mode === 'demo' ? 'demo' : 'live', health);
  } catch (error) {
    setConnection('down', error);
  }

  await refresh();

  if (window.lucide) lucide.createIcons();
}

async function refresh() {
  const results = await Promise.allSettled([api('/api/leads'), api('/api/runs?limit=25')]);

  if (results[0].status === 'fulfilled') {
    state.leads = results[0].value.leads || [];
    renderMetrics(results[0].value.metrics);
    renderLeads();
    hideBanner();
  } else {
    // No fake data here. If the API is down, the client sees the truth.
    showBanner(`Cannot load leads: ${results[0].reason.message}`, results[0].reason);
  }

  if (results[1].status === 'fulfilled') {
    state.runs = results[1].value.runs || [];
    renderRuns();
    maybePoll();
  } else {
    showBanner(`Cannot load run history: ${results[1].reason.message}`);
  }

  if (window.lucide) lucide.createIcons();
}

// ---------------------------------------------------------------------------
// Sync actions
// ---------------------------------------------------------------------------
async function syncOne(leadId) {
  const button = document.querySelector(`[data-sync-lead="${leadId}"]`);
  if (button) button.disabled = true;

  try {
    const result = await api('/api/sync', {
      method: 'POST',
      body: JSON.stringify({ leadId }),
    });
    showToast(result.message || 'Sync started');
  } catch (error) {
    // 409 = already syncing. That is not really an error, but say so.
    showToast(error.message, error.status !== 409);
  }

  await refresh();
  if (button) button.disabled = false;
}

async function syncAll() {
  const button = document.getElementById('btn-sync-all');
  const icon = document.getElementById('sync-icon');
  button.disabled = true;
  icon.classList.add('animate-spin');

  // Retry everything that is not already in flight.
  const pending = state.leads.filter((lead) => lead.status !== 'running');

  if (pending.length === 0) {
    showToast('Nothing to sync right now', true);
  } else {
    showToast(`Syncing ${pending.length} lead(s)...`);
    for (const lead of pending) {
      try {
        await api('/api/sync', { method: 'POST', body: JSON.stringify({ leadId: lead.id }) });
      } catch (error) {
        showToast(`${lead.name}: ${error.message}`, true);
      }
    }
  }

  await refresh();
  icon.classList.remove('animate-spin');
  button.disabled = false;
}

// If n8n is still working, check back every few seconds until it answers.
function maybePoll() {
  clearInterval(pollTimer);

  if (!state.runs.some((run) => run.status === 'running')) return;

  let attempts = 0;
  pollTimer = setInterval(async () => {
    attempts += 1;
    if (attempts > 20) {
      clearInterval(pollTimer);
      return;
    }
    await refresh();
    if (!state.runs.some((run) => run.status === 'running')) clearInterval(pollTimer);
  }, 3000);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function renderMetrics(metrics) {
  if (!metrics) return;

  document.getElementById('metric-pipeline').textContent = formatMoney(metrics.totalPipelineValue);
  document.getElementById('metric-total-leads').textContent = metrics.totalLeads ?? 0;
  document.getElementById('metric-synced').textContent = metrics.syncedCount ?? 0;
  document.getElementById('metric-sync-health').textContent = `${metrics.syncHealth ?? 0}% sync rate`;
  document.getElementById('metric-pending').textContent = metrics.pendingCount ?? 0;
  document.getElementById('metric-failed-sub').textContent = `${metrics.failedCount ?? 0} failed · ${metrics.runningCount ?? 0} running`;
}

function renderLeads() {
  const tbody = document.getElementById('leads-table-body');
  tbody.replaceChildren();

  const filtered = state.leads.filter((lead) => {
    const haystack = `${lead.name} ${lead.company} ${lead.email}`.toLowerCase();
    return haystack.includes(state.search)
      && (state.statusFilter === 'ALL' || lead.status === state.statusFilter);
  });

  if (filtered.length === 0) {
    tbody.append(
      el('tr', {},
        el('td', { colspan: '6', class: 'px-6 py-8 text-center text-slate-500' },
          state.leads.length === 0 ? 'No leads yet. Is the API running?' : 'No leads match this filter.')),
    );
    return;
  }

  for (const lead of filtered) {
    const button = el('button', {
      class: `px-3 py-1.5 rounded-md text-[11px] font-medium border transition-all ${
        lead.status === 'running'
          ? 'bg-slate-900 text-slate-500 border-slate-800 cursor-not-allowed'
          : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700/60 active:scale-95'
      }`,
      'data-sync-lead': lead.id,
      title: lead.status === 'running' ? 'Already syncing' : 'Send this lead to n8n',
    }, lead.status === 'running' ? 'Syncing...' : 'Sync now');
    button.disabled = lead.status === 'running';

    tbody.append(
      el('tr', { class: 'hover:bg-slate-800/30 transition-colors' },
        el('td', { class: 'px-6 py-4' },
          el('div', { class: 'font-medium text-white' }, lead.name),
          el('div', { class: 'text-slate-400 text-[11px]' }, lead.email)),
        el('td', { class: 'px-6 py-4 text-slate-300 font-medium' }, lead.company),
        el('td', { class: 'px-6 py-4 font-semibold text-slate-100' }, formatMoney(lead.dealValue)),
        el('td', { class: 'px-6 py-4' }, statusBadge(lead.status)),
        el('td', { class: 'px-6 py-4 text-slate-400 text-[11px]' }, formatDate(lead.lastSync)),
        el('td', { class: 'px-6 py-4 text-right' }, button),
      ),
    );
  }
}

function renderRuns() {
  const tbody = document.getElementById('runs-table-body');
  tbody.replaceChildren();

  if (state.runs.length === 0) {
    tbody.append(
      el('tr', {},
        el('td', { colspan: '6', class: 'px-6 py-8 text-center text-slate-500' },
          'No sync attempts yet. Click "Sync now" to create one.')),
    );
    return;
  }

  for (const run of state.runs) {
    tbody.append(
      el('tr', { class: 'hover:bg-slate-800/30 transition-colors' },
        el('td', { class: 'px-6 py-3 font-mono text-[11px] text-slate-400' }, run.id),
        el('td', { class: 'px-6 py-3 text-slate-300' }, run.leadName || run.leadId),
        el('td', { class: 'px-6 py-3' },
          statusBadge(run.status),
          run.mode === 'demo' ? el('span', { class: 'ml-2 text-[10px] uppercase tracking-wider text-amber-400' }, 'demo') : null),
        el('td', { class: 'px-6 py-3 text-slate-400 text-[11px]' }, duration(run)),
        el('td', { class: 'px-6 py-3 text-slate-400 text-[11px] max-w-md' }, run.message || ''),
        el('td', { class: 'px-6 py-3 text-slate-400 text-[11px]' }, formatDate(run.startedAt)),
      ),
    );
  }
}

function statusBadge(status) {
  const styles = {
    synced: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    pending: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    running: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
    failed: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  };
  const label = { synced: 'Synced', pending: 'Pending', running: 'Running', failed: 'Failed' }[status] || status;

  return el('span', {
    class: `inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border ${styles[status] || styles.pending}`,
  },
    el('span', { class: `w-1.5 h-1.5 rounded-full bg-current ${status === 'running' || status === 'pending' ? 'animate-pulse' : ''}` }),
    label);
}

// ---------------------------------------------------------------------------
// Connection state, banner, toast
// ---------------------------------------------------------------------------
function setConnection(kind, detail) {
  const pill = document.getElementById('server-status-pill');
  const dot = document.getElementById('server-status-dot');
  const text = {
    checking: ['Checking API...', 'bg-slate-400'],
    live: ['Live · n8n connected', 'bg-emerald-400'],
    demo: ['Demo mode · n8n not called', 'bg-amber-400'],
    down: ['API unreachable', 'bg-rose-400'],
  }[kind];

  pill.textContent = text[0];
  dot.className = `w-2 h-2 rounded-full ${text[1]}`;

  if (kind === 'demo' && detail) {
    showBanner(
      'DEMO_MODE is on: clicking Sync simulates the result. Set DEMO_MODE=false in .env to call the real n8n webhook.',
      null,
      'info',
    );
  }
  if (kind === 'down') {
    showBanner(`Cannot reach the API${API_BASE ? ` at ${API_BASE}` : ''}: ${detail.message}`, detail);
  }
}

function showBanner(message, error, tone = 'error') {
  const banner = document.getElementById('error-banner');
  const text = document.getElementById('error-banner-text');
  text.textContent = message;
  banner.dataset.tone = tone;
  banner.classList.toggle('border-rose-500/30', tone === 'error');
  banner.classList.toggle('bg-rose-500/10', tone === 'error');
  banner.classList.toggle('border-amber-500/30', tone === 'info');
  banner.classList.toggle('bg-amber-500/10', tone === 'info');
  banner.classList.remove('hidden');

  if (error && error.status === 0) console.warn(error);
}

function hideBanner() {
  const banner = document.getElementById('error-banner');
  if (banner.dataset.tone === 'info') return; // keep the demo warning visible
  banner.classList.add('hidden');
}

let toastTimer = null;
function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  document.getElementById('toast-message').textContent = message;
  toast.dataset.tone = isError ? 'error' : 'ok';
  toast.classList.remove('hidden');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 4000);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
function formatMoney(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function formatDate(value) {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function duration(run) {
  if (!run.finishedAt) return 'in flight';
  const ms = new Date(run.finishedAt) - new Date(run.startedAt);
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}
