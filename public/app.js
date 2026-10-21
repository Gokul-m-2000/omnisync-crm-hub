// public/app.js - Modern Frontend Logic for CRM & n8n Dashboard

let allLeads = [];

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  fetchDashboardData();
  // Initialize Lucide icons
  if (window.lucide) {
    lucide.createIcons();
  }
});

// 1. Fetch live metrics and CRM leads from the backend API
async function fetchDashboardData() {
  try {
    const response = await fetch('/api/leads');
    if (!response.ok) throw new Error('Network response was not ok');
    
    const data = await response.json();
    allLeads = data.leads || [];
    
    updateMetrics(data.metrics);
    renderTable(allLeads);
  } catch (err) {
    console.error('Error fetching dashboard data:', err);
    document.getElementById('server-status-pill').textContent = 'Backend Offline';
    document.getElementById('server-status-pill').parentElement.classList.replace('border-slate-700/60', 'border-rose-500/50');
  }
}

// 2. Update the 4 KPI metric cards
function updateMetrics(metrics) {
  if (!metrics) return;

  // Format currency: 72700 -> $72,700
  const formattedPipeline = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(metrics.totalPipelineValue || 0);

  document.getElementById('metric-pipeline').textContent = formattedPipeline;
  document.getElementById('metric-total-leads').textContent = metrics.totalLeads || 0;
  document.getElementById('metric-synced').textContent = metrics.syncedCount || 0;
  document.getElementById('metric-sync-health').textContent = `${metrics.syncHealth}% sync rate`;
  document.getElementById('metric-pending').textContent = metrics.pendingCount || 0;
  document.getElementById('metric-failed-sub').textContent = `${metrics.failedCount} failed webhooks`;
}

// 3. Render the CRM leads table rows
function renderTable(leads) {
  const tbody = document.getElementById('leads-table-body');
  tbody.innerHTML = '';

  if (leads.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="px-6 py-8 text-center text-slate-500">
          No matching leads found.
        </td>
      </tr>
    `;
    return;
  }

  leads.forEach(lead => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-800/30 transition-colors group';

    // Status Badge config
    let statusBadge = '';
    if (lead.status === 'synced') {
      statusBadge = `
        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Synced
        </span>`;
    } else if (lead.status === 'pending') {
      statusBadge = `
        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
          <span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span> Pending
        </span>`;
    } else {
      statusBadge = `
        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20">
          <span class="w-1.5 h-1.5 rounded-full bg-rose-400"></span> Failed
        </span>`;
    }

    const formattedDeal = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(lead.dealValue);

    const formattedDate = lead.lastSync 
      ? new Date(lead.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
      : 'Never';

    tr.innerHTML = `
      <td class="px-6 py-4">
        <div class="font-medium text-white">${lead.name}</div>
        <div class="text-slate-400 text-[11px]">${lead.email}</div>
      </td>
      <td class="px-6 py-4 text-slate-300 font-medium">${lead.company}</td>
      <td class="px-6 py-4 font-semibold text-slate-100">${formattedDeal}</td>
      <td class="px-6 py-4">${statusBadge}</td>
      <td class="px-6 py-4 text-slate-400 text-[11px]">${formattedDate}</td>
      <td class="px-6 py-4 text-right">
        <button 
          onclick="syncSingleLead('${lead.id}', '${lead.name}')"
          class="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium border border-slate-700/60 transition-all active:scale-95 hover:text-white"
        >
          Sync Now
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Re-initialize Lucide icons in dynamically created DOM
  if (window.lucide) {
    lucide.createIcons();
  }
}

// 4. Client-side Search and Filter
function filterTable() {
  const searchTerm = document.getElementById('search-input').value.toLowerCase();
  const statusFilter = document.getElementById('status-filter').value;

  const filtered = allLeads.filter(lead => {
    const matchesSearch = lead.name.toLowerCase().includes(searchTerm) || 
                          lead.company.toLowerCase().includes(searchTerm) || 
                          lead.email.toLowerCase().includes(searchTerm);
    const matchesStatus = (statusFilter === 'ALL') || (lead.status === statusFilter);
    return matchesSearch && matchesStatus;
  });

  renderTable(filtered);
}

// 5. Trigger Single Lead Sync to n8n Webhook
async function syncSingleLead(leadId, leadName) {
  try {
    showToast(`Sending lead "${leadName}" to n8n webhook...`);
    const res = await fetch('/api/trigger-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId })
    });
    const result = await res.json();
    if (result.success) {
      showToast(result.message);
      // Refresh dashboard data
      fetchDashboardData();
    }
  } catch (err) {
    showToast('Failed to trigger webhook', true);
  }
}

// 6. Trigger Global Workflow Sync
async function syncAllLeads() {
  const icon = document.getElementById('sync-icon');
  icon.classList.add('animate-spin');

  try {
    showToast('Triggering full n8n automation pipeline...');
    const res = await fetch('/api/trigger-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const result = await res.json();
    if (result.success) {
      showToast(result.message);
      fetchDashboardData();
    }
  } catch (err) {
    showToast('Automation trigger failed', true);
  } finally {
    setTimeout(() => icon.classList.remove('animate-spin'), 1000);
  }
}

// 7. Visual Toast Notification Helper
function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  const msgEl = document.getElementById('toast-message');
  msgEl.textContent = message;

  toast.classList.remove('hidden');
  setTimeout(() => {
    toast.classList.add('hidden');
  }, 3500);
}
