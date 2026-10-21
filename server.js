// server.js - Backend API for CRM Dashboard & n8n Automations
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors()); // Allow frontend dashboard to communicate with backend
app.use(express.json()); // Parse incoming JSON request bodies
app.use(express.static('public')); // Serve frontend dashboard from public folder

// -------------------------------------------------------------
// Realistic Mock CRM Data (HubSpot/Salesforce Schema)
// In production, this would be fetched from HubSpot/Salesforce API
// -------------------------------------------------------------
let mockLeads = [
  {
    id: "lead_001",
    name: "Sarah Chen",
    company: "Apex Technologies",
    email: "sarah.chen@apextech.io",
    dealValue: 18500,
    status: "synced", // 'synced' | 'pending' | 'failed'
    lastSync: "2026-10-21T10:15:00Z",
    n8nWorkflowId: "wf_hubspot_sync_99"
  },
  {
    id: "lead_002",
    name: "Marcus Vance",
    company: "Vance Logistics",
    email: "m.vance@vancelog.com",
    dealValue: 34000,
    status: "pending",
    lastSync: null,
    n8nWorkflowId: "wf_hubspot_sync_99"
  },
  {
    id: "lead_003",
    name: "Elena Rostova",
    company: "Nordic AI Labs",
    email: "elena@nordicai.se",
    dealValue: 12000,
    status: "synced",
    lastSync: "2026-10-21T11:45:00Z",
    n8nWorkflowId: "wf_hubspot_sync_99"
  },
  {
    id: "lead_004",
    name: "Devon Brooks",
    company: "Horizon Retail Group",
    email: "devon@horizonretail.com",
    dealValue: 8200,
    status: "failed", // Webhook dropped or invalid email
    lastSync: "2026-10-21T08:30:00Z",
    n8nWorkflowId: "wf_hubspot_sync_99"
  }
];

// -------------------------------------------------------------
// Routes
// -------------------------------------------------------------

// 1. Health Check (Used by Railway and monitoring)
app.get('/api/health', (req, res) => {
  res.json({
    status: "healthy",
    service: "CRM & n8n Bridge API",
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

// 2. Fetch Leads & Summary Metrics (Used by Dashboard)
app.get('/api/leads', (req, res) => {
  const totalLeads = mockLeads.length;
  const syncedCount = mockLeads.filter(l => l.status === 'synced').length;
  const pendingCount = mockLeads.filter(l => l.status === 'pending').length;
  const failedCount = mockLeads.filter(l => l.status === 'failed').length;
  const totalPipelineValue = mockLeads.reduce((acc, curr) => acc + curr.dealValue, 0);

  res.json({
    metrics: {
      totalLeads,
      syncedCount,
      pendingCount,
      failedCount,
      totalPipelineValue,
      syncHealth: totalLeads > 0 ? Math.round((syncedCount / totalLeads) * 100) : 0
    },
    leads: mockLeads
  });
});

// 3. Trigger n8n Automation / Webhook Sync (Used by "Sync Now" button)
app.post('/api/trigger-sync', (req, res) => {
  const { leadId } = req.body;
  const timestamp = new Date().toISOString();

  console.log(`[${timestamp}] Triggering n8n automation for lead: ${leadId || 'ALL'}`);

  if (leadId) {
    const lead = mockLeads.find(l => l.id === leadId);
    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }
    // Simulate updating status after successful sync
    lead.status = "synced";
    lead.lastSync = timestamp;
    return res.json({
      success: true,
      message: `Lead ${lead.name} synced to CRM successfully via n8n!`,
      lead: lead
    });
  }

  // If no specific leadId, simulate syncing all pending
  mockLeads = mockLeads.map(l => ({
    ...l,
    status: "synced",
    lastSync: timestamp
  }));

  res.json({
    success: true,
    message: "All leads synced to CRM via n8n workflow!",
    timestamp
  });
});

// Start listening
app.listen(PORT, () => {
  console.log(`\n=================================================`);
  console.log(`🚀 CRM Backend Server running at: http://localhost:${PORT}`);
  console.log(`   Health Check: http://localhost:${PORT}/api/health`);
  console.log(`   Leads API:    http://localhost:${PORT}/api/leads`);
  console.log(`=================================================\n`);
});
