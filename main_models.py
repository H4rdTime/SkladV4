# main_models.py

from datetime import datetime
from typing import List, Optional
from enum import Enum

from sqlmodel import Field, SQLModel, Relationship

# --- Перечисления (Enums) для стандартизации полей ---


class UnitEnum(str, Enum):
    """Единицы измерения"""
    szt = "шт."
    m = "пог. м."
    l = "л."
    kg = "кг."
    m2 = "кв. м."
    m3 = "куб. м."


class MovementTypeEnum(str, Enum):
    """Типы движения товара"""
    INCOME = "Поступление"
    ISSUE_TO_WORKER = "Выдача работнику"
    RETURN_FROM_WORKER = "Возврат от работника"
    WRITE_OFF_ESTIMATE = "Списание по смете"
    WRITE_OFF_CONTRACT = "Списание по договору"
    ADJUSTMENT = "Корректировка"
    WRITE_OFF_WORKER = "Списание работником"  # <-- НОВЫЙ ТИП
# --- Основные модели таблиц ---


class Worker(SQLModel, table=True):
    """Таблица работников (монтажников)"""
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True)

    stock_movements: List["StockMovement"] = Relationship(
        back_populates="worker")


class Product(SQLModel, table=True):
    """Таблица товаров на складе"""
    id: Optional[int] = Field(default=None, primary_key=True)

    # --- НОВОЕ ПОЛЕ ---
    is_favorite: bool = Field(default=False, index=True)
    is_deleted: bool = Field(default=False, index=True)
    internal_sku: str = Field(unique=True, index=True)
    name: str
    supplier_sku: Optional[str] = Field(default=None, index=True)
    unit: UnitEnum = Field(default=UnitEnum.szt)
    purchase_price: float = 0.0
    retail_price: float = 0.0
    stock_quantity: float = 0.0
    min_stock_level: float = 0.0
    stock_movements: List["StockMovement"] = Relationship(
        back_populates="product")


class StockMovement(SQLModel, table=True):
    """Таблица истории всех движений товаров"""
    id: Optional[int] = Field(default=None, primary_key=True)

    quantity: float
    type: MovementTypeEnum
    # Остаток на складе ПОСЛЕ операции
    stock_after: Optional[float] = Field(default=None)

    product_id: int = Field(foreign_key="product.id")
    worker_id: Optional[int] = Field(default=None, foreign_key="worker.id")

    timestamp: datetime = Field(default_factory=datetime.utcnow)

    product: Product = Relationship(back_populates="stock_movements")
    worker: Optional[Worker] = Relationship(back_populates="stock_movements")


class EstimateStatusEnum(str, Enum):
    DRAFT = "Черновик"
    APPROVED = "Утверждена"
    IN_PROGRESS = "В работе"
    COMPLETED = "Выполнена"
    CANCELLED = "Отменена"

# --- Таблицы для Смет ---


class EstimateItem(SQLModel, table=True):
    """Строка в смете (один товар/услуга)"""
    id: Optional[int] = Field(default=None, primary_key=True)
    quantity: float
    unit_price: float  # Цена за единицу на момент создания сметы

    # Связи
    estimate_id: int = Field(foreign_key="estimate.id")
    product_id: int = Field(foreign_key="product.id")

    estimate: "Estimate" = Relationship(back_populates="items")
    # Односторонняя связь, нам не нужно знать из товара, в каких он сметах
    product: Product = Relationship()


class Estimate(SQLModel, table=True):
    """Смета (заказ-наряд)"""
    id: Optional[int] = Field(default=None, primary_key=True)
    estimate_number: str = Field(index=True)
    client_name: str
    location: Optional[str] = None  # Адрес объекта

    status: EstimateStatusEnum = Field(default=EstimateStatusEnum.DRAFT)
    created_at: datetime = Field(default_factory=datetime.utcnow)

    # Связи
    worker_id: Optional[int] = Field(default=None, foreign_key="worker.id")

    items: List[EstimateItem] = Relationship(back_populates="estimate")


class ContractStatusEnum(str, Enum):
    PLANNED = "Планируется"
    IN_PROGRESS = "В работе"
    COMPLETED = "Завершен"
    CANCELLED = "Отменен"

# --- Таблица для Договоров ---


class Contract(SQLModel, table=True):
    """Договор на бурение скважины"""
    id: Optional[int] = Field(default=None, primary_key=True)
    contract_number: str = Field(index=True)
    contract_date: datetime = Field(default_factory=datetime.utcnow)

    # --- Клиент и объект ---
    client_name: str
    location: str  # Адрес объекта

    # --- Паспортные данные клиента (все необязательные) ---
    passport_series_number: Optional[str] = None
    passport_issued_by: Optional[str] = None
    passport_issue_date: Optional[str] = None  # Храним как строку для простоты
    passport_dep_code: Optional[str] = None
    passport_address: Optional[str] = None

    # --- Параметры бурения ---
    # Плановые
    estimated_depth: Optional[float] = None
    price_per_meter_soil: Optional[float] = None
    price_per_meter_rock: Optional[float] = None

    # Фактические (заполняются после работ)
    actual_depth_soil: Optional[float] = None
    actual_depth_rock: Optional[float] = None
    pipe_steel_used: Optional[float] = None
    pipe_plastic_used: Optional[float] = None

    status: ContractStatusEnum = Field(default=ContractStatusEnum.PLANNED)
