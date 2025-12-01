# tests/test_workers.py
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

def test_create_worker(client: TestClient, auth_headers):
    """Test creating a new worker"""
    response = client.post(
        "/workers/",
        json={"name": "Новый работник"},
        headers=auth_headers
    )
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Новый работник"

def test_read_workers(client: TestClient, sample_worker, auth_headers):
    """Test reading workers list"""
    response = client.get("/workers/", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 1

def test_issue_item_to_worker(client: TestClient, sample_product, sample_worker, auth_headers):
    """Test issuing an item to a worker"""
    response = client.post(
        "/actions/issue-item/",
        json={
            "product_id": sample_product.id,
            "worker_id": sample_worker.id,
            "quantity": 10.0
        },
        headers=auth_headers
    )
    assert response.status_code == 200
    data = response.json()
    assert data["quantity"] == -10.0  # Negative because it's issued
    assert data["type"] == "Выдача работнику"

def test_return_item_from_worker(client: TestClient, sample_product, sample_worker, auth_headers):
    """Test returning an item from a worker"""
    # First issue some items
    client.post(
        "/actions/issue-item/",
        json={
            "product_id": sample_product.id,
            "worker_id": sample_worker.id,
            "quantity": 20.0
        },
        headers=auth_headers
    )
    
    # Then return some
    response = client.post(
        "/actions/return-item/",
        json={
            "product_id": sample_product.id,
            "worker_id": sample_worker.id,
            "quantity": 5.0
        },
        headers=auth_headers
    )
    assert response.status_code == 200
    data = response.json()
    assert data["quantity"] == 5.0
    assert data["type"] == "Возврат от работника"

def test_get_worker_stock(client: TestClient, sample_product, sample_worker, auth_headers):
    """Test getting items on hand for a worker"""
    # Issue items to worker
    client.post(
        "/actions/issue-item/",
        json={
            "product_id": sample_product.id,
            "worker_id": sample_worker.id,
            "quantity": 15.0
        },
        headers=auth_headers
    )
    
    response = client.get(
        f"/actions/worker-stock/{sample_worker.id}",
        headers=auth_headers
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 1
    assert data[0]["quantity_on_hand"] == 15.0
