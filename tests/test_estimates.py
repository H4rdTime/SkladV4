# tests/test_estimates.py
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session
from main_models import Estimate, EstimateStatusEnum

def test_create_estimate(client: TestClient, sample_product, auth_headers):
    """Test creating a new estimate"""
    response = client.post(
        "/estimates/",
        json={
            "estimate_number": "TEST-001",
            "client_name": "Тестовый клиент",
            "location": "г. Москва",
            "items": [
                {
                    "product_id": sample_product.id,
                    "quantity": 10.0,
                    "unit_price": 75.0
                }
            ]
        },
        headers=auth_headers
    )
    assert response.status_code == 200
    data = response.json()
    assert data["estimate_number"] == "TEST-001"
    assert data["client_name"] == "Тестовый клиент"
    assert data["status"] == "Черновик"

def test_read_estimates(client: TestClient, sample_product, auth_headers):
    """Test reading estimates list"""
    # Create an estimate first
    client.post(
        "/estimates/",
        json={
            "estimate_number": "TEST-002",
            "client_name": "Клиент 2",
            "items": [
                {
                    "product_id": sample_product.id,
                    "quantity": 5.0,
                    "unit_price": 75.0
                }
            ]
        },
        headers=auth_headers
    )
    
    response = client.get("/estimates/", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["total"] >= 1

def test_ship_estimate(client: TestClient, sample_product, sample_worker, auth_headers):
    """Test shipping an estimate"""
    # Create estimate
    create_response = client.post(
        "/estimates/",
        json={
            "estimate_number": "TEST-SHIP",
            "client_name": "Клиент для отгрузки",
            "items": [
                {
                    "product_id": sample_product.id,
                    "quantity": 10.0,
                    "unit_price": 75.0
                }
            ]
        },
        headers=auth_headers
    )
    estimate_id = create_response.json()["id"]
    
    # Ship it
    response = client.post(
        f"/estimates/{estimate_id}/ship",
        json={"worker_id": sample_worker.id},
        headers=auth_headers
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "В работе"
    assert data["worker_id"] == sample_worker.id

def test_complete_estimate(client: TestClient, sample_product, sample_worker, auth_headers):
    """Test completing an estimate"""
    # Create and ship estimate
    create_response = client.post(
        "/estimates/",
        json={
            "estimate_number": "TEST-COMPLETE",
            "client_name": "Клиент для завершения",
            "items": [
                {
                    "product_id": sample_product.id,
                    "quantity": 5.0,
                    "unit_price": 75.0
                }
            ]
        },
        headers=auth_headers
    )
    estimate_id = create_response.json()["id"]
    
    client.post(
        f"/estimates/{estimate_id}/ship",
        json={"worker_id": sample_worker.id},
        headers=auth_headers
    )
    
    # Complete it
    response = client.post(
        f"/estimates/{estimate_id}/complete",
        headers=auth_headers
    )
    assert response.status_code == 200
