# tests/conftest.py
import pytest
from fastapi.testclient import TestClient
from sqlmodel import SQLModel, create_engine, Session
from sqlalchemy.pool import StaticPool
from main_api import app, get_session
from main_models import Product, Worker, Estimate, EstimateItem, Contract

# Используем in-memory SQLite для тестов
TEST_DATABASE_URL = "sqlite:///:memory:"

@pytest.fixture(name="session")
def session_fixture():
    engine = create_engine(
        TEST_DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    SQLModel.metadata.drop_all(engine)

@pytest.fixture(name="client")
def client_fixture(session: Session):
    def get_session_override():
        return session

    app.dependency_overrides[get_session] = get_session_override
    client = TestClient(app)
    yield client
    app.dependency_overrides.clear()

@pytest.fixture
def auth_headers():
    """Mock authentication headers for testing"""
    # В реальности токен проверяется, но для тестов мы можем использовать мок
    return {"Authorization": "Bearer test_token"}

@pytest.fixture
def sample_product(session: Session):
    """Create a sample product for testing"""
    product = Product(
        name="Тестовый товар",
        internal_sku="TEST-001",
        supplier_sku="SUP-001",
        stock_quantity=100.0,
        purchase_price=50.0,
        retail_price=75.0,
        min_stock_level=10.0
    )
    session.add(product)
    session.commit()
    session.refresh(product)
    return product

@pytest.fixture
def sample_worker(session: Session):
    """Create a sample worker for testing"""
    worker = Worker(name="Тестовый работник")
    session.add(worker)
    session.commit()
    session.refresh(worker)
    return worker
