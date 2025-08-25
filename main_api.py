# main_api.py

# --- 1. Стандартная библиотека ---
import io
import os
import re
import logging
import hashlib
import tempfile
from datetime import date, datetime, timedelta, timezone
from enum import Enum
from typing import List, Optional, Annotated, Type, Any

# --- 2. Сторонние библиотеки ---
import pandas as pd
from docxtpl import DocxTemplate
from fastapi import (
    FastAPI, Depends, Form, HTTPException, UploadFile,
    File, Query, BackgroundTasks
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fuzzywuzzy import process as fuzzy_process
from jose import JWTError, jwt
from num2words import num2words
from passlib.context import CryptContext
from pydantic import BaseModel
from sqlalchemy import func, or_, text
from sqlalchemy.orm import selectinload
from sqlmodel import SQLModel, create_engine, Session, select
import supabase

# --- 3. Локальные импорты ---
# Убедитесь, что у вас есть файлы config.py и main_models.py
import config
from main_models import (
    Estimate, EstimateItem, EstimateStatusEnum,
    Contract, ContractStatusEnum, ContractTypeEnum,
    UnitEnum, Product, Worker, StockMovement, MovementTypeEnum
)
from supabase import create_client, Client, PostgrestAPIError

# --- Настройка логирования ---
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# --- Настройка подключения к базе данных ---
engine = create_engine(config.DATABASE_URL)

# Инициализация клиента Supabase (глобально)
try:
    supabase_client = create_client(config.SUPABASE_URL, config.SUPABASE_KEY)
except Exception:
    supabase_client = None


def create_db_and_tables():
    logger.info("Создание таблиц в базе данных...")
    SQLModel.metadata.create_all(engine)
    logger.info("Таблицы успешно созданы (или уже существовали).")
    # Небольшая runtime-миграция: если мы добавили поле shipped_at в модель, но
    # таблица уже существует без этой колонки, автоматически добавим колонку.
    try:
        with engine.begin() as conn:
            res = conn.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name='estimate' AND column_name='shipped_at'"))
            if res.first() is None:
                logger.info("Колонка 'shipped_at' не найдена в таблице estimate — добавляю...")
                conn.execute(text("ALTER TABLE estimate ADD COLUMN shipped_at TIMESTAMP WITH TIME ZONE"))
                logger.info("Колонка 'shipped_at' успешно добавлена.")
            # Runtime-миграция: убедимся, что enum movementtypeenum содержит необходимые значения
            try:
                enum_vals = conn.execute(text("SELECT enum_range(NULL::movementtypeenum)")).scalar()
                if enum_vals and 'WRITE_OFF_WORKER' not in enum_vals:
                    logger.info("Значение 'WRITE_OFF_WORKER' не найдено в movementtypeenum — добавляю...")
                    conn.execute(text("ALTER TYPE movementtypeenum ADD VALUE 'WRITE_OFF_WORKER'"))
                    logger.info("Значение 'WRITE_OFF_WORKER' успешно добавлено в movementtypeenum.")
            except Exception as enum_exc:
                # Если enum не существует или привязка иная — логируем и пропускаем
                logger.debug(f"Не удалось проверить/обновить movementtypeenum: {enum_exc}")
    except Exception as e:
        logger.exception(f"Не удалось выполнить миграцию shipped_at: {e}")


# --- КОНФИГУРАЦИЯ БЕЗОПАСНОСТИ ---
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

# --- Вспомогательные функции для аутентификации ---


def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + \
        timedelta(minutes=config.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(
        to_encode, config.SECRET_KEY, algorithm=config.ALGORITHM)
    return encoded_jwt


async def get_current_user(token: Annotated[str, Depends(oauth2_scheme)]):
    credentials_exception = HTTPException(
        status_code=401,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    # Попытка 1: это наш собственный JWT, подписанный SECRET_KEY
    try:
        payload = jwt.decode(token, config.SECRET_KEY, algorithms=[config.ALGORITHM])
        return payload
    except JWTError:
        # Если не наш токен — пробуем декодировать как Supabase JWT (backwards compatibility)
        try:
            payload = jwt.decode(
                token,
                config.SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                audience="authenticated"
            )
            return payload
        except JWTError as e:
            logger.error(f"Ошибка JWT при проверке токена: {e}")
            raise credentials_exception


# --- Основное приложение FastAPI ---
app = FastAPI(
    title="Sklad V4 API",
    description="API для управления складской системой."
)

# --- НАСТРОЙКА CORS ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Зависимость для сессии БД и вспомогательные функции ---
def get_session():
    with Session(engine) as session:
        yield session


def get_db_object_or_404(model: Type[SQLModel], obj_id: int, session: Session) -> SQLModel:
    obj = session.get(model, obj_id)
    if not obj:
        raise HTTPException(
            status_code=404, detail=f"{model.__name__} с ID {obj_id} не найден")
    return obj


# --- Событие при старте приложения ---
@app.on_event("startup")
def on_startup():
    create_db_and_tables()


# --- Эндпоинт для получения токена ---
@app.post("/token", summary="Получить токен доступа", tags=["Аутентификация"])
async def login_for_access_token(form_data: Annotated[OAuth2PasswordRequestForm, Depends()]):
    try:
        # Используем переименованный клиент и вызываем метод входа
        res = supabase_client.auth.sign_in_with_password({
            "email": form_data.username,
            "password": form_data.password
        })

        # Надежная проверка ответа, как вы и предложили.
        # Успешный ответ содержит объект session с access_token.
        if res and res.session and res.session.access_token:
            # Попробуем получить идентификатор пользователя из ответа Supabase
            user_id = None
            try:
                # Некоторый SDK возвращает res.user или res.session.user
                if hasattr(res, 'user') and getattr(res, 'user') and getattr(res.user, 'id', None):
                    user_id = res.user.id
                elif getattr(res.session, 'user', None) and getattr(res.session.user, 'id', None):
                    user_id = res.session.user.id
            except Exception:
                user_id = None

            # fallback: используем email как суб-идентификатор
            if not user_id:
                user_id = form_data.username

            our_token = create_access_token({"sub": user_id})
            return {"access_token": our_token, "token_type": "bearer"}
        else:
            # Если ответ пришел, но он пустой или в неожиданном формате
            logger.error(
                f"Неожиданный ответ от Supabase при аутентификации: {res}")
            raise HTTPException(
                status_code=401, detail="Не удалось получить токен из ответа Supabase")

    except Exception as e:
        # Если Supabase вернул ошибку (неверный пароль, пользователь не найден и т.д.)
        logger.error(f"Ошибка аутентификации Supabase: {e}")
        raise HTTPException(
            status_code=401,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

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
    shipped_at: Optional[datetime]
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
    if product.stock_quantity > 0:
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
        search_term = f"%{search}%"
        query = query.where(
            or_(
                Product.name.ilike(search_term),
                Product.internal_sku.ilike(search_term),
                Product.supplier_sku.ilike(search_term)
            )
        )
    if stock_status == StockStatusFilter.LOW_STOCK:
        # Only consider products that have a configured minimum stock (> 0).
        # Show products where current stock is less or equal to the configured minimum.
        query = query.where((Product.min_stock_level > 0) & (Product.stock_quantity <= Product.min_stock_level))
    elif stock_status == StockStatusFilter.OUT_OF_STOCK:
        query = query.where(Product.stock_quantity <= 0)

    count_query = select(func.count()).select_from(query.subquery())
    total_count = session.exec(count_query).one()
    paginated_query = query.offset(offset).limit(
        size).order_by(Product.is_favorite.desc(), Product.name)
    items = session.exec(paginated_query).all()
    return ProductPage(total=total_count, items=items)


@app.patch("/products/{product_id}", response_model=Product, summary="Обновить товар", tags=["Товары"])
def update_product(current_user: Annotated[dict, Depends(get_current_user)], product_id: int, product_update: ProductUpdate, session: Session = Depends(get_session)):
    db_product = get_db_object_or_404(Product, product_id, session)

    old_quantity = db_product.stock_quantity
    update_data = product_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_product, key, value)

    if 'stock_quantity' in update_data and old_quantity != db_product.stock_quantity:
        quantity_diff = db_product.stock_quantity - old_quantity
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
    product = get_db_object_or_404(Product, product_id, session)
    product.is_deleted = True
    session.add(product)
    session.commit()
    session.refresh(product)
    return product


@app.post("/products/{product_id}/restore", response_model=Product, summary="Восстановить товар", tags=["Товары"])
def restore_product(current_user: Annotated[dict, Depends(get_current_user)], product_id: int, session: Session = Depends(get_session)):
    product = get_db_object_or_404(Product, product_id, session)
    product.is_deleted = False
    session.add(product)
    session.commit()
    session.refresh(product)
    return product


@app.patch("/products/{product_id}/toggle-favorite", response_model=Product, summary="Переключить статус 'Избранное'", tags=["Товары"])
def toggle_favorite(current_user: Annotated[dict, Depends(get_current_user)], product_id: int, session: Session = Depends(get_session)):
    product = get_db_object_or_404(Product, product_id, session)
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
    return session.exec(select(Worker).order_by(Worker.name)).all()


@app.patch("/workers/{worker_id}", response_model=Worker, summary="Обновить работника", tags=["Работники"])
def update_worker(current_user: Annotated[dict, Depends(get_current_user)], worker_id: int, worker_update: WorkerUpdate, session: Session = Depends(get_session)):
    db_worker = get_db_object_or_404(Worker, worker_id, session)
    db_worker.name = worker_update.name
    session.add(db_worker)
    session.commit()
    session.refresh(db_worker)
    return db_worker


@app.delete("/workers/{worker_id}", status_code=204, summary="Удалить работника", tags=["Работники"])
def delete_worker(current_user: Annotated[dict, Depends(get_current_user)], worker_id: int, session: Session = Depends(get_session)):
    db_worker = get_db_object_or_404(Worker, worker_id, session)
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
    product = get_db_object_or_404(Product, request.product_id, session)
    worker = get_db_object_or_404(Worker, request.worker_id, session)
    if request.quantity <= 0:
        raise HTTPException(
            status_code=400, detail="Количество должно быть > 0")
    if product.stock_quantity < request.quantity:
        raise HTTPException(
            status_code=400, detail=f"Недостаточно товара. В наличии: {product.stock_quantity}")

    product.stock_quantity -= request.quantity
    movement = StockMovement(
        product_id=request.product_id, worker_id=request.worker_id,
        quantity=-request.quantity, type=MovementTypeEnum.ISSUE_TO_WORKER,
        stock_after=product.stock_quantity
    )
    session.add(product)
    session.add(movement)
    session.commit()
    session.refresh(movement)
    return movement


@app.post("/actions/return-item/", response_model=StockMovement, summary="Принять возврат от работника", tags=["Операции"])
def return_item_from_worker(current_user: Annotated[dict, Depends(get_current_user)], request: ReturnItemRequest, session: Session = Depends(get_session)):
    product = get_db_object_or_404(Product, request.product_id, session)
    worker = get_db_object_or_404(Worker, request.worker_id, session)
    if request.quantity <= 0:
        raise HTTPException(
            status_code=400, detail="Количество должно быть > 0")

    product.stock_quantity += request.quantity
    movement = StockMovement(
        product_id=request.product_id, worker_id=request.worker_id,
        quantity=request.quantity, type=MovementTypeEnum.RETURN_FROM_WORKER,
        stock_after=product.stock_quantity
    )
    session.add(product)
    session.add(movement)
    session.commit()
    session.refresh(movement)
    return movement


@app.get("/actions/worker-stock/{worker_id}", response_model=List[WorkerStockItem], summary="Получить товары на руках у работника", tags=["Операции"])
def get_worker_stock(current_user: Annotated[dict, Depends(get_current_user)], worker_id: int, session: Session = Depends(get_session)):
    get_db_object_or_404(Worker, worker_id, session)
    results = session.exec(select(
        Product.id, Product.name, Product.unit, func.sum(
            StockMovement.quantity)
    ).join(Product).where(StockMovement.worker_id == worker_id).group_by(
        Product.id, Product.name, Product.unit
    )).all()
    worker_stock = []
    for product_id, product_name, unit, total_quantity in results:
        quantity_on_hand = -total_quantity
        if quantity_on_hand > 0.001:  # Порог для чисел с плавающей точкой
            worker_stock.append(WorkerStockItem(
                product_id=product_id, product_name=product_name,
                quantity_on_hand=round(quantity_on_hand, 3), unit=unit.value
            ))
    return worker_stock


@app.post("/actions/write-off-item/", response_model=StockMovement, summary="Списать товар, числящийся за работником", tags=["Операции"])
def write_off_item_from_worker(current_user: Annotated[dict, Depends(get_current_user)], request: WriteOffItemRequest, session: Session = Depends(get_session)):
    product = get_db_object_or_404(Product, request.product_id, session)
    worker = get_db_object_or_404(Worker, request.worker_id, session)

    if request.quantity <= 0:
        raise HTTPException(status_code=400, detail="Количество для списания должно быть больше нуля.")

    # Рассчитываем текущий баланс на руках у работника
    current_on_hand_sum = session.exec(select(func.coalesce(func.sum(StockMovement.quantity), 0)).where(
        StockMovement.worker_id == request.worker_id,
        StockMovement.product_id == request.product_id
    )).one()
    quantity_on_hand = -float(current_on_hand_sum)

    # Проверяем, достаточно ли товара для списания
    if quantity_on_hand < request.quantity:
        raise HTTPException(
            status_code=400, detail=f"У работника на руках только {quantity_on_hand:.2f} шт. Нельзя списать {request.quantity:.2f} шт.")

    # ГАРАНТИРУЕМ, ЧТО СПИСАНИЕ БУДЕТ ПОЛОЖИТЕЛЬНЫМ ЧИСЛОМ, ИСПОЛЬЗУЯ abs()
    # Это ключевое изменение для исправления бага.
    write_off_quantity = abs(request.quantity)

    movement = StockMovement(
        product_id=request.product_id,
        worker_id=request.worker_id,
        quantity=write_off_quantity,  # Используем гарантированно положительное значение
        type=MovementTypeEnum.WRITE_OFF_WORKER,
        stock_after=product.stock_quantity  # Остаток на общем складе не меняется
    )

    # Добавляем лог для отладки, чтобы видеть, что именно сохраняется в БД
    logger.info(f"ЗАПИСЬ ДВИЖЕНИЯ СПИСАНИЯ: Работник ID={movement.worker_id}, Товар ID={movement.product_id}, Количество={movement.quantity}")

    session.add(movement)
    session.commit()
    session.refresh(movement)
    return movement


@app.get("/actions/history/", response_model=List[dict], summary="Получить историю всех движений", tags=["Операции"])
def get_history(current_user: Annotated[dict, Depends(get_current_user)], session: Session = Depends(get_session)):
    # PERFORMANCE: N+1 FIX
    query = select(StockMovement).options(
        selectinload(StockMovement.product),
        selectinload(StockMovement.worker)
    ).order_by(StockMovement.id.desc())
    history_records = session.exec(query).all()
    response = []
    for m in history_records:
        response.append({
            "id": m.id, "timestamp": m.timestamp, "type": m.type, "quantity": m.quantity, "stock_after": m.stock_after,
            "product": {"name": m.product.name if m.product and not m.product.is_deleted else "Товар удален"},
            "worker": {"name": m.worker.name} if m.worker else None
        })
    return response


@app.post("/actions/history/cancel/{movement_id}", summary="Отменить движение товара", tags=["Операции"])
def cancel_movement(current_user: Annotated[dict, Depends(get_current_user)], movement_id: int, session: Session = Depends(get_session)):
    original_movement = get_db_object_or_404(
        StockMovement, movement_id, session)
    if "Отмена" in original_movement.type:
        raise HTTPException(
            status_code=400, detail="Нельзя отменить операцию отмены.")

    product = session.get(Product, original_movement.product_id)
    if not product or product.is_deleted:
        raise HTTPException(
            status_code=404, detail="Связанный товар был удален.")

    correction_quantity = -original_movement.quantity
    # BUG FIX: Проверка на отрицательный остаток
    if (product.stock_quantity + correction_quantity) < 0 and original_movement.type in [
        MovementTypeEnum.INCOME, MovementTypeEnum.RETURN_FROM_WORKER, MovementTypeEnum.ADJUSTMENT
    ]:
        raise HTTPException(
            status_code=400, detail=f"Отмена операции приведет к отрицательному остатку товара '{product.name}'.")

    # Корректируем остаток на складе только если операция влияла на него
    if original_movement.type in [MovementTypeEnum.INCOME, MovementTypeEnum.RETURN_FROM_WORKER, MovementTypeEnum.ISSUE_TO_WORKER, MovementTypeEnum.ADJUSTMENT]:
        product.stock_quantity += correction_quantity
        session.add(product)

    correction_movement = StockMovement(
        product_id=original_movement.product_id, worker_id=original_movement.worker_id,
        quantity=correction_quantity, type=f"Отмена ({original_movement.type})",
        stock_after=product.stock_quantity
    )
    session.add(correction_movement)
    session.commit()
    return {"message": f"Операция ID {movement_id} успешно отменена."}


# --- REFACTOR: Логика импорта ---
def _parse_number_robust(val) -> Optional[float]:
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return float(val)
    s = str(val).strip().replace('\u00A0', '').replace(
        ' ', '').replace(',', '.')
    s = re.sub(r'[^0-9.\-]', '', s)
    try:
        return float(s)
    except (ValueError, TypeError):
        return None


def find_best_product_match_fuzzy(excel_name: str, product_name_map: dict) -> Optional[Product]:
    if not excel_name or not product_name_map:
        return None
    best_match, score = fuzzy_process.extractOne(
        excel_name, product_name_map.keys())
    return product_name_map[best_match] if score > 80 else None


def generate_unique_internal_sku(name: str, sku: Optional[str]) -> str:
    base = sku or re.sub('[^0-9a-zA-Zа-яА-Я]+', '', name)[:10].upper()
    unique_hash = hashlib.sha1(name.encode()).hexdigest()[:6]
    return f"AUTO-{base}-{unique_hash}"


@app.post("/actions/import-1c-estimate/", summary="Импорт сметы из 1С (.xls)", tags=["Операции"])
async def import_1c_estimate(current_user: Annotated[dict, Depends(get_current_user)], file: UploadFile = File(...), session: Session = Depends(get_session)):
    try:
        df = pd.read_excel(io.BytesIO(await file.read()), header=None, engine='calamine')
    except Exception as e:
        raise HTTPException(
            status_code=400, detail=f"Не удалось прочитать файл Excel. Ошибка: {e}")
    # +++ ДИАГНОСТИЧЕСКИЙ БЛОК (ВСТАВЬТЕ ЕГО СЮДА) +++
    print("\n--- ДИАГНОСТИКА EXCEL ФАЙЛА (1C) ---")
    print("Содержимое первых 15 строк, как их видит Pandas:")
    print(df.head(15).to_string())
    print("--- КОНЕЦ ДИАГНОСТИКИ ---\n")
    # +++ КОНЕЦ БЛОКА +++
    estimate_number, client_name, location = "б/н", "Не определен", "Не определен"
    # Build a cleaned text representation for extracting metadata.
    # Remove repeated 'nan' tokens that come from empty Excel cells.
    text_rows = []
    for i, row in df.head(20).iterrows():
        # join cells with a single space, filter out NaNs
        cells = [str(x).strip() for x in row.values if pd.notna(x) and str(x).strip().lower() != 'nan']
        if cells:
            text_rows.append(' '.join(cells))
    full_text = '\n'.join(text_rows)

    # Try to extract estimate number, client name and location from the cleaned rows
    if match := re.search(r'Коммерческое предложение №\s*(\S+)', full_text, re.IGNORECASE):
        estimate_number = match.group(1)
    # Prefer explicit 'Кому:' lines
    if match := re.search(r'Кому:\s*([^\n,]+)', full_text, re.IGNORECASE):
        client_name = match.group(1).strip()
    else:
        # fallback: first non-empty line that looks like a person/name (contains Cyrillic letters)
        for line in text_rows:
            if re.search(r'[А-Яа-яЁё]', line):
                client_name = line.strip()
                break
    if match := re.search(r'Тема:\s*[^\n_]+_(.*)', full_text, re.IGNORECASE):
        location = match.group(1).strip()

    # Flexible header matching: normalize both Excel cell text and alias tokens
    def _normalize_header_text(s: Any) -> str:
        if s is None:
            return ""
        s = str(s).strip().lower()
        # keep letters, digits and spaces; remove punctuation like hyphens and non-breaking spaces
        s = re.sub(r'[^а-яa-z0-9\s]', '', s)
        s = re.sub(r'\s+', ' ', s)
        return s

    ALIASES = {
        'name': ['товары', 'товар', 'наименование', 'наименование товара'],
        'quantity': ['кол-во', 'количество', 'кол'],
        'unit_price': ['цена', 'стоимость']
    }

    # Pre-normalize aliases so we compare like-with-like (handles hyphens etc.)
    normalized_aliases = {k: [_normalize_header_text(a) for a in v] for k, v in ALIASES.items()}

    column_map, header_row_idx = {}, -1
    for idx, row in df.iterrows():
        for col_idx, cell_val in row.items():
            cell_norm = _normalize_header_text(cell_val)
            for map_key, alias_list in normalized_aliases.items():
                if map_key in column_map:
                    continue
                for alias_norm in alias_list:
                    if alias_norm and alias_norm in cell_norm:
                        column_map[map_key] = col_idx
                        break
        if len(column_map) == len(ALIASES):
            header_row_idx = idx
            break
    if header_row_idx == -1:
        # Build a small preview of the first rows to help debug header mismatches
        preview_rows = []
        max_preview = 5
        for i, row in df.head(max_preview).iterrows():
            cells = [(_normalize_header_text(c)[:40] + ("..." if len(str(c)) > 40 else "")) for c in row.values]
            preview_rows.append(f"Row {i}: " + " | ".join(cells))
        preview_text = "\\n".join(preview_rows)
        raise HTTPException(
            status_code=400,
            detail=("Не найдены заголовки ('Товары', 'Кол-во', 'Цена'). "
                    "Проверьте структуру файла. Превью первых строк:\n" + preview_text)
        )

    all_products = session.exec(select(Product).where(
        Product.is_deleted == False)).all()
    product_map = {p.name: p for p in all_products}
    items_to_create, unmatched_items = [], []

    for _, row in df.iloc[header_row_idx + 1:].iterrows():
        if row.astype(str).str.contains("Итого:|Всего наименований", na=False).any():
            break
        product_name = str(row.get(column_map['name']))
        quantity = _parse_number_robust(row.get(column_map['quantity']))
        unit_price = _parse_number_robust(row.get(column_map['unit_price']))
        if not product_name or quantity is None or unit_price is None or product_name.lower() == 'nan':
            continue

        if matched := find_best_product_match_fuzzy(product_name, product_map):
            items_to_create.append(
                {"product_id": matched.id, "quantity": quantity, "unit_price": unit_price})
        else:
            unmatched_items.append(product_name)

    if unmatched_items:
        raise HTTPException(
            status_code=404, detail=f"Товары не найдены: {'; '.join(unmatched_items)}.")
    if not items_to_create:
        raise HTTPException(
            status_code=400, detail="Не найдено товаров для импорта.")

    new_estimate = Estimate(
        estimate_number=f"1C-{estimate_number}", client_name=client_name, location=location)
    session.add(new_estimate)
    session.flush()
    for item_data in items_to_create:
        session.add(EstimateItem(estimate_id=new_estimate.id, **item_data))
    session.commit()
    session.refresh(new_estimate)
    return new_estimate


@app.post("/actions/universal-import/", summary="Универсальный импорт", tags=["Операции"])
async def universal_import(
    current_user: Annotated[dict, Depends(get_current_user)],
    mode: ImportMode = Form(...), is_initial_load: bool = Form(False), auto_create_new: bool = Form(True),
    file: UploadFile = File(...), session: Session = Depends(get_session)
):
    try:
        df = pd.read_excel(io.BytesIO(await file.read()), header=None, engine='calamine')
    except Exception as e:
        raise HTTPException(
            status_code=400, detail=f"Ошибка чтения Excel: {e}")

    start_row, header_map = -1, {}
    HEADER_SETS = {
        "petrovich": {"КОД", "ТОВАР", "КОЛИЧЕСТВО"},
        "my_sklad": {"INTERNAL_SKU", "NAME", "STOCK_QUANTITY"}
    }

    for i, row in df.iterrows():
        row_values = {str(v).strip().upper() for v in row.dropna().values}
        header_map_raw = {str(v).strip().upper(
        ): col_idx for col_idx, v in enumerate(row.values)}
        if HEADER_SETS["petrovich"].issubset(row_values):
            start_row, header_map = i, {
                'sku': 'КОД', 'name': 'ТОВАР', 'qty': 'КОЛИЧЕСТВО', 'price': 'ЦЕНА'}
            break
        elif HEADER_SETS["my_sklad"].issubset(row_values):
            start_row, header_map = i, {'internal_sku': 'INTERNAL_SKU',
                                        'name': 'NAME', 'qty': 'STOCK_QUANTITY', 'sku': 'SUPPLIER_SKU'}
            break
    if start_row == -1:
        raise HTTPException(
            status_code=400, detail="Не найдены обязательные заголовки в файле.")

    col_map = {k: header_map_raw.get(
        v) for k, v in header_map.items() if header_map_raw.get(v) is not None}
    data_df = df.iloc[start_row + 1:].where(pd.notna(df), None)

    if mode == ImportMode.TO_STOCK:
        report = {"created": [], "updated": [], "skipped": [], "errors": []}
        for i, row in data_df.iterrows():
            try:
                name_val = row.get(col_map.get('name'))
                qty_val = row.get(col_map.get('qty'))
                if not name_val or qty_val is None:
                    continue
                qty = float(qty_val)
                price = float(row.get(col_map.get('price'), 0.0) or 0.0)
                sku = str(row.get(col_map.get('sku'))).strip(
                ) if row.get(col_map.get('sku')) else None
                internal_sku = str(row.get(col_map.get('internal_sku'))).strip(
                ) if row.get(col_map.get('internal_sku')) else None

                product_q = select(Product)
                if sku:
                    product_q = product_q.where(Product.supplier_sku == sku)
                elif internal_sku:
                    product_q = product_q.where(
                        Product.internal_sku == internal_sku)
                else:
                    product_q = None

                product = session.exec(product_q).first(
                ) if product_q is not None else None

                if product:
                    product.stock_quantity = qty if is_initial_load else product.stock_quantity + qty
                    product.purchase_price = price
                    session.add(product)
                    session.add(StockMovement(product_id=product.id, quantity=qty,
                                type=MovementTypeEnum.INCOME, stock_after=product.stock_quantity))
                    report["updated"].append(f"{product.name}")
                elif auto_create_new:
                    final_sku = internal_sku if internal_sku else generate_unique_internal_sku(
                        str(name_val), sku)
                    new_product = Product(name=str(name_val), supplier_sku=sku, internal_sku=final_sku,
                                          stock_quantity=qty, purchase_price=price, retail_price=price * 1.2)
                    session.add(new_product)
                    session.flush()
                    session.add(StockMovement(product_id=new_product.id, quantity=qty,
                                type=MovementTypeEnum.INCOME, stock_after=new_product.stock_quantity))
                    report["created"].append(f"{name_val}")
                else:
                    report["skipped"].append(
                        f"{name_val} (SKU: {sku or internal_sku})")
            except Exception as e:
                report["errors"].append(f"Строка {i + start_row + 2}: {e}")
        session.commit()
        return report

    elif mode == ImportMode.AS_ESTIMATE:
        items_to_create, not_found_skus = [], []
        for _, row in data_df.iterrows():
            try:
                sku = str(row.get(col_map['sku'])).strip(
                ) if 'sku' in col_map else None
                qty = float(row.get(col_map['qty']))
                price = float(row.get(col_map.get('price'), 0.0) or 0.0)
                if not sku or qty is None:
                    continue
                product = session.exec(select(Product).where(
                    Product.supplier_sku == sku)).first()
                if product:
                    items_to_create.append(
                        {"product_id": product.id, "quantity": qty, "unit_price": price})
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
        if match := re.search(r'Заказ №\s*(\S+)', ' '.join(df.astype(str).to_string().split())):
            order_number = match.group(1)

        new_estimate = Estimate(
            estimate_number=f"Импорт-{order_number}", client_name="Импорт из файла", location="Петрович")
        session.add(new_estimate)
        session.flush()
        for item in items_to_create:
            session.add(EstimateItem(estimate_id=new_estimate.id, **item))
        session.commit()
        session.refresh(new_estimate)
        return new_estimate


# --- Эндпоинты для Смет (Estimates) ---

@app.post("/estimates/", response_model=Estimate, summary="Создать новую смету", tags=["Сметы"])
def create_estimate(
    current_user: Annotated[dict, Depends(get_current_user)],
    request: EstimateCreate,
    session: Session = Depends(get_session)
):
    user_id = current_user.get("sub")
    new_estimate = Estimate(
        estimate_number=request.estimate_number,
        client_name=request.client_name,
        location=request.location,
        user_id=user_id
    )
    session.add(new_estimate)
    session.flush()
    for item_data in request.items:
        product = get_db_object_or_404(Product, item_data.product_id, session)
        unit_price = item_data.unit_price if item_data.unit_price is not None else product.retail_price
        estimate_item = EstimateItem(
            product_id=item_data.product_id,
            quantity=item_data.quantity,
            unit_price=unit_price,
            estimate_id=new_estimate.id
        )
        session.add(estimate_item)
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
    query = select(Estimate).options(selectinload(
        Estimate.items).selectinload(EstimateItem.product))
    if search:
        search_term = f"%{search}%"
        query = query.where(or_(
            Estimate.estimate_number.ilike(search_term),
            Estimate.client_name.ilike(search_term),
            Estimate.location.ilike(search_term)
        ))
    count_query = select(func.count()).select_from(query.subquery())
    total_count = session.exec(count_query).one()
    paginated_query = query.offset(offset).limit(
        size).order_by(Estimate.id.desc())
    items = session.exec(paginated_query).all()
    return EstimatePage(total=total_count, items=items)


@app.get("/estimates/{estimate_id}", response_model=EstimateResponse, summary="Получить одну смету по ID", tags=["Сметы"])
def read_estimate(current_user: Annotated[dict, Depends(get_current_user)], estimate_id: int, session: Session = Depends(get_session)):
    query = select(Estimate).where(Estimate.id == estimate_id).options(
        selectinload(Estimate.items).selectinload(EstimateItem.product))
    estimate = session.exec(query).first()
    if not estimate:
        raise HTTPException(status_code=404, detail="Смета не найдена")
    response_items = []
    total_sum = sum(item.quantity * item.unit_price for item in estimate.items)
    for item in estimate.items:
        response_items.append(EstimateItemResponse(
            id=item.id, quantity=item.quantity, unit_price=item.unit_price, product_id=item.product_id,
            product_name=item.product.name if item.product and not item.product.is_deleted else "Товар удален"
        ))
    return EstimateResponse(**estimate.model_dump(), items=response_items, total_sum=total_sum)


@app.patch("/estimates/{estimate_id}", response_model=Estimate, summary="Обновить смету", tags=["Сметы"])
def update_estimate(current_user: Annotated[dict, Depends(get_current_user)], estimate_id: int, request: EstimateUpdate, session: Session = Depends(get_session)):
    db_estimate = get_db_object_or_404(Estimate, estimate_id, session)
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
            product = get_db_object_or_404(
                Product, item_data.product_id, session)
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
    db_estimate = get_db_object_or_404(Estimate, estimate_id, session)
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
    estimate, worker = get_db_object_or_404(
        Estimate, estimate_id, session), get_db_object_or_404(Worker, worker_id, session)
    if estimate.status not in [EstimateStatusEnum.DRAFT, EstimateStatusEnum.APPROVED]:
        raise HTTPException(
            status_code=400, detail=f"Нельзя отгрузить смету в статусе '{estimate.status.value}'")
    for item in estimate.items:
        product = get_db_object_or_404(Product, item.product_id, session)
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
    # Записываем время отгрузки
    estimate.shipped_at = datetime.utcnow()
    session.add(estimate)
    session.commit()
    return {"message": f"Смета №{estimate.estimate_number} успешно отгружена на работника {worker.name}."}



@app.post("/estimates/{estimate_id}/complete", summary="Завершить смету и окончательно списать товары", tags=["Сметы"])
def complete_estimate(current_user: Annotated[dict, Depends(get_current_user)], estimate_id: int, session: Session = Depends(get_session)):
    """Окончательное завершение сметы: создаёт движения списания по смете и переводит статус в COMPLETED.
    Требует, чтобы смета была в статусе IN_PROGRESS и была привязана к работнику (worker_id).
    """
    estimate = get_db_object_or_404(Estimate, estimate_id, session)

    if estimate.status != EstimateStatusEnum.IN_PROGRESS:
        raise HTTPException(status_code=400, detail="Можно завершить только смету в статусе 'В работе'.")

    if not estimate.worker_id:
        raise HTTPException(status_code=400, detail="Смета не привязана к работнику. Сначала отгрузите смету или привяжите работника.")

    # Для каждой позиции создаём движение списания по смете. Глобальные остатки не меняем
    # (они уже уменьшились при отгрузке). Это лишь отмечает окончательное списание у работника.
    # Проверяем, что работнику действительно были выданы эти товары (ISSUE_TO_WORKER).
    for item in estimate.items:
        product = get_db_object_or_404(Product, item.product_id, session)
        issued_sum = session.exec(select(func.coalesce(func.sum(StockMovement.quantity), 0)).where(
            StockMovement.worker_id == estimate.worker_id,
            StockMovement.product_id == item.product_id,
            StockMovement.type == MovementTypeEnum.ISSUE_TO_WORKER
        )).one()
        # issued_sum is negative (ISSUE_TO_WORKER stores negative quantities), so invert sign
        issued_qty = -issued_sum if issued_sum is not None else 0
        if issued_qty + 1e-9 < item.quantity:
            # Недостаточно выдано работнику — запрещаем завершение
            raise HTTPException(
                status_code=400,
                detail=f"Нельзя завершить смету: работнику не выдано достаточное количество товара '{product.name}'. Выдано: {issued_qty}, требуется: {item.quantity}. Пожалуйста, сначала отгрузите со склада или сделайте довыдачу."
            )

        movement = StockMovement(
            product_id=item.product_id,
            worker_id=estimate.worker_id,
            # WRITE_OFF_ESTIMATE should be positive to reflect final removal
            # from the worker's balance (ISSUE_TO_WORKER stored negative).
            quantity=item.quantity,
            type=MovementTypeEnum.WRITE_OFF_ESTIMATE,
            stock_after=product.stock_quantity
        )
        session.add(movement)

    estimate.status = EstimateStatusEnum.COMPLETED
    session.add(estimate)
    session.commit()

    return {"message": f"Смета №{estimate.estimate_number} успешно завершена. Товары списаны."}


@app.patch("/estimates/{estimate_id}/items/{item_id}", response_model=EstimateItem, summary="Обновить позицию в смете", tags=["Сметы"])
def update_estimate_item(current_user: Annotated[dict, Depends(get_current_user)], estimate_id: int, item_id: int, quantity: float = Query(..., gt=0), session: Session = Depends(get_session)):
    item = get_db_object_or_404(EstimateItem, item_id, session)
    if item.estimate_id != estimate_id:
        raise HTTPException(status_code=404, detail="Позиция сметы не найдена")
    item.quantity = quantity
    session.add(item)
    session.commit()
    session.refresh(item)
    return item


@app.delete("/estimates/{estimate_id}/items/{item_id}", status_code=204, summary="Удалить позицию из сметы", tags=["Сметы"])
def delete_estimate_item(current_user: Annotated[dict, Depends(get_current_user)], estimate_id: int, item_id: int, session: Session = Depends(get_session)):
    item = get_db_object_or_404(EstimateItem, item_id, session)
    if item.estimate_id != estimate_id:
        raise HTTPException(status_code=404, detail="Позиция сметы не найдена")
    session.delete(item)
    session.commit()
    return None


@app.post("/estimates/{estimate_id}/issue-additional", summary="Довыдача товаров по смете", tags=["Сметы"])
def issue_additional_items(current_user: Annotated[dict, Depends(get_current_user)], estimate_id: int, request: AddItemsRequest, session: Session = Depends(get_session)):
    estimate = get_db_object_or_404(Estimate, estimate_id, session)
    if not estimate.worker_id:
        raise HTTPException(
            status_code=400, detail="Смета еще не отгружена, нельзя сделать довыдачу.")
    worker = get_db_object_or_404(Worker, estimate.worker_id, session)
    for item_data in request.items:
        product = get_db_object_or_404(Product, item_data.product_id, session)
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


@app.post("/estimates/{estimate_id}/assign-worker", summary="Привязать работника к смете (без списания)", tags=["Сметы"])
def assign_worker_to_estimate(current_user: Annotated[dict, Depends(get_current_user)], estimate_id: int, worker_id: int = Query(...), session: Session = Depends(get_session)):
    """Назначает работника на смету и помечает время отгрузки, но не делает списание остатков.
    Это удобно для исторических записей или когда отгрузка была выполнена в другой системе.
    """
    estimate = get_db_object_or_404(Estimate, estimate_id, session)
    worker = get_db_object_or_404(Worker, worker_id, session)

    estimate.worker_id = worker.id
    # Если время отгрузки ещё не выставлено — ставим текущее
    if not getattr(estimate, 'shipped_at', None):
        estimate.shipped_at = datetime.utcnow()

    session.add(estimate)
    session.commit()
    return {"message": f"Смета №{estimate.estimate_number} привязана к работнику {worker.name}."}


@app.get("/estimates/{estimate_id}/generate-commercial-proposal", summary="Сгенерировать КП .docx", tags=["Сметы"])
def generate_commercial_proposal_docx(
    current_user: Annotated[dict, Depends(get_current_user)], estimate_id: int,
    background_tasks: BackgroundTasks, session: Session = Depends(get_session)
):
    # Этот код у вас уже был и, вероятно, работал, оставляем его
    estimate = get_db_object_or_404(Estimate, estimate_id, session)
    template_path = os.path.join(
        "templates", "commercial_proposal_template.docx")
    if not os.path.exists(template_path):
        raise HTTPException(status_code=500, detail="Шаблон КП не найден")
    items, total_sum = [], 0
    for item in estimate.items:
        product = get_db_object_or_404(Product, item.product_id, session)
        item_total = item.quantity * item.unit_price
        total_sum += item_total
        items.append({
            'product_name': product.name, 'unit': product.unit.value, 'quantity': item.quantity,
            'unit_price': f"{item.unit_price:,.2f}".replace(",", " "), 'total': f"{item_total:,.2f}".replace(",", " ")
        })
    today = date.today()
    rub, kop = int(total_sum), int((total_sum - int(total_sum)) * 100)
    context = {
        'estimate_number': estimate.estimate_number, 'current_date_formatted': f"{today.day:02d} {['', 'января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'][today.month]} {today.year} г.",
        'client_name': estimate.client_name, 'theme': f"Работы по смете на объекте: {estimate.location or 'не указан'}", 'items': items,
        'total_sum_formatted': f"{total_sum:,.2f}".replace(",", " "), 'total_items_count': len(items),
        'total_sum_in_words': f"{num2words(rub, lang='ru', to='currency', currency='RUB')} {kop:02d} копеек".capitalize(),
        'valid_until_date_formatted': (today + timedelta(days=7)).strftime('%d.%m.%Y'),
    }
    with tempfile.NamedTemporaryFile(delete=False, suffix=".docx") as tmp:
        doc = DocxTemplate(template_path)
        doc.render(context)
        doc.save(tmp.name)
        tmp_path = tmp.name
    background_tasks.add_task(os.remove, tmp_path)
    filename = f"KP_{estimate.estimate_number.replace(' ', '_')}.docx"
    return FileResponse(path=tmp_path, filename=filename, media_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document')


@app.post("/estimates/{estimate_id}/cancel-completion", summary="Отменить выполнение сметы и вернуть товары", tags=["Сметы"])
def cancel_estimate_completion(
    current_user: Annotated[dict, Depends(get_current_user)],
    estimate_id: int,
    session: Session = Depends(get_session)
):
    estimate = get_db_object_or_404(Estimate, estimate_id, session)

    if estimate.status != EstimateStatusEnum.COMPLETED:
        raise HTTPException(
            status_code=400, detail="Отменить можно только 'Выполненную' смету.")

    if not estimate.worker_id:
        raise HTTPException(
            status_code=400, detail="Не найден работник, на которого была отгружена смета. Возврат невозможен.")

    # Возвращаем товары со сметы обратно на основной склад
    for item in estimate.items:
        product = get_db_object_or_404(Product, item.product_id, session)

        # Возвращаем товар на основной склад
        product.stock_quantity += item.quantity

        # Создаем движение, которое "отменяет" списание на работника
        # Это положительное движение, так как товар "вернулся" от работника
        movement = StockMovement(
            product_id=item.product_id,
            worker_id=estimate.worker_id,
            quantity=item.quantity,
            type=MovementTypeEnum.RETURN_FROM_WORKER,
            stock_after=product.stock_quantity
        )
        session.add(product)
        session.add(movement)

    # Меняем статус сметы обратно на "В работе"
    estimate.status = EstimateStatusEnum.IN_PROGRESS
    session.add(estimate)
    session.commit()

    return {"message": f"Выполнение сметы №{estimate.estimate_number} отменено. Товары возвращены на склад."}

# --- Эндпоинты для Договоров (Contracts) ---
@app.post("/contracts/", response_model=Contract, summary="Создать договор", tags=["Договоры"])
def create_contract(current_user: Annotated[dict, Depends(get_current_user)], contract: Contract, session: Session = Depends(get_session)):
    user_id = current_user.get('sub')
    contract.user_id = user_id
    session.add(contract)
    session.commit()
    session.refresh(contract)
    return contract


@app.get("/contracts/", response_model=List[Contract], summary="Получить список договоров", tags=["Договоры"])
def read_contracts(current_user: Annotated[dict, Depends(get_current_user)], session: Session = Depends(get_session)):
    return session.exec(select(Contract).order_by(Contract.contract_date.desc())).all()


@app.get("/contracts/{contract_id}", response_model=Contract, summary="Получить договор по ID", tags=["Договоры"])
def read_contract(current_user: Annotated[dict, Depends(get_current_user)], contract_id: int, session: Session = Depends(get_session)):
    contract = session.get(Contract, contract_id)
    if not contract:
        raise HTTPException(status_code=404, detail="Договор не найден")
    return contract


@app.patch("/contracts/{contract_id}", response_model=Contract, summary="Обновить договор", tags=["Договоры"])
def update_contract(current_user: Annotated[dict, Depends(get_current_user)], contract_id: int, request: ContractUpdate, session: Session = Depends(get_session)):
    db_contract = get_db_object_or_404(Contract, contract_id, session)
    update_data = request.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_contract, key, value)
    session.add(db_contract)
    session.commit()
    session.refresh(db_contract)
    return db_contract


@app.post("/contracts/{contract_id}/write-off-pipes", response_model=Contract, summary="Списать трубы и завершить договор", tags=["Договоры"])
def write_off_pipes(current_user: Annotated[dict, Depends(get_current_user)], contract_id: int, session: Session = Depends(get_session)):
    # NOTE: basic implementation - mark contract as completed. Stock adjustments can be added later.
    db_contract = get_db_object_or_404(Contract, contract_id, session)
    db_contract.status = ContractStatusEnum.COMPLETED
    session.add(db_contract)
    session.commit()
    session.refresh(db_contract)
    return db_contract
# --- Эндпоинты для Отчетов (Reports) ---


@app.get("/reports/profit", response_model=ProfitReportResponse, summary="Отчет по прибыли", tags=["Отчеты"])
def get_profit_report(
    current_user: Annotated[dict, Depends(get_current_user)],
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    # --- НОВЫЙ ПАРАМЕТР ---
    include_in_progress: bool = Query(
        False, description="Включить в отчет сметы 'В работе'"),
    session: Session = Depends(get_session)
):
    # --- НОВАЯ ЛОГИКА СТАТУСОВ ---
    statuses_to_include = [EstimateStatusEnum.COMPLETED]
    if include_in_progress:
        statuses_to_include.append(EstimateStatusEnum.IN_PROGRESS)

    query = select(Estimate).options(selectinload(Estimate.items)).where(
        Estimate.status.in_(statuses_to_include))
    # ---------------------------

    if start_date and end_date:
        query = query.where(Estimate.created_at >= start_date,
                            Estimate.created_at < (end_date + timedelta(days=1)))

    estimates = session.exec(query).all()

    # --- РУЧНАЯ ЗАГРУЗКА ТОВАРОВ (оставляем, это работает) ---
    product_ids = {item.product_id for est in estimates for item in est.items}
    products_list = []
    if product_ids:
        products_list = session.exec(
            select(Product).where(Product.id.in_(product_ids))).all()
    product_map = {p.id: p for p in products_list}
    print(
        f"4. Создана карта товаров для поиска. Количество ключей: {len(product_map)}")
    print("--- КОНЕЦ ДИАГНОСТИКИ ---\n")
    # --- КОНЕЦ ДИАГНОСТИКИ ---

    # ... (стандартный код)
    report_items, grand_total_retail, grand_total_purchase = [], 0.0, 0.0
    for est in estimates:
        total_retail = sum(it.quantity * it.unit_price for it in est.items)
        total_purchase = 0
        for item in est.items:
            product = product_map.get(item.product_id)
            if product:
                total_purchase += item.quantity * (product.purchase_price or 0)
        if total_retail == 0:
            continue
        profit = total_retail - total_purchase
        margin = (profit / total_retail * 100) if total_retail > 0 else 0
        report_items.append(ProfitReportItem(
            estimate_id=est.id, estimate_number=est.estimate_number, client_name=est.client_name,
            completed_at=est.created_at.date(), total_retail=total_retail, total_purchase=total_purchase,
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


@app.get("/dashboard/summary", response_model=DashboardSummary, summary="Сводка для дашборда", tags=["Дашборд"])
def get_dashboard_summary(current_user: Annotated[dict, Depends(get_current_user)], session: Session = Depends(get_session)):
    # Count products that are considered 'low stock' (include zero quantity)
    products_to_order_count = session.exec(
        select(func.count(Product.id)).where(
            Product.is_deleted == False,
            Product.min_stock_level > 0,
            Product.stock_quantity <= Product.min_stock_level
        )
    ).one()
    estimates_in_progress_count = session.exec(select(func.count(Estimate.id)).where(
        Estimate.status == EstimateStatusEnum.IN_PROGRESS
    )).one()
    contracts_in_progress_count = session.exec(select(func.count(Contract.id)).where(
        Contract.status == ContractStatusEnum.IN_PROGRESS
    )).one()

    thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)
    profit_estimates = session.exec(select(Estimate).options(selectinload(Estimate.items)).where(
        Estimate.status == EstimateStatusEnum.COMPLETED,
        Estimate.created_at >= thirty_days_ago
    )).all()

    # --- ТАКАЯ ЖЕ РУЧНАЯ ЗАГРУЗКА ТОВАРОВ ---
    product_ids = {
        item.product_id for est in profit_estimates for item in est.items}
    products_list = session.exec(
        select(Product).where(Product.id.in_(product_ids))).all()
    product_map = {p.id: p for p in products_list}
    # ----------------------------------------

    total_profit = 0
    for est in profit_estimates:
        for item in est.items:
            product = product_map.get(item.product_id)
            if product:
                total_profit += (item.quantity * item.unit_price) - \
                    (item.quantity * (product.purchase_price or 0))

    return DashboardSummary(
        products_to_order_count=products_to_order_count,
        estimates_in_progress_count=estimates_in_progress_count,
        contracts_in_progress_count=contracts_in_progress_count,
        profit_last_30_days=total_profit
    )
