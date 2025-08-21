# main_api.py

from datetime import date, datetime, timedelta
from enum import Enum
from itertools import product
from operator import or_
import os
import io
import re
from typing import List, Optional, Annotated

from dotenv import load_dotenv
from fastapi import FastAPI, Depends, Form, HTTPException, UploadFile, File, Query
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from numpy import delete
from num2words import num2words
from pydantic import BaseModel
from passlib.context import CryptContext
from sqlalchemy import func
from sqlmodel import SQLModel, create_engine, Session, select
from docxtpl import DocxTemplate
import pandas as pd

# Импортируем все наши модели
from main_models import (
    Estimate, EstimateItem, EstimateStatusEnum,
    Contract, ContractStatusEnum, ContractTypeEnum,
    UnitEnum, Product, Worker, StockMovement, MovementTypeEnum
)
from datetime import datetime


# --- Настройка подключения к базе данных ---
load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise ValueError("Необходимо установить переменную окружения DATABASE_URL")
engine = create_engine(DATABASE_URL)


def create_db_and_tables():
    print("Создание таблиц в базе данных...")
    SQLModel.metadata.create_all(engine)
    print("Таблицы успешно созданы (или уже существовали).")


# --- КОНФИГУРАЦИЯ БЕЗОПАСНОСТИ ---
SECRET_KEY = "your-super-secret-key-that-is-long-and-random"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 дней

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

# --- База данных пользователей (встроенная) ---
FAKE_USERS_DB = {
    "admin": {
        "username": "admin",
        # Хэш для пароля "admin"
        "hashed_password": "$2b$12$m38XZWACbkP/tqVKuuNLUenFMGqaCUdvg37NgkNJDQsXLIPWA1QP.",
    }
}

# --- Вспомогательные функции для аутентификации ---


def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


async def get_current_user(token: Annotated[str, Depends(oauth2_scheme)]):
    credentials_exception = HTTPException(
        status_code=401,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    user = FAKE_USERS_DB.get(username)
    if user is None:
        raise credentials_exception
    return user

# --- Основное приложение FastAPI ---
app = FastAPI(
    title="Sklad V4 API",
    description="API для управления складской системой."
)

# --- НАСТРОЙКА CORS ---
origins = [
    "http://localhost:3000",
    "https://sklad-v4.vercel.app",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Зависимость для сессии БД ---


def get_session():
    with Session(engine) as session:
        yield session

# --- Событие при старте приложения ---


@app.on_event("startup")
def on_startup():
    create_db_and_tables()

# --- Эндпоинт для получения токена (ИСПРАВЛЕНИЕ ОШИБКИ 404) ---


@app.post("/token", summary="Получить токен доступа", tags=["Аутентификация"])
async def login_for_access_token(form_data: Annotated[OAuth2PasswordRequestForm, Depends()]):
    user = FAKE_USERS_DB.get(form_data.username)
    if not user or not verify_password(form_data.password, user["hashed_password"]):
        raise HTTPException(
            status_code=401,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token = create_access_token(
        data={"sub": user["username"]}
    )
    return {"access_token": access_token, "token_type": "bearer"}


# --- Модели для API (вспомогательные) ---
class StockStatusFilter(str, Enum):
    ALL = "all"
    LOW_STOCK = "low_stock"
    OUT_OF_STOCK = "out_of_stock"


class ProductPage(BaseModel):
    total: int
    items: List[Product]


class IssueItemRequest(BaseModel):
    product_id: int
    worker_id: int
    quantity: float


class ReturnItemRequest(BaseModel):
    product_id: int
    worker_id: int
    quantity: float


class WorkerStockItem(BaseModel):
    product_id: int
    product_name: str
    quantity_on_hand: float
    unit: str


class EstimateItemCreate(BaseModel):
    product_id: int
    quantity: float
    unit_price: Optional[float] = None


class EstimateCreate(BaseModel):
    estimate_number: str
    client_name: str
    location: Optional[str] = None
    items: List[EstimateItemCreate]


class EstimateItemResponse(BaseModel):
    id: int
    quantity: float
    unit_price: float
    product_id: int
    product_name: str


class EstimateResponse(BaseModel):
    id: int
    estimate_number: str
    client_name: str
    location: Optional[str]
    status: EstimateStatusEnum
    created_at: datetime
    worker_id: Optional[int]
    items: List[EstimateItemResponse]
    total_sum: float


class EstimatePage(BaseModel):
    total: int
    items: List[Estimate]


class ContractUpdate(BaseModel):
    client_name: Optional[str] = None
    location: Optional[str] = None
    passport_series_number: Optional[str] = None
    passport_issued_by: Optional[str] = None
    passport_issue_date: Optional[str] = None
    passport_dep_code: Optional[str] = None
    passport_address: Optional[str] = None
    estimated_depth: Optional[float] = None
    price_per_meter_soil: Optional[float] = None
    price_per_meter_rock: Optional[float] = None
    actual_depth_soil: Optional[float] = None
    actual_depth_rock: Optional[float] = None
    pipe_steel_used: Optional[float] = None
    pipe_plastic_used: Optional[float] = None
    status: Optional[ContractStatusEnum] = None
    contract_type: Optional[ContractTypeEnum] = None


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    supplier_sku: Optional[str] = None
    unit: Optional[UnitEnum] = None
    purchase_price: Optional[float] = None
    retail_price: Optional[float] = None
    stock_quantity: Optional[float] = None
    min_stock_level: Optional[float] = None
    internal_sku: Optional[str] = None
    is_favorite: Optional[bool] = None


class WorkerUpdate(BaseModel):
    name: str


class ImportMode(str, Enum):
    TO_STOCK = "to_stock"
    AS_ESTIMATE = "as_estimate"


class EstimateUpdate(BaseModel):
    estimate_number: Optional[str] = None
    client_name: Optional[str] = None
    location: Optional[str] = None
    status: Optional[EstimateStatusEnum] = None
    items: Optional[List[EstimateItemCreate]] = None


class AddItemsRequest(BaseModel):
    items: List[EstimateItemCreate]


class WriteOffItemRequest(BaseModel):
    product_id: int
    worker_id: int
    quantity: float


class ProfitReportItem(BaseModel):
    estimate_id: int
    estimate_number: str
    client_name: str
    completed_at: date
    total_retail: float
    total_purchase: float
    profit: float
    margin: float


class ProfitReportResponse(BaseModel):
    items: List[ProfitReportItem]
    grand_total_retail: float
    grand_total_purchase: float
    grand_total_profit: float
    average_margin: float


class DashboardSummary(BaseModel):
    products_to_order_count: int
    estimates_in_progress_count: int
    contracts_in_progress_count: int
    profit_last_30_days: float


# --- Эндпоинты для Товаров (Products) ---

@app.post("/products/", response_model=Product, summary="Добавить новый товар", tags=["Товары"])
def create_product(current_user: Annotated[dict, Depends(get_current_user)], product: Product, session: Session = Depends(get_session)):
    session.add(product)
    session.commit()
    session.refresh(product)
    movement = StockMovement(
        product_id=product.id,
        quantity=product.stock_quantity,
        type=MovementTypeEnum.INCOME,
        stock_after=product.stock_quantity
    )
    session.add(movement)
    session.commit()
    return product


@app.get("/products/", response_model=ProductPage, summary="Получить список товаров", tags=["Товары"])
def read_products(
    current_user: Annotated[dict, Depends(get_current_user)],
    search: Optional[str] = None,
    stock_status: StockStatusFilter = StockStatusFilter.ALL,
    page: int = Query(1, gt=0),
    size: int = Query(50, gt=0, le=200),
    session: Session = Depends(get_session)
):
    offset = (page - 1) * size
    query = select(Product).where(Product.is_deleted == False)
    if search:
        query = query.where(
            (Product.name.ilike(f"%{search}%")) |
            (Product.internal_sku.ilike(f"%{search}%")) |
            (Product.supplier_sku.ilike(f"%{search}%"))
        )
    if stock_status == StockStatusFilter.LOW_STOCK:
        query = query.where((Product.stock_quantity <= Product.min_stock_level) & (
            Product.stock_quantity > 0))
    elif stock_status == StockStatusFilter.OUT_OF_STOCK:
        query = query.where(Product.stock_quantity == 0)

    count_query = select(func.count()).select_from(query.subquery())
    total_count = session.exec(count_query).one()
    paginated_query = query.offset(offset).limit(
        size).order_by(Product.is_favorite.desc(), Product.name)
    items = session.exec(paginated_query).all()
    return ProductPage(total=total_count, items=items)


@app.patch("/products/{product_id}", response_model=Product, summary="Обновить товар", tags=["Товары"])
def update_product(current_user: Annotated[dict, Depends(get_current_user)], product_id: int, product_update: ProductUpdate, session: Session = Depends(get_session)):
    db_product = session.get(Product, product_id)
    if not db_product:
        raise HTTPException(status_code=404, detail="Товар не найден")

    old_quantity = db_product.stock_quantity
    update_data = product_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_product, key, value)

    if 'stock_quantity' in update_data and old_quantity != update_data['stock_quantity']:
        quantity_diff = update_data['stock_quantity'] - old_quantity
        movement = StockMovement(
            product_id=db_product.id,
            quantity=quantity_diff,
            type=MovementTypeEnum.ADJUSTMENT,
            stock_after=db_product.stock_quantity
        )
        session.add(movement)

    session.add(db_product)
    session.commit()
    session.refresh(db_product)
    return db_product


@app.delete("/products/{product_id}", response_model=Product, summary="Пометить товар как удаленный", tags=["Товары"])
def delete_product(current_user: Annotated[dict, Depends(get_current_user)], product_id: int, session: Session = Depends(get_session)):
    product = session.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Товар не найден")
    product.is_deleted = True
    session.add(product)
    session.commit()
    session.refresh(product)
    return product


@app.post("/products/{product_id}/restore", response_model=Product, summary="Восстановить товар", tags=["Товары"])
def restore_product(current_user: Annotated[dict, Depends(get_current_user)], product_id: int, session: Session = Depends(get_session)):
    product = session.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Товар не найден")
    product.is_deleted = False
    session.add(product)
    session.commit()
    session.refresh(product)
    return product


@app.patch("/products/{product_id}/toggle-favorite", response_model=Product, summary="Переключить статус 'Избранное'", tags=["Товары"])
def toggle_favorite(current_user: Annotated[dict, Depends(get_current_user)], product_id: int, session: Session = Depends(get_session)):
    product = session.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Товар не найден")
    product.is_favorite = not product.is_favorite
    session.add(product)
    session.commit()
    session.refresh(product)
    return product

# --- Эндпоинты для Работников (Workers) ---


@app.post("/workers/", response_model=Worker, summary="Добавить нового работника", tags=["Работники"])
def create_worker(current_user: Annotated[dict, Depends(get_current_user)], worker: Worker, session: Session = Depends(get_session)):
    session.add(worker)
    session.commit()
    session.refresh(worker)
    return worker


@app.get("/workers/", response_model=List[Worker], summary="Получить список всех работников", tags=["Работники"])
def read_workers(current_user: Annotated[dict, Depends(get_current_user)], session: Session = Depends(get_session)):
    return session.query(Worker).all()


@app.patch("/workers/{worker_id}", response_model=Worker, summary="Обновить работника", tags=["Работники"])
def update_worker(current_user: Annotated[dict, Depends(get_current_user)], worker_id: int, worker_update: WorkerUpdate, session: Session = Depends(get_session)):
    db_worker = session.get(Worker, worker_id)
    if not db_worker:
        raise HTTPException(status_code=404, detail="Работник не найден")
    db_worker.name = worker_update.name
    session.add(db_worker)
    session.commit()
    session.refresh(db_worker)
    return db_worker


@app.delete("/workers/{worker_id}", status_code=204, summary="Удалить работника", tags=["Работники"])
def delete_worker(current_user: Annotated[dict, Depends(get_current_user)], worker_id: int, session: Session = Depends(get_session)):
    db_worker = session.get(Worker, worker_id)
    if not db_worker:
        raise HTTPException(status_code=404, detail="Работник не найден")
    has_movements = session.exec(select(StockMovement).where(
        StockMovement.worker_id == worker_id)).first()
    if has_movements:
        raise HTTPException(
            status_code=400, detail="Нельзя удалить работника, так как за ним числятся движения товаров.")
    session.delete(db_worker)
    session.commit()
    return None

# --- Эндпоинты для Операций (Actions) ---


@app.post("/actions/issue-item/", response_model=StockMovement, summary="Выдать товар работнику", tags=["Операции"])
def issue_item_to_worker(current_user: Annotated[dict, Depends(get_current_user)], request: IssueItemRequest, session: Session = Depends(get_session)):
    product, worker = session.get(
        Product, request.product_id), session.get(Worker, request.worker_id)
    if not product:
        raise HTTPException(status_code=404, detail="Товар не найден")
    if not worker:
        raise HTTPException(status_code=404, detail="Работник не найден")
    if request.quantity <= 0:
        raise HTTPException(
            status_code=400, detail="Количество должно быть > 0")
    if product.stock_quantity < request.quantity:
        raise HTTPException(
            status_code=400, detail=f"Недостаточно товара. В наличии: {product.stock_quantity}")

    product.stock_quantity -= request.quantity
    movement = StockMovement(
        product_id=request.product_id,
        worker_id=request.worker_id,
        quantity=-request.quantity,
        type=MovementTypeEnum.ISSUE_TO_WORKER,
        stock_after=product.stock_quantity
    )
    session.add(product)
    session.add(movement)
    session.commit()
    session.refresh(movement)
    return movement


@app.post("/actions/return-item/", response_model=StockMovement, summary="Принять возврат от работника", tags=["Операции"])
def return_item_from_worker(current_user: Annotated[dict, Depends(get_current_user)], request: ReturnItemRequest, session: Session = Depends(get_session)):
    product, worker = session.get(
        Product, request.product_id), session.get(Worker, request.worker_id)
    if not product:
        raise HTTPException(status_code=404, detail="Товар не найден")
    if not worker:
        raise HTTPException(status_code=404, detail="Работник не найден")
    if request.quantity <= 0:
        raise HTTPException(
            status_code=400, detail="Количество должно быть > 0")

    product.stock_quantity += request.quantity
    movement = StockMovement(
        product_id=request.product_id,
        worker_id=request.worker_id,
        quantity=request.quantity,
        type=MovementTypeEnum.RETURN_FROM_WORKER,
        stock_after=product.stock_quantity
    )
    session.add(product)
    session.add(movement)
    session.commit()
    session.refresh(movement)
    return movement


@app.get("/actions/worker-stock/{worker_id}", response_model=List[WorkerStockItem], summary="Получить товары на руках у работника", tags=["Операции"])
def get_worker_stock(current_user: Annotated[dict, Depends(get_current_user)], worker_id: int, session: Session = Depends(get_session)):
    worker = session.get(Worker, worker_id)
    if not worker:
        raise HTTPException(
            status_code=404, detail="Работник с таким ID не найден")
    results = session.query(
        Product.id, Product.name, Product.unit, func.sum(
            StockMovement.quantity)
    ).join(Product).filter(StockMovement.worker_id == worker_id).group_by(
        Product.id, Product.name, Product.unit
    ).all()
    worker_stock = []
    for product_id, product_name, unit, total_quantity in results:
        quantity_on_hand = -total_quantity
        if quantity_on_hand > 0:
            worker_stock.append(
                WorkerStockItem(
                    product_id=product_id,
                    product_name=product_name,
                    quantity_on_hand=quantity_on_hand,
                    unit=unit.value
                )
            )
    return worker_stock


@app.post("/actions/write-off-item/", response_model=StockMovement, summary="Списать товар, числящийся за работником", tags=["Операции"])
def write_off_item_from_worker(current_user: Annotated[dict, Depends(get_current_user)], request: WriteOffItemRequest, session: Session = Depends(get_session)):
    product = session.get(Product, request.product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Товар не найден")
    worker = session.get(Worker, request.worker_id)
    if not worker:
        raise HTTPException(status_code=404, detail="Работник не найден")

    on_hand_balance_query = select(func.sum(StockMovement.quantity)).where(
        StockMovement.worker_id == request.worker_id,
        StockMovement.product_id == request.product_id
    )
    current_on_hand_sum = session.exec(
        on_hand_balance_query).one_or_none() or 0
    quantity_on_hand = -current_on_hand_sum

    if quantity_on_hand < request.quantity:
        raise HTTPException(
            status_code=400, detail=f"У работника на руках только {quantity_on_hand} шт. Нельзя списать {request.quantity} шт.")

    movement = StockMovement(
        product_id=request.product_id,
        worker_id=request.worker_id,
        quantity=request.quantity,
        type=MovementTypeEnum.WRITE_OFF_WORKER,
        stock_after=product.stock_quantity
    )
    session.add(movement)
    session.commit()
    session.refresh(movement)
    return movement


@app.get("/actions/history/", response_model=List[dict], summary="Получить историю всех движений", tags=["Операции"])
def get_history(current_user: Annotated[dict, Depends(get_current_user)], session: Session = Depends(get_session)):
    history_records = session.exec(
        select(StockMovement).order_by(StockMovement.id.desc())).all()
    response = []
    for movement in history_records:
        response.append({
            "id": movement.id,
            "timestamp": movement.timestamp,
            "type": movement.type,
            "quantity": movement.quantity,
            "stock_after": movement.stock_after,
            "product": {"name": movement.product.name if movement.product else "Товар удален"},
            "worker": {"name": movement.worker.name} if movement.worker else None
        })
    return response


@app.post("/actions/history/cancel/{movement_id}", summary="Отменить движение товара", tags=["Операции"])
def cancel_movement(current_user: Annotated[dict, Depends(get_current_user)], movement_id: int, session: Session = Depends(get_session)):
    original_movement = session.get(StockMovement, movement_id)
    if not original_movement:
        raise HTTPException(status_code=404, detail="Движение не найдено.")
    if "Отмена" in original_movement.type:
        raise HTTPException(
            status_code=400, detail="Нельзя отменить операцию отмены.")
    product = session.get(Product, original_movement.product_id)
    if not product:
        raise HTTPException(
            status_code=404, detail="Связанный товар был удален.")

    correction_quantity = -original_movement.quantity
    product.stock_quantity += correction_quantity
    correction_movement = StockMovement(
        product_id=original_movement.product_id,
        worker_id=original_movement.worker_id,
        quantity=correction_quantity,
        type=f"Отмена ({original_movement.type})",
        stock_after=product.stock_quantity
    )
    session.add(product)
    session.add(correction_movement)
    session.commit()
    return {"message": f"Операция ID {movement_id} успешно отменена."}


@app.post("/actions/universal-import/", summary="Универсальный импорт", tags=["Операции"])
async def universal_import_v9(
    current_user: Annotated[dict, Depends(get_current_user)],
    mode: ImportMode = Form(...),
    is_initial_load: bool = Form(False),
    auto_create_new: bool = Form(True),
    file: UploadFile = File(...),
    session: Session = Depends(get_session)
):
    try:
        df = pd.read_excel(io.BytesIO(await file.read()), header=None, engine='calamine')
    except Exception as e:
        raise HTTPException(
            status_code=400, detail=f"Не удалось прочитать файл Excel. Ошибка: {e}")

    start_row, header_map = -1, {}
    petrovich_headers = {"КОД", "ТОВАР", "КОЛИЧЕСТВО"}
    my_sklad_headers = {"INTERNAL_SKU", "NAME", "STOCK_QUANTITY"}

    for i, row in df.iterrows():
        row_values = {str(v).strip().upper() for v in row.dropna().values}
        header_map_raw = {str(v).strip().upper(
        ): col_idx for col_idx, v in enumerate(row.values)}
        if petrovich_headers.issubset(row_values):
            start_row = i
            header_map = {'sku': header_map_raw.get('КОД'), 'name': header_map_raw.get(
                'ТОВАР'), 'qty': header_map_raw.get('КОЛИЧЕСТВО'), 'price': header_map_raw.get('ЦЕНА')}
            break
        elif my_sklad_headers.issubset(row_values):
            start_row = i
            header_map = {'internal_sku': header_map_raw.get('INTERNAL_SKU'), 'name': header_map_raw.get(
                'NAME'), 'qty': header_map_raw.get('STOCK_QUANTITY'), 'sku': header_map_raw.get('SUPPLIER_SKU')}
            break
    if start_row == -1:
        raise HTTPException(
            status_code=400, detail="Не найдены заголовки ('КОД', 'ТОВАР'...) или ('INTERNAL_SKU', 'NAME'...)")

    data_df = df.iloc[start_row + 1:].where(pd.notna(df), None)

    if mode == ImportMode.TO_STOCK:
        report = {"created": [], "updated": [], "skipped": [], "errors": []}
        for i, row in data_df.iterrows():
            try:
                name_val = row.get(header_map.get('name'))
                qty_val = row.get(header_map.get('qty'))
                if not name_val or qty_val is None:
                    continue
                qty = float(qty_val)
                price_val = row.get(header_map.get('price'))
                price = float(price_val or 0.0)
                sku_val = row.get(header_map.get('sku'))
                sku = str(sku_val).strip() if sku_val else None
                internal_sku_val = row.get(header_map.get('internal_sku'))
                internal_sku = str(internal_sku_val).strip(
                ) if internal_sku_val else None

                product: Optional[Product] = None
                if sku:
                    product = session.exec(select(Product).where(
                        Product.supplier_sku == sku)).first()
                if not product and internal_sku:
                    product = session.exec(select(Product).where(
                        Product.internal_sku == internal_sku)).first()

                if product:
                    product.stock_quantity = qty if is_initial_load else product.stock_quantity + qty
                    product.purchase_price = price
                    session.add(product)
                    movement = StockMovement(
                        product_id=product.id, quantity=qty, type=MovementTypeEnum.INCOME, stock_after=product.stock_quantity)
                    session.add(movement)
                    report["updated"].append(f"{product.name}")
                elif auto_create_new:
                    final_internal_sku = internal_sku if internal_sku else f"AUTO-{sku or re.sub('[^0-9a-zA-Zа-яА-Я]+', '', str(name_val))[:10].upper()}"
                    new_product = Product(name=str(name_val), supplier_sku=sku, internal_sku=final_internal_sku,
                                          stock_quantity=qty, purchase_price=price, retail_price=price * 1.2)
                    session.add(new_product)
                    session.flush()
                    movement = StockMovement(product_id=new_product.id, quantity=qty,
                                             type=MovementTypeEnum.INCOME, stock_after=new_product.stock_quantity)
                    session.add(movement)
                    report["created"].append(f"{name_val}")
                else:
                    report["skipped"].append(
                        f"{name_val} (артикул {sku or internal_sku})")
            except Exception as e:
                report["errors"].append(f"Строка {i + start_row + 2}: {e}")
        session.commit()
        return report

    elif mode == ImportMode.AS_ESTIMATE:
        items_to_create, not_found_skus = [], []
        sku_col, qty_col, price_col = header_map.get(
            'sku'), header_map.get('qty'), header_map.get('price')
        for i, row in data_df.iterrows():
            try:
                sku_val, qty_val, price_val = row.get(sku_col), row.get(
                    qty_col), row.get(price_col) if price_col is not None else 0.0
                sku = str(sku_val).strip() if sku_val else None
                if not sku or qty_val is None:
                    continue
                qty, price = float(qty_val), float(price_val or 0.0)
                product = session.exec(select(Product).where(
                    Product.supplier_sku == sku)).first()
                if product:
                    items_to_create.append(
                        {"product_id": product.id, "quantity": qty, "price_from_file": price})
                else:
                    not_found_skus.append(sku)
            except (ValueError, TypeError, KeyError):
                continue
        if not_found_skus:
            raise HTTPException(
                status_code=404, detail=f"Товары с артикулами не найдены: {', '.join(not_found_skus)}")
        if not items_to_create:
            raise HTTPException(
                status_code=400, detail="Не найдено корректных товаров для сметы.")

        order_number = "б/н"
        try:
            order_cell_df = df[df.apply(lambda r: r.astype(
                str).str.contains('Заказ №', na=False).any(), axis=1)]
            if not order_cell_df.empty:
                order_cell = order_cell_df.values[0]
                order_number = str(next(s for s in order_cell if 'Заказ №' in str(s))).replace(
                    "Заказ №", "").strip()
        except Exception:
            pass

        new_estimate = Estimate(
            estimate_number=f"Импорт-{order_number}", client_name="Импорт из файла", location="Петрович")
        session.add(new_estimate)
        session.flush()
        for item in items_to_create:
            est_item = EstimateItem(product_id=item["product_id"], quantity=item["quantity"],
                                    unit_price=item["price_from_file"], estimate_id=new_estimate.id)
            session.add(est_item)
        session.commit()
        session.refresh(new_estimate)
        return new_estimate


def normalize_text(text: str) -> set:
    """
    Нормализует текст для сравнения: приводит к нижнему регистру,
    удаляет знаки препинания и возвращает множество слов.
    """
    if not text:
        return set()
    # Убираем все, кроме букв, цифр и пробелов
    cleaned_text = re.sub(r'[^а-яА-Яa-zA-Z0-9\s]', '', text.lower())
    # Возвращаем множество уникальных слов
    return set(cleaned_text.split())


def find_best_product_match(excel_name: str, all_products: List[Product]) -> Optional[Product]:
    """
    Находит наиболее подходящий товар в базе данных по имени из Excel.
    """
    if not excel_name or not all_products:
        return None

    excel_words = normalize_text(excel_name)
    if not excel_words:
        return None

    best_match = None
    highest_score = 0

    for db_product in all_products:
        db_words = normalize_text(db_product.name)

        # Считаем количество общих слов
        common_words_count = len(excel_words.intersection(db_words))

        # Простое условие: если совпало больше слов, это лучший кандидат
        if common_words_count > highest_score:
            highest_score = common_words_count
            best_match = db_product

    # Возвращаем результат только если есть хотя бы 2 общих слова,
    # чтобы избежать случайных совпадений по предлогам и т.д.
    if highest_score >= 2:
        return best_match

    return None


@app.post("/actions/import-1c-estimate/", summary="Импорт сметы из 1С (.xls)", tags=["Операции"])
async def import_1c_estimate(
    current_user: Annotated[dict, Depends(get_current_user)],
    file: UploadFile = File(...),
    session: Session = Depends(get_session)
):
    # Попытка прочитать Excel более устойчиво: пробуем несколько движков
    content = await file.read()
    excel_io = io.BytesIO(content)
    df = None
    read_errors = []
    for engine in (None, 'xlrd', 'openpyxl'):
        try:
            excel_io.seek(0)
            df = pd.read_excel(excel_io, header=None, engine=engine)
            break
        except Exception as e:
            read_errors.append(f"{engine}:{e}")

    if df is None:
        raise HTTPException(
            status_code=400,
            detail=f"Не удалось прочитать файл Excel. Поддерживаются форматы .xls и .xlsx. Ошибки: {'; '.join(read_errors)}"
        )

    # --- 1. Извлечение метаданных сметы ---
    estimate_number = "б/н"
    client_name = "Не определен"
    location = "Не определен"

    for index, row in df.iterrows():
        row_str = ' '.join(str(cell) for cell in row if pd.notna(cell))

        # Ищем номер и дату
        if "Коммерческое предложение №" in row_str:
            match = re.search(r'№\s*(\S+)\s*от', row_str)
            if match:
                estimate_number = match.group(1)

        # Ищем клиента
        if "Кому:" in row_str:
            try:
                # Более устойчивый парсинг имени клиента
                client_name = row_str.split("Кому:")[1].strip().split(',')[1].strip()
            except IndexError:
                # Если формат отличается, берем все что после "Кому:"
                client_name = row_str.split("Кому:")[1].strip()

        # Ищем тему/локацию
        if "Тема:" in row_str:
            theme_full = row_str.split("Тема:")[1].strip()
            parts = theme_full.split('_')
            if len(parts) > 1:
                location = parts[1]

    # --- 2. Извлечение позиций товаров ---
    items_to_create = []
    unmatched_items = []

    # Псевдонимы для поиска ключевых колонок в файле
    COLUMN_ALIASES = {
        'name': ['товары (работы, услуги)', 'товар', 'наименование'],
        'quantity': ['кол-во', 'количество'],
        'unit_price': ['цена']
    }

    # --- Этап 1: Находим строку заголовка и индексы нужных колонок ---
    column_map = {}
    header_row_idx = -1

    # Ищем реальные индексы колонок, просматривая весь файл
    for idx, row in df.iterrows():
        # Проверяем ячейки текущей строки, чтобы найти заголовки
        for col_key, cell_value in row.items():
            cell_str = str(cell_value).strip().lower()
            
            for map_key, aliases in COLUMN_ALIASES.items():
                if map_key not in column_map and cell_str in aliases:
                    column_map[map_key] = col_key
                    break
        
        if len(column_map) == len(COLUMN_ALIASES):
            header_row_idx = idx
            break

    if header_row_idx == -1:
        raise HTTPException(
            status_code=400,
            detail="Не удалось найти заголовок таблицы. Убедитесь, что файл содержит колонки с названиями 'Товары', 'Кол-во' и 'Цена'."
        )

    # --- Этап 2: Обрабатываем строки с данными, используя найденные индексы ---
    all_products = session.exec(select(Product).where(Product.is_deleted == False)).all()

    def parse_number(val):
        """Приводит значение к float, поддерживая разные форматы."""
        if val is None: return None
        if isinstance(val, (int, float)): return float(val)
        s = str(val).strip().replace('\u00A0', '').replace(' ', '').replace(',', '.')
        s = re.sub(r'[^0-9.\-]', '', s)
        try:
            return float(s)
        except (ValueError, TypeError):
            return None

    # Итерируемся по строкам, начиная со следующей после заголовка
    for index, row in df.iloc[header_row_idx + 1:].iterrows():
        row_str_full = ' '.join(str(cell) for cell in row if pd.notna(cell))
        if "Итого:" in row_str_full or "Всего наименований" in row_str_full:
            break

        product_name = str(row[column_map['name']]) if pd.notna(row[column_map['name']]) else None
        raw_quantity = row[column_map['quantity']] if pd.notna(row[column_map['quantity']]) else None
        raw_unit_price = row[column_map['unit_price']] if pd.notna(row[column_map['unit_price']]) else None

        quantity = parse_number(raw_quantity)
        unit_price = parse_number(raw_unit_price)

        if not product_name or quantity is None or unit_price is None or product_name.lower() == 'nan':
            continue

        try:
            matched_product = find_best_product_match(product_name, all_products)
            if matched_product:
                items_to_create.append({
                    "product_id": matched_product.id,
                    "quantity": float(quantity),
                    "unit_price": float(unit_price),
                })
            else:
                unmatched_items.append(product_name)
        except (ValueError, TypeError):
            continue

    # --- 3. Создание сметы ---
    if unmatched_items:
        raise HTTPException(
            status_code=404,
            detail=f"Не удалось создать смету. Следующие товары не найдены в базе: {'; '.join(unmatched_items)}."
        )

    if not items_to_create:
        raise HTTPException(
            status_code=400, detail="В файле не найдено ни одного товара для импорта."
        )

    new_estimate = Estimate(
        estimate_number=f"1C-{estimate_number}",
        client_name=client_name,
        location=location
    )
    session.add(new_estimate)
    session.flush()

    for item_data in items_to_create:
        estimate_item = EstimateItem(
            estimate_id=new_estimate.id,
            product_id=item_data["product_id"],
            quantity=item_data["quantity"],
            unit_price=item_data["unit_price"]
        )
        session.add(estimate_item)

    session.commit()
    session.refresh(new_estimate)

    return new_estimate
# --- Эндпоинты для Смет (Estimates) ---


@app.post("/estimates/", response_model=Estimate, summary="Создать новую смету", tags=["Сметы"])
def create_estimate(current_user: Annotated[dict, Depends(get_current_user)], request: EstimateCreate, session: Session = Depends(get_session)):
    new_estimate = Estimate(estimate_number=request.estimate_number,
                            client_name=request.client_name, location=request.location)
    for item_data in request.items:
        product = session.get(Product, item_data.product_id)
        if not product:
            raise HTTPException(
                status_code=404, detail=f"Товар с ID {item_data.product_id} не найден")
        estimate_item = EstimateItem(
            product_id=item_data.product_id,
            quantity=item_data.quantity,
            unit_price=product.retail_price,
            estimate=new_estimate
        )
        session.add(estimate_item)
    session.add(new_estimate)
    session.commit()
    session.refresh(new_estimate)
    return new_estimate


@app.get("/estimates/", response_model=EstimatePage, summary="Получить список смет", tags=["Сметы"])
def read_estimates(
    current_user: Annotated[dict, Depends(get_current_user)],
    search: Optional[str] = None,
    page: int = Query(1, gt=0),
    size: int = Query(20, gt=0, le=100),
    session: Session = Depends(get_session)
):
    offset = (page - 1) * size
    query = select(Estimate)
    if search:
        search_term = f"%{search}%"
        query = query.where(or_(Estimate.estimate_number.ilike(
            search_term), Estimate.client_name.ilike(search_term), Estimate.location.ilike(search_term)))
    count_query = select(func.count()).select_from(query.subquery())
    total_count = session.exec(count_query).one()
    paginated_query = query.offset(offset).limit(
        size).order_by(Estimate.id.desc())
    items = session.exec(paginated_query).all()
    return EstimatePage(total=total_count, items=items)


@app.get("/estimates/{estimate_id}", response_model=EstimateResponse, summary="Получить одну смету по ID", tags=["Сметы"])
def read_estimate(current_user: Annotated[dict, Depends(get_current_user)], estimate_id: int, session: Session = Depends(get_session)):
    estimate = session.get(Estimate, estimate_id)
    if not estimate:
        raise HTTPException(status_code=404, detail="Смета не найдена")
    response_items = []
    total_sum = 0
    for item in estimate.items:
        product = session.get(Product, item.product_id)
        response_items.append(EstimateItemResponse(id=item.id, quantity=item.quantity,
                              unit_price=item.unit_price, product_id=item.product_id, product_name=product.name))
        total_sum += item.quantity * item.unit_price
    return EstimateResponse(**estimate.model_dump(), items=response_items, total_sum=total_sum)


@app.patch("/estimates/{estimate_id}", response_model=Estimate, summary="Обновить смету", tags=["Сметы"])
def update_estimate(current_user: Annotated[dict, Depends(get_current_user)], estimate_id: int, request: EstimateUpdate, session: Session = Depends(get_session)):
    db_estimate = session.get(Estimate, estimate_id)
    if not db_estimate:
        raise HTTPException(status_code=404, detail="Смета не найдена")
    if db_estimate.status == EstimateStatusEnum.COMPLETED:
        raise HTTPException(
            status_code=400, detail="Нельзя редактировать завершенную смету.")
    if request.items is not None and db_estimate.status == EstimateStatusEnum.IN_PROGRESS:
        raise HTTPException(
            status_code=400, detail="Состав отгруженной сметы можно менять только через 'довыдачу'.")

    update_data = request.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if key != "items":
            setattr(db_estimate, key, value)

    if request.items is not None:
        items_to_delete = session.exec(select(EstimateItem).where(
            EstimateItem.estimate_id == estimate_id)).all()
        for item in items_to_delete:
            session.delete(item)
        for item_data in request.items:
            product = session.get(Product, item_data.product_id)
            if not product:
                raise HTTPException(
                    status_code=404, detail=f"Товар ID {item_data.product_id} не найден.")
            unit_price = item_data.unit_price if item_data.unit_price is not None else product.retail_price
            new_item = EstimateItem(estimate_id=estimate_id, product_id=product.id,
                                    quantity=item_data.quantity, unit_price=unit_price)
            session.add(new_item)
    session.add(db_estimate)
    session.commit()
    session.refresh(db_estimate)
    return db_estimate


@app.delete("/estimates/{estimate_id}", status_code=204, summary="Удалить смету", tags=["Сметы"])
def delete_estimate(current_user: Annotated[dict, Depends(get_current_user)], estimate_id: int, session: Session = Depends(get_session)):
    db_estimate = session.get(Estimate, estimate_id)
    if not db_estimate:
        raise HTTPException(status_code=404, detail="Смета не найдена")
    if db_estimate.status not in [EstimateStatusEnum.DRAFT, EstimateStatusEnum.APPROVED, EstimateStatusEnum.CANCELLED]:
        raise HTTPException(
            status_code=400, detail=f"Нельзя удалить смету в статусе '{db_estimate.status.value}'.")
    items_to_delete = session.exec(select(EstimateItem).where(
        EstimateItem.estimate_id == estimate_id)).all()
    for item in items_to_delete:
        session.delete(item)
    session.delete(db_estimate)
    session.commit()
    return None


@app.post("/estimates/{estimate_id}/ship", summary="Отгрузить товары по смете", tags=["Сметы"])
def ship_estimate(current_user: Annotated[dict, Depends(get_current_user)], estimate_id: int, worker_id: int = Query(...), session: Session = Depends(get_session)):
    estimate, worker = session.get(
        Estimate, estimate_id), session.get(Worker, worker_id)
    if not estimate:
        raise HTTPException(status_code=404, detail="Смета не найдена")
    if not worker:
        raise HTTPException(status_code=404, detail="Работник не найден")
    if estimate.status not in [EstimateStatusEnum.DRAFT, EstimateStatusEnum.APPROVED]:
        raise HTTPException(
            status_code=400, detail=f"Нельзя отгрузить смету в статусе '{estimate.status.value}'")

    for item in estimate.items:
        product = session.get(Product, item.product_id)
        if product.stock_quantity < item.quantity:
            raise HTTPException(
                status_code=400, detail=f"Недостаточно товара '{product.name}'. В наличии: {product.stock_quantity}, требуется: {item.quantity}")
        product.stock_quantity -= item.quantity
        movement = StockMovement(product_id=item.product_id, worker_id=worker.id, quantity=-
                                 item.quantity, type=MovementTypeEnum.ISSUE_TO_WORKER, stock_after=product.stock_quantity)
        session.add(product)
        session.add(movement)

    estimate.status = EstimateStatusEnum.IN_PROGRESS
    estimate.worker_id = worker.id
    session.add(estimate)
    session.commit()
    return {"message": f"Смета №{estimate.estimate_number} успешно отгружена на работника {worker.name}."}


@app.patch("/estimates/{estimate_id}/items/{item_id}", response_model=EstimateItem, summary="Обновить позицию в смете", tags=["Сметы"])
def update_estimate_item(current_user: Annotated[dict, Depends(get_current_user)], estimate_id: int, item_id: int, quantity: float = Query(..., gt=0), session: Session = Depends(get_session)):
    item = session.get(EstimateItem, item_id)
    if not item or item.estimate_id != estimate_id:
        raise HTTPException(status_code=404, detail="Позиция сметы не найдена")
    item.quantity = quantity
    session.add(item)
    session.commit()
    session.refresh(item)
    return item


@app.delete("/estimates/{estimate_id}/items/{item_id}", status_code=204, summary="Удалить позицию из сметы", tags=["Сметы"])
def delete_estimate_item(current_user: Annotated[dict, Depends(get_current_user)], estimate_id: int, item_id: int, session: Session = Depends(get_session)):
    item = session.get(EstimateItem, item_id)
    if not item or item.estimate_id != estimate_id:
        raise HTTPException(status_code=404, detail="Позиция сметы не найдена")
    session.delete(item)
    session.commit()
    return None


@app.post("/estimates/{estimate_id}/issue-additional", summary="Довыдача товаров по смете", tags=["Сметы"])
def issue_additional_items(current_user: Annotated[dict, Depends(get_current_user)], estimate_id: int, request: AddItemsRequest, session: Session = Depends(get_session)):
    estimate = session.get(Estimate, estimate_id)
    if not estimate:
        raise HTTPException(status_code=404, detail="Смета не найдена")
    if not estimate.worker_id:
        raise HTTPException(
            status_code=400, detail="Смета еще не отгружена, нельзя сделать довыдачу.")
    worker = session.get(Worker, estimate.worker_id)

    for item_data in request.items:
        product = session.get(Product, item_data.product_id)
        if not product:
            raise HTTPException(
                status_code=404, detail=f"Товар ID {item_data.product_id} не найден.")
        if product.stock_quantity < item_data.quantity:
            raise HTTPException(
                status_code=400, detail=f"Недостаточно товара '{product.name}'.")

        product.stock_quantity -= item_data.quantity
        new_item = EstimateItem(estimate_id=estimate_id, product_id=product.id,
                                quantity=item_data.quantity, unit_price=item_data.unit_price)
        movement = StockMovement(product_id=product.id, worker_id=worker.id, quantity=-item_data.quantity,
                                 type=MovementTypeEnum.ISSUE_TO_WORKER, stock_after=product.stock_quantity)
        session.add(product)
        session.add(new_item)
        session.add(movement)

    session.commit()
    return {"message": "Товары успешно довыданы."}


@app.post("/estimates/{estimate_id}/complete", summary="Завершить и закрыть смету", tags=["Сметы"])
def complete_estimate(current_user: Annotated[dict, Depends(get_current_user)], estimate_id: int, session: Session = Depends(get_session)):
    estimate = session.get(Estimate, estimate_id)
    if not estimate:
        raise HTTPException(status_code=404, detail="Смета не найдена")
    if estimate.status != EstimateStatusEnum.IN_PROGRESS:
        raise HTTPException(
            status_code=400, detail="Завершить можно только смету в статусе 'В работе'.")
    if not estimate.worker_id:
        raise HTTPException(
            status_code=400, detail="К смете не привязан работник.")

    estimate_items = session.exec(select(EstimateItem).where(
        EstimateItem.estimate_id == estimate_id)).all()
    for item in estimate_items:
        balance_query = select(func.sum(StockMovement.quantity)).where(
            StockMovement.worker_id == estimate.worker_id, StockMovement.product_id == item.product_id)
        on_hand_sum = session.exec(balance_query).one_or_none() or 0
        quantity_on_hand = -on_hand_sum
        if quantity_on_hand > 0:
            product = session.get(Product, item.product_id)
            write_off_movement = StockMovement(
                product_id=item.product_id,
                worker_id=estimate.worker_id,
                quantity=quantity_on_hand,
                type=MovementTypeEnum.WRITE_OFF_WORKER,
                stock_after=product.stock_quantity
            )
            session.add(write_off_movement)
    estimate.status = EstimateStatusEnum.COMPLETED
    session.add(estimate)
    session.commit()
    return {"message": "Смета успешно завершена. Фактический расход списан с работников."}


@app.get("/estimates/{estimate_id}/generate-commercial-proposal", summary="Сгенерировать КП .docx", tags=["Сметы"])
def generate_commercial_proposal_docx(current_user: Annotated[dict, Depends(get_current_user)], estimate_id: int, session: Session = Depends(get_session)):
    estimate = session.get(Estimate, estimate_id)
    if not estimate:
        raise HTTPException(status_code=404, detail="Смета не найдена")

    template_path = os.path.join(
        "templates", "commercial_proposal_template.docx")
    if not os.path.exists(template_path):
        raise HTTPException(status_code=500, detail="Шаблон КП не найден")
    doc = DocxTemplate(template_path)

    items_for_template, total_sum = [], 0
    for item in estimate.items:
        product = session.get(Product, item.product_id)
        item_total = item.quantity * item.unit_price
        total_sum += item_total
        items_for_template.append({
            'product_name': product.name, 'unit': product.unit.value, 'quantity': item.quantity,
            'unit_price': f"{item.unit_price:,.2f}".replace(",", " "), 'total': f"{item_total:,.2f}".replace(",", " ")
        })

    today = date.today()
    valid_until_date = today + timedelta(days=7)
    rubles, kopecks = int(total_sum), int((total_sum - int(total_sum)) * 100)
    total_sum_in_words = f"{num2words(rubles, lang='ru', to='currency', currency='RUB')} {kopecks:02d} копеек".capitalize(
    )
    theme = f"Работы по смете на объекте: {estimate.location or 'не указан'}"

    context = {
        'org_name': "ИП Бурмистров Дмитрий Георгиевич", 'estimate_number': estimate.estimate_number,
        'current_date_formatted': f"{today.day:02d} {['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'][today.month - 1]} {today.year} г.",
        'client_name': estimate.client_name, 'theme': theme, 'items': items_for_template,
        'total_sum_formatted': f"{total_sum:,.2f}".replace(",", " "), 'total_items_count': len(items_for_template),
        'total_sum_in_words': total_sum_in_words, 'valid_until_date_formatted': valid_until_date.strftime('%d.%m.%Y'),
        'entrepreneur_name': "Бурмистров Д. Г."
    }
    doc.render(context)
    output_filename = f"KP_{estimate.estimate_number.replace(' ', '_')}.docx"

    # Создаем временную папку, если ее нет
    output_dir = "temp_files"
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, output_filename)

    doc.save(output_path)
    return FileResponse(path=output_path, filename=output_filename, media_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document')


# --- Эндпоинты для Договоров (Contracts) ---

@app.post("/contracts/", response_model=Contract, summary="Создать новый договор", tags=["Договоры"])
def create_contract(current_user: Annotated[dict, Depends(get_current_user)], contract: Contract, session: Session = Depends(get_session)):
    session.add(contract)
    session.commit()
    session.refresh(contract)
    return contract


@app.get("/contracts/", response_model=List[Contract], summary="Получить список всех договоров", tags=["Договоры"])
def read_contracts(current_user: Annotated[dict, Depends(get_current_user)], session: Session = Depends(get_session)):
    return session.query(Contract).all()


@app.get("/contracts/{contract_id}", response_model=Contract, summary="Получить один договор по ID", tags=["Договоры"])
def read_contract(current_user: Annotated[dict, Depends(get_current_user)], contract_id: int, session: Session = Depends(get_session)):
    contract = session.get(Contract, contract_id)
    if not contract:
        raise HTTPException(status_code=404, detail="Договор не найден")
    return contract


@app.patch("/contracts/{contract_id}", response_model=Contract, summary="Обновить данные договора", tags=["Договоры"])
def update_contract(current_user: Annotated[dict, Depends(get_current_user)], contract_id: int, contract_update: ContractUpdate, session: Session = Depends(get_session)):
    db_contract = session.get(Contract, contract_id)
    if not db_contract:
        raise HTTPException(status_code=404, detail="Договор не найден")
    update_data = contract_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_contract, key, value)
    session.add(db_contract)
    session.commit()
    session.refresh(db_contract)
    return db_contract


@app.post("/contracts/{contract_id}/write-off-pipes", response_model=Contract, summary="Списать трубы и завершить договор", tags=["Договоры"])
def write_off_pipes_and_complete_contract(current_user: Annotated[dict, Depends(get_current_user)], contract_id: int, session: Session = Depends(get_session)):
    contract = session.get(Contract, contract_id)
    if not contract:
        raise HTTPException(status_code=404, detail="Договор не найден")
    if not contract.pipe_steel_used and not contract.pipe_plastic_used:
        raise HTTPException(
            status_code=400, detail="Не указано количество использованных труб.")

    messages = []
    pipe_skus_map = {"PIPE-STEEL-DRILL": contract.pipe_steel_used,
                     "PIPE-PLASTIC-DRILL": contract.pipe_plastic_used}
    for sku_anchor, qty in pipe_skus_map.items():
        if qty and qty > 0:
            product_query = select(Product).where(or_(func.trim(Product.internal_sku) == sku_anchor.strip(
            ), func.trim(Product.supplier_sku) == sku_anchor.strip()))
            product = session.exec(product_query).first()
            if not product:
                raise HTTPException(
                    status_code=404, detail=f"Товар с 'якорным' артикулом '{sku_anchor}' не найден.")
            if product.stock_quantity < qty:
                raise HTTPException(
                    status_code=400, detail=f"Недостаточно '{product.name}'.")
            product.stock_quantity -= qty
            movement = StockMovement(product_id=product.id, quantity=-qty,
                                     type=MovementTypeEnum.WRITE_OFF_CONTRACT, stock_after=product.stock_quantity)
            session.add(product)
            session.add(movement)
            messages.append(f"Списано '{product.name}': {qty} м.")

    if not messages:
        raise HTTPException(
            status_code=400, detail="Не указано количество труб > 0.")
    contract.status = ContractStatusEnum.COMPLETED
    session.add(contract)
    session.commit()
    session.refresh(contract)
    return contract


@app.get("/contracts/{contract_id}/generate-docx", summary="Сгенерировать договор .docx", tags=["Договоры"])
def generate_contract_docx(current_user: Annotated[dict, Depends(get_current_user)], contract_id: int, session: Session = Depends(get_session)):
    contract = session.get(Contract, contract_id)
    if not contract:
        raise HTTPException(status_code=404, detail="Договор не найден")

    if contract.contract_type == ContractTypeEnum.PUMPING:
        template_name = "contract_template_pumps.docx"
    else:
        template_name = "contract_template.docx"

    template_path = os.path.join("templates", template_name)
    if not os.path.exists(template_path):
        raise HTTPException(
            status_code=500, detail=f"Шаблон '{template_name}' не найден в папке 'templates'")

    doc = DocxTemplate(template_path)
    contract_date = contract.contract_date or date.today()
    estimated_cost = "____________"
    if contract.estimated_depth and contract.price_per_meter_soil:
        estimated_cost = int(contract.estimated_depth *
                             contract.price_per_meter_soil)

    def get_value(value, placeholder="_________________"):
        return value if value is not None else placeholder

    context = {
        'contract_number': get_value(contract.contract_number, "б/н"),
        'contract_day': contract_date.strftime('%d'),
        'contract_month_ru': ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"][contract_date.month - 1],
        'contract_year': contract_date.strftime('%Y'),
        'client_name': get_value(contract.client_name),
        'location': get_value(contract.location),
        'estimated_depth': get_value(contract.estimated_depth, "____"),
        'price_per_meter_soil': get_value(contract.price_per_meter_soil, "____"),
        'price_per_meter_rock': get_value(contract.price_per_meter_rock, "____"),
        'estimated_total_cost': estimated_cost,
        'passport_series_number': get_value(contract.passport_series_number),
        'passport_issued_by': get_value(contract.passport_issued_by),
        'passport_issue_date': get_value(contract.passport_issue_date),
        'passport_dep_code': get_value(contract.passport_dep_code),
        'passport_address': get_value(contract.passport_address),
    }
    doc.render(context)

    output_dir = "temp_files"
    os.makedirs(output_dir, exist_ok=True)
    output_filename = f"Contract_{contract.contract_number}.docx"
    output_path = os.path.join(output_dir, output_filename)
    doc.save(output_path)

    return FileResponse(path=output_path, filename=output_filename, media_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document')

# --- Эндпоинты для Отчетов (Reports) ---


@app.get("/reports/profit", response_model=ProfitReportResponse, summary="Отчет по прибыли", tags=["Отчеты"])
def get_profit_report(
    current_user: Annotated[dict, Depends(get_current_user)],
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    estimate_id: Optional[int] = None,
    session: Session = Depends(get_session)
):
    query = select(Estimate).where(Estimate.status.in_(
        [EstimateStatusEnum.COMPLETED, EstimateStatusEnum.IN_PROGRESS]))
    if estimate_id:
        query = query.where(Estimate.id == estimate_id)
    elif start_date and end_date:
        end_date_inclusive = end_date + timedelta(days=1)
        query = query.where(Estimate.created_at >= start_date,
                            Estimate.created_at < end_date_inclusive)
    else:
        return ProfitReportResponse(items=[], grand_total_retail=0, grand_total_purchase=0, grand_total_profit=0, average_margin=0)

    estimates = session.exec(query).all()
    report_items = []
    grand_total_retail, grand_total_purchase = 0, 0
    for estimate in estimates:
        total_retail, total_purchase = 0, 0
        if not estimate.worker_id:
            continue
        for item in estimate.items:
            total_retail += item.quantity * item.unit_price
            if item.product:
                total_purchase += item.quantity * item.product.purchase_price
        profit = total_retail - total_purchase
        margin = (profit / total_retail * 100) if total_retail > 0 else 0
        report_items.append(ProfitReportItem(
            estimate_id=estimate.id, estimate_number=estimate.estimate_number, client_name=estimate.client_name,
            completed_at=estimate.created_at.date(), total_retail=total_retail, total_purchase=total_purchase,
            profit=profit, margin=margin
        ))
        grand_total_retail += total_retail
        grand_total_purchase += total_purchase

    grand_total_profit = grand_total_retail - grand_total_purchase
    average_margin = (grand_total_profit / grand_total_retail *
                      100) if grand_total_retail > 0 else 0

    return ProfitReportResponse(
        items=report_items, grand_total_retail=grand_total_retail, grand_total_purchase=grand_total_purchase,
        grand_total_profit=grand_total_profit, average_margin=average_margin
    )

# --- Эндпоинт для Дашборда ---


@app.get("/dashboard/summary", response_model=DashboardSummary, summary="Сводка для дашборда", tags=["Дашборд"])
def get_dashboard_summary(current_user: Annotated[dict, Depends(get_current_user)], session: Session = Depends(get_session)):
    products_to_order_count = session.exec(select(func.count(Product.id)).where(
        Product.is_deleted == False, Product.stock_quantity > 0, Product.stock_quantity <= Product.min_stock_level
    )).one()
    estimates_in_progress_count = session.exec(select(func.count(Estimate.id)).where(
        Estimate.status == EstimateStatusEnum.IN_PROGRESS
    )).one()
    contracts_in_progress_count = session.exec(select(func.count(Contract.id)).where(
        Contract.status == ContractStatusEnum.IN_PROGRESS
    )).one()

    thirty_days_ago = date.today() - timedelta(days=30)
    profit_estimates = session.exec(select(Estimate).where(
        Estimate.status.in_([EstimateStatusEnum.COMPLETED,
                            EstimateStatusEnum.IN_PROGRESS]),
        Estimate.created_at >= thirty_days_ago
    )).all()

    total_profit = 0
    for estimate in profit_estimates:
        if not estimate.items:
            continue
        total_retail = sum(
            item.quantity * item.unit_price for item in estimate.items)
        total_purchase = sum(
            item.quantity * item.product.purchase_price for item in estimate.items if item.product)
        total_profit += total_retail - total_purchase

    return DashboardSummary(
        products_to_order_count=products_to_order_count,
        estimates_in_progress_count=estimates_in_progress_count,
        contracts_in_progress_count=contracts_in_progress_count,
        profit_last_30_days=total_profit
    )

# --- Служебные эндпоинты ---


@app.post("/actions/clear-all-data/", summary="!!! ОПАСНО: Удалить ВСЕ данные !!!", tags=["_Служебное_"])
def clear_all_data(current_user: Annotated[dict, Depends(get_current_user)], session: Session = Depends(get_session)):
    session.query(StockMovement).delete()
    session.query(EstimateItem).delete()
    session.query(Estimate).delete()
    session.query(Contract).delete()
    session.query(Worker).delete()
    session.query(Product).delete()
    session.commit()
    return {"message": "Все данные успешно удалены."}
