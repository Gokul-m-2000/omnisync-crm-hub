import os
from datetime import datetime, timezone
from typing import List
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware

from app.models import (
    Lead,
    LeadCreate,
    LeadStatusUpdate,
    LeadsResponse,
    HealthResponse,
)
from app.mock_data import (
    get_all_leads,
    get_lead_by_id,
    create_lead,
    update_lead_status,
    calculate_metrics,
)

app = FastAPI(
    title="OmniSync CRM Backend API",
    description="Python FastAPI backend providing mock CRM leads and status endpoints.",
    version="1.0.0",
)

# ---------------------------------------------------------------------------
# CORS Configuration
# ---------------------------------------------------------------------------
# Allowed origins can be customized via the CORS_ORIGINS environment variable
# (comma-separated). By default, during local development we allow all origins.
cors_origins_env = os.getenv("CORS_ORIGINS", "*")
if cors_origins_env == "*":
    origins = ["*"]
else:
    origins = [origin.strip() for origin in cors_origins_env.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True if origins != ["*"] else False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# 1. Health Check Endpoints
# ---------------------------------------------------------------------------
@app.get("/health", response_model=HealthResponse, tags=["Health"])
@app.get("/api/health", response_model=HealthResponse, tags=["Health"])
def health_check():
    """Health check endpoint to verify that the backend service is up and running."""
    return {
        "status": "healthy",
        "service": "FastAPI CRM Backend",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ---------------------------------------------------------------------------
# 2. Leads Endpoints
# ---------------------------------------------------------------------------
@app.get(
    "/api/leads",
    response_model=LeadsResponse,
    tags=["Leads"],
    summary="List all leads and summary metrics",
)
def list_leads():
    """
    Returns all in-memory mock leads along with aggregated metrics (total count,
    status distribution, total pipeline value, and sync rate) formatted for the
    frontend dashboard.
    """
    return {
        "metrics": calculate_metrics(),
        "leads": get_all_leads(),
    }


@app.get(
    "/api/leads/{lead_id}",
    response_model=Lead,
    tags=["Leads"],
    summary="Get single lead by ID",
)
def get_lead(lead_id: str):
    """Fetches details for a single lead by its unique identifier."""
    lead = get_lead_by_id(lead_id)
    if not lead:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Lead with id '{lead_id}' not found",
        )
    return lead


@app.post(
    "/api/leads",
    response_model=Lead,
    status_code=status.HTTP_201_CREATED,
    tags=["Leads"],
    summary="Create a new lead",
)
def create_new_lead(lead_in: LeadCreate):
    """
    Creates a new sample lead in memory. Auto-assigns an incremental ID
    (e.g., lead_005) and returns the created record.
    """
    return create_lead(lead_in)


@app.patch(
    "/api/leads/{lead_id}",
    response_model=Lead,
    tags=["Leads"],
    summary="Update a lead's status",
)
def update_lead(lead_id: str, payload: LeadStatusUpdate):
    """
    Updates a lead's status ('synced', 'pending', or 'failed').
    If set to 'synced', the lastSync timestamp is automatically updated.
    """
    updated_lead = update_lead_status(lead_id, payload.status)
    if not updated_lead:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Lead with id '{lead_id}' not found",
        )
    return updated_lead


# ---------------------------------------------------------------------------
# 3. Frontend Automation Trigger Compatibility (Mock)
# ---------------------------------------------------------------------------
@app.post(
    "/api/trigger-sync",
    tags=["Leads"],
    summary="Simulate triggering sync workflow for leads",
)
def trigger_sync(payload: dict = None):
    """
    Simulates sync trigger from existing frontend buttons without requiring
    an external automation engine yet.
    """
    lead_id = payload.get("leadId") if payload else None
    timestamp = datetime.now(timezone.utc).isoformat()

    if lead_id:
        updated = update_lead_status(lead_id, "synced")
        if not updated:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Lead with id '{lead_id}' not found",
            )
        return {
            "success": True,
            "message": f"Lead {updated.name} synced successfully (Mock)!",
            "lead": updated,
        }

    # If no leadId provided, simulate syncing all leads
    for lead in get_all_leads():
        update_lead_status(lead.id, "synced")

    return {
        "success": True,
        "message": "All leads marked as synced (Mock)!",
        "timestamp": timestamp,
    }

