from datetime import datetime, timezone
from typing import List, Optional, Dict
from app.models import Lead, LeadCreate, LeadStatus, Metrics


# ---------------------------------------------------------------------------
# In-Memory Database
#
# NOTE & LIMITATION:
# This list is stored purely in the server process's RAM (volatile memory).
# 1. Any server restart or auto-reload will immediately reset this data back
#    to the initial list below.
# 2. In multi-worker or serverless environments, each process has its own
#    separate copy of this memory, leading to state inconsistencies.
# ---------------------------------------------------------------------------
MOCK_LEADS: List[Dict] = [
    {
        "id": "lead_001",
        "name": "Sarah Chen",
        "company": "Apex Technologies",
        "email": "sarah.chen@apextech.io",
        "dealValue": 18500.0,
        "status": "synced",
        "lastSync": "2026-10-21T10:15:00Z",
        "n8nWorkflowId": "wf_hubspot_sync_99",
    },
    {
        "id": "lead_002",
        "name": "Marcus Vance",
        "company": "Vance Logistics",
        "email": "m.vance@vancelog.com",
        "dealValue": 34000.0,
        "status": "pending",
        "lastSync": None,
        "n8nWorkflowId": "wf_hubspot_sync_99",
    },
    {
        "id": "lead_003",
        "name": "Elena Rostova",
        "company": "Nordic AI Labs",
        "email": "elena@nordicai.se",
        "dealValue": 12000.0,
        "status": "synced",
        "lastSync": "2026-10-21T11:45:00Z",
        "n8nWorkflowId": "wf_hubspot_sync_99",
    },
    {
        "id": "lead_004",
        "name": "Devon Brooks",
        "company": "Horizon Retail Group",
        "email": "devon@horizonretail.com",
        "dealValue": 8200.0,
        "status": "failed",
        "lastSync": "2026-10-21T08:30:00Z",
        "n8nWorkflowId": "wf_hubspot_sync_99",
    },
]


def calculate_metrics() -> Metrics:
    total_leads = len(MOCK_LEADS)
    synced = sum(1 for l in MOCK_LEADS if l.get("status") == "synced")
    pending = sum(1 for l in MOCK_LEADS if l.get("status") == "pending")
    failed = sum(1 for l in MOCK_LEADS if l.get("status") == "failed")
    pipeline = sum(float(l.get("dealValue", 0)) for l in MOCK_LEADS)
    sync_health = round((synced / total_leads) * 100) if total_leads > 0 else 0

    return Metrics(
        totalLeads=total_leads,
        syncedCount=synced,
        pendingCount=pending,
        failedCount=failed,
        totalPipelineValue=pipeline,
        syncHealth=sync_health,
    )


def get_all_leads() -> List[Lead]:
    return [Lead(**lead) for lead in MOCK_LEADS]


def get_lead_by_id(lead_id: str) -> Optional[Lead]:
    for lead in MOCK_LEADS:
        if lead["id"] == lead_id:
            return Lead(**lead)
    return None


def create_lead(lead_in: LeadCreate) -> Lead:
    # Auto-generate lead ID based on next sequence number
    new_index = len(MOCK_LEADS) + 1
    new_id = f"lead_{new_index:03d}"
    
    # Ensure ID uniqueness in case of deletions or out-of-order adds
    existing_ids = {l["id"] for l in MOCK_LEADS}
    counter = new_index
    while new_id in existing_ids:
        counter += 1
        new_id = f"lead_{counter:03d}"

    new_lead_data = {
        "id": new_id,
        "name": lead_in.name,
        "company": lead_in.company,
        "email": lead_in.email,
        "dealValue": lead_in.dealValue,
        "status": lead_in.status,
        "lastSync": None,
        "n8nWorkflowId": "wf_hubspot_sync_99",
    }
    MOCK_LEADS.append(new_lead_data)
    return Lead(**new_lead_data)


def update_lead_status(lead_id: str, new_status: LeadStatus) -> Optional[Lead]:
    for lead in MOCK_LEADS:
        if lead["id"] == lead_id:
            lead["status"] = new_status
            if new_status == "synced":
                lead["lastSync"] = datetime.now(timezone.utc).isoformat()
            return Lead(**lead)
    return None
