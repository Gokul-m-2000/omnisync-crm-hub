"""
Test script for verifying all endpoints of the FastAPI CRM Backend.
Can be executed using:
  python backend/test_api.py
"""
import sys
import os

# Ensure backend root is on sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_endpoints():
    print("\n--- 1. Testing GET /health ---")
    res = client.get("/health")
    assert res.status_code == 200, f"Expected 200, got {res.status_code}"
    print("[OK] GET /health response:", res.json())

    print("\n--- 2. Testing GET /api/leads ---")
    res = client.get("/api/leads")
    assert res.status_code == 200, f"Expected 200, got {res.status_code}"
    data = res.json()
    assert "metrics" in data, "Response missing 'metrics'"
    assert "leads" in data, "Response missing 'leads'"
    print(f"[OK] GET /api/leads returned {len(data['leads'])} leads and metrics: {data['metrics']}")

    print("\n--- 3. Testing GET /api/leads/{lead_id} ---")
    lead_id = "lead_001"
    res = client.get(f"/api/leads/{lead_id}")
    assert res.status_code == 200, f"Expected 200, got {res.status_code}"
    lead = res.json()
    assert lead["id"] == lead_id
    print(f"[OK] GET /api/leads/{lead_id} returned:", lead["name"], f"({lead['company']})")

    # Negative test for lead not found
    res = client.get("/api/leads/non_existent_id")
    assert res.status_code == 404
    print("[OK] GET /api/leads/non_existent_id returned 404 as expected")

    print("\n--- 4. Testing POST /api/leads ---")
    new_lead = {
        "name": "Alex Mercer",
        "company": "Apex Global Solutions",
        "email": "alex.m@apexgl.com",
        "dealValue": 45000.0,
        "status": "pending"
    }
    res = client.post("/api/leads", json=new_lead)
    assert res.status_code == 201, f"Expected 201, got {res.status_code}"
    created = res.json()
    assert created["name"] == new_lead["name"]
    created_id = created["id"]
    print("[OK] POST /api/leads created new lead:", created_id, created["name"])

    print("\n--- 5. Testing PATCH /api/leads/{lead_id} ---")
    patch_payload = {"status": "synced"}
    res = client.patch(f"/api/leads/{created_id}", json=patch_payload)
    assert res.status_code == 200, f"Expected 200, got {res.status_code}"
    updated = res.json()
    assert updated["status"] == "synced"
    assert updated["lastSync"] is not None
    print(f"[OK] PATCH /api/leads/{created_id} updated status to:", updated["status"], f"(lastSync: {updated['lastSync']})")

    # Verify metrics updated
    res = client.get("/api/leads")
    assert res.status_code == 200
    metrics = res.json()["metrics"]
    print(f"[OK] Updated metrics: totalLeads={metrics['totalLeads']}, syncedCount={metrics['syncedCount']}")

    print("\n=== ALL ENDPOINT TESTS PASSED SUCCESSFULLY! ===\n")


if __name__ == "__main__":
    test_endpoints()
