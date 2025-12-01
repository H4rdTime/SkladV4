# tests/test_products.py
import pytest
import math
from fastapi.testclient import TestClient
from sqlmodel import Session
from main_models import Product

def test_create_product(client: TestClient, session: Session, auth_headers):
    """Test creating a new product"""
    response = client.post(
        "/products/",
        json={
            "name": "Новый товар",
            "internal_sku": "NEW-001",
            "supplier_sku": "SUP-NEW-001",
            "stock_quantity": 50.0,
            "purchase_price": 100.0,
            "retail_price": 150.0,
            "min_stock_level": 5.0,
            "unit": "шт."
        },
        headers=auth_headers
    )
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Новый товар"
    assert data["stock_quantity"] == 50.0

def test_read_products(client: TestClient, sample_product, auth_headers):
    """Test reading products list"""
    response = client.get("/products/", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["total"] >= 1
    assert len(data["items"]) >= 1

def test_search_products(client: TestClient, sample_product, auth_headers):
    """Test searching products"""
    response = client.get(
        "/products/?search=Тестовый",
        headers=auth_headers
    )
    assert response.status_code == 200
    data = response.json()
    assert data["total"] >= 1
    assert "Тестовый" in data["items"][0]["name"]

def test_update_product(client: TestClient, sample_product, auth_headers):
    """Test updating a product"""
    response = client.patch(
        f"/products/{sample_product.id}",
        json={"stock_quantity": 200.0},
        headers=auth_headers
    )
    assert response.status_code == 200
    data = response.json()
    assert data["stock_quantity"] == 200.0

def test_delete_product(client: TestClient, sample_product, auth_headers):
    """Test soft-deleting a product"""
    response = client.delete(
        f"/products/{sample_product.id}",
        headers=auth_headers
    )
    assert response.status_code == 200
    data = response.json()
    assert data["is_deleted"] == True

def test_validate_quantity_nan(client: TestClient, auth_headers):
    """Test that NaN values are rejected"""
    response = client.post(
        "/actions/receive-item/",
        json={
            "product_id": 1,
            "quantity": float('nan')
        },
        headers=auth_headers
    )
    # Should return 400 or similar error due to validation
    assert response.status_code in [400, 422]

def test_validate_quantity_negative(client: TestClient, sample_product, auth_headers):
    """Test that negative quantities are rejected"""
    response = client.post(
        "/actions/receive-item/",
        json={
            "product_id": sample_product.id,
            "quantity": -10.0
        },
        headers=auth_headers
    )
    assert response.status_code == 400

def test_nan_values_cleaned_in_response(client: TestClient, session: Session, auth_headers):
    """Test that products with NaN values return 0.0 instead"""
    # Manually create a product with NaN (simulating corrupted data)
    product = Product(
        name="NaN Product",
        internal_sku="NAN-001",
        stock_quantity=float('nan'),
        purchase_price=100.0,
        retail_price=150.0
    )
    session.add(product)
    session.commit()
    
    response = client.get("/products/", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    
    # Find our NaN product
    nan_product = next((p for p in data["items"] if p["internal_sku"] == "NAN-001"), None)
    assert nan_product is not None
    # Should be cleaned to 0.0
    assert nan_product["stock_quantity"] == 0.0
    assert not math.isnan(nan_product["stock_quantity"])
