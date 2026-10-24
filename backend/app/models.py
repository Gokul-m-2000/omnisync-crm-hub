from typing import Optional, List, Literal
from pydantic import BaseModel, Field


LeadStatus = Literal["synced", "pending", "failed"]


class LeadBase(BaseModel):
    name: str = Field(..., example="Jane Doe")
    company: str = Field(..., example="Acme Corp")
    email: str = Field(..., example="jane.doe@acme.com")
    dealValue: float = Field(0.0, ge=0, example=15000.0)
    status: LeadStatus = Field("pending", example="pending")


class LeadCreate(LeadBase):
    pass


class LeadStatusUpdate(BaseModel):
    status: LeadStatus = Field(..., example="synced")


class Lead(LeadBase):
    id: str = Field(..., example="lead_001")
    lastSync: Optional[str] = Field(None, example="2026-10-21T10:15:00Z")
    n8nWorkflowId: Optional[str] = Field(None, example="wf_hubspot_sync_99")


class Metrics(BaseModel):
    totalLeads: int
    syncedCount: int
    pendingCount: int
    failedCount: int
    totalPipelineValue: float
    syncHealth: int


class LeadsResponse(BaseModel):
    metrics: Metrics
    leads: List[Lead]


class HealthResponse(BaseModel):
    status: str
    service: str
    timestamp: str
