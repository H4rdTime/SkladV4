# main_api.py

from datetime import date, datetime
from enum import Enum
from itertools import product
from operator import or_
import os
from fastapi import FastAPI, Depends, Form, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from numpy import delete
from sqlmodel import SQLModel, create_engine, Session, select
from typing import List, Optional
from pydantic import BaseModel
from sqlalchemy import func
from main_models import Estimate, EstimateItem, EstimateStatusEnum, Contract, ContractStatusEnum, UnitEnum
import openpyxl
import io
import re
from docxtpl import DocxTemplate  # Добавлен импорт для DocxTemplate
# Импортируем все наши модели
from main_models import Product, Worker, StockMovement, MovementTypeEnum
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
from fastapi import Query
# --- Настройка подключения к базе данных ---
DATABASE_URL = "postgresql://postgres.ebpejjvgdfddmjzacqfd:Transformers15832!?@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"

engine = create_engine(DATABASE_URL)


def create_db_and_tables():
    print("Создание таблиц в базе данных...")
    SQLModel.metadata.create_all(engine)
    print("Таблицы успешно созданы (или уже существовали).")


# --- Основное приложение FastAPI ---
app = FastAPI(
    title="Sklad V4 API",
    description="API для управления складской системой."
)

# --- НАСТРОЙКА CORS ---
# Список источников, которым разрешено делать запросы к нашему API
origins = [
    "http://localhost:3000",  # Адрес нашего Next.js фронтенда
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,  # Разрешить запросы от этих источников
    allow_credentials=True,
    allow_methods=["*"],    # Разрешить все методы (GET, POST, PATCH и т.д.)
    allow_headers=["*"],    # Разрешить все заголовки
)
# Функция-зависимость для получения сессии БД


def get_session():
    with Session(engine) as session:
        yield session

# --- Событие при старте приложения ---


@app.on_event("startup")
def on_startup():
    create_db_and_tables()

# --- Эндпоинты для Товаров (Products) ---


@app.post("/products/", response_model=Product, summary="Добавить новый товар", tags=["Товары"])
def create_product(product: Product, session: Session = Depends(get_session)):
    session.add(product)
    session.commit()
    session.refresh(product)

    # Создаем запись в истории о поступлении
    movement = StockMovement(
        product_id=product.id,
        quantity=product.stock_quantity,
        type=MovementTypeEnum.INCOME,
        stock_after=product.stock_quantity
    )
    session.add(movement)
    session.commit()

    return product


class StockStatusFilter(str, Enum):
    ALL = "all"
    LOW_STOCK = "low_stock"
    OUT_OF_STOCK = "out_of_stock"


class ProductPage(BaseModel):
    total: int
    items: List[Product]


@app.get("/products/", response_model=ProductPage, summary="Получить список товаров (с фильтрами и пагинацией)", tags=["Товары"])
def read_products(
    search: Optional[str] = None,
    stock_status: StockStatusFilter = StockStatusFilter.ALL,
    page: int = Query(1, gt=0, description="Номер страницы"),
    # Увеличил размер по умолчанию
    size: int = Query(50, gt=0, le=200,
                      description="Количество элементов на странице"),
    session: Session = Depends(get_session)
):
    offset = (page - 1) * size

    query = select(Product)
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

    # --- ИЗМЕНЕНИЕ ЗДЕСЬ: Добавляем сортировку по 'is_favorite' ---
    paginated_query = query.offset(offset).limit(
        size).order_by(Product.is_favorite.desc(), Product.name)
    items = session.exec(paginated_query).all()

    return ProductPage(total=total_count, items=items)


@app.post("/workers/", response_model=Worker, summary="Добавить нового работника", tags=["Работники"])
def create_worker(worker: Worker, session: Session = Depends(get_session)):
    session.add(worker)
    session.commit()
    session.refresh(worker)
    return worker


@app.get("/workers/", response_model=List[Worker], summary="Получить список всех работников", tags=["Работники"])
def read_workers(session: Session = Depends(get_session)):
    workers = session.query(Worker).all()
    return workers

# --- Эндпоинты для Операций (Actions) ---


class IssueItemRequest(BaseModel):
    product_id: int
    worker_id: int
    quantity: float


@app.post("/actions/issue-item/", response_model=StockMovement, summary="Выдать товар работнику", tags=["Операции"])
def issue_item_to_worker(request: IssueItemRequest, session: Session = Depends(get_session)):
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
        stock_after=product.stock_quantity  # <-- ИЗМЕНЕНИЕ
    )
    session.add(product)
    session.add(movement)
    session.commit()
    session.refresh(movement)
    return movement


class ReturnItemRequest(BaseModel):
    product_id: int
    worker_id: int
    quantity: float


@app.post("/actions/return-item/", response_model=StockMovement, summary="Принять возврат от работника", tags=["Операции"])
def return_item_from_worker(request: ReturnItemRequest, session: Session = Depends(get_session)):
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
        stock_after=product.stock_quantity  # <-- ИЗМЕНЕНИЕ
    )
    session.add(product)
    session.add(movement)
    session.commit()
    session.refresh(movement)
    return movement


class WorkerStockItem(BaseModel):
    product_id: int
    product_name: str
    quantity_on_hand: float
    unit: str


@app.get("/actions/worker-stock/{worker_id}", response_model=List[WorkerStockItem], summary="Получить список товаров на руках у работника", tags=["Операции"])
def get_worker_stock(worker_id: int, session: Session = Depends(get_session)):
    """
    Рассчитывает и возвращает текущие остатки товаров,
    числящиеся за конкретным работником.
    """
    # Проверяем, существует ли такой работник
    worker = session.get(Worker, worker_id)
    if not worker:
        raise HTTPException(
            status_code=404, detail="Работник с таким ID не найден")

    # Это сложный запрос к базе данных с использованием SQLAlchemy Core API.
    # Он группирует все движения по товарам для данного работника и суммирует количество.
    # quantity у нас отрицательное при выдаче и положительное при возврате,
    # поэтому мы берем сумму и умножаем на -1, чтобы получить положительный остаток на руках.

    results = session.query(
        Product.id,
        Product.name,
        Product.unit,
        func.sum(StockMovement.quantity)
    ).join(Product).filter(
        StockMovement.worker_id == worker_id
    ).group_by(
        Product.id, Product.name, Product.unit
    ).all()

    # Формируем итоговый список
    worker_stock = []
    for product_id, product_name, unit, total_quantity in results:
        # Умножаем на -1, т.к. выдача - отрицательная, а нам нужен положительный остаток
        quantity_on_hand = -total_quantity
        if quantity_on_hand > 0:  # Показываем только те товары, которые реально есть на руках
            worker_stock.append(
                WorkerStockItem(
                    product_id=product_id,
                    product_name=product_name,
                    quantity_on_hand=quantity_on_hand,
                    unit=unit.value  # .value, чтобы получить строку из Enum
                )
            )

    return worker_stock


class EstimateItemCreate(BaseModel):
    product_id: int
    quantity: float
    unit_price: Optional[float] = None  # <-- ДОБАВЬТЕ ЭТУ СТРОКУ


class EstimateCreate(BaseModel):
    estimate_number: str
    client_name: str
    location: Optional[str] = None
    items: List[EstimateItemCreate]

# --- Эндпоинты для Смет (Estimates) ---


@app.post("/estimates/", response_model=Estimate, summary="Создать новую смету", tags=["Сметы"])
def create_estimate(request: EstimateCreate, session: Session = Depends(get_session)):
    """
    Создает новую смету и все связанные с ней позиции товаров.
    Цены на товары берутся из справочника Product на момент создания.
    """
    # Создаем "шапку" сметы
    new_estimate = Estimate(
        estimate_number=request.estimate_number,
        client_name=request.client_name,
        location=request.location
    )

    # Создаем позиции сметы (items)
    for item_data in request.items:
        product = session.get(Product, item_data.product_id)
        if not product:
            raise HTTPException(
                status_code=404, detail=f"Товар с ID {item_data.product_id} не найден")

        # Создаем строку сметы, подставляя розничную цену из справочника
        estimate_item = EstimateItem(
            product_id=item_data.product_id,
            quantity=item_data.quantity,
            unit_price=product.retail_price,  # Берем актуальную розничную цену
            estimate=new_estimate  # Сразу привязываем к нашей новой смете
        )
        session.add(estimate_item)

    session.add(new_estimate)
    session.commit()
    session.refresh(new_estimate)

    return new_estimate


class EstimateItemResponse(BaseModel):
    """Модель ответа для ОДНОЙ строки в смете"""
    id: int
    quantity: float
    unit_price: float
    product_id: int
    product_name: str  # Добавляем название товара


class EstimateResponse(BaseModel):
    """Модель ответа для ПОЛНОЙ сметы"""
    id: int
    estimate_number: str
    client_name: str
    location: Optional[str]
    status: EstimateStatusEnum
    created_at: datetime
    worker_id: Optional[int]

    items: List[EstimateItemResponse]  # Список строк сметы
    total_sum: float


@app.get("/estimates/", response_model=List[Estimate], summary="Получить список всех смет", tags=["Сметы"])
def read_estimates(session: Session = Depends(get_session)):
    """Возвращает список всех смет (только 'шапки', без позиций)."""
    estimates = session.query(Estimate).all()
    return estimates


@app.get("/estimates/{estimate_id}", response_model=EstimateResponse, summary="Получить одну смету по ID", tags=["Сметы"])
def read_estimate(estimate_id: int, session: Session = Depends(get_session)):
    """Возвращает полную информацию по одной смете, включая все позиции и итоговую сумму."""
    estimate = session.get(Estimate, estimate_id)
    if not estimate:
        raise HTTPException(status_code=404, detail="Смета не найдена")

    response_items = []
    total_sum = 0
    for item in estimate.items:
        product = session.get(Product, item.product_id)
        response_items.append(
            EstimateItemResponse(
                id=item.id,
                quantity=item.quantity,
                unit_price=item.unit_price,
                product_id=item.product_id,
                product_name=product.name
            )
        )
        total_sum += item.quantity * item.unit_price

    response_estimate = EstimateResponse(
        **estimate.model_dump(),  # Используем model_dump()
        items=response_items,
        total_sum=total_sum
    )
    return response_estimate


@app.post("/estimates/{estimate_id}/ship", summary="Отгрузить товары по смете", tags=["Сметы"])
def ship_estimate(estimate_id: int, worker_id: int = Query(..., description="ID работника для отгрузки"), session: Session = Depends(get_session)):
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

        movement = StockMovement(
            product_id=item.product_id,
            worker_id=worker.id,
            quantity=-item.quantity,
            type=MovementTypeEnum.ISSUE_TO_WORKER,
            stock_after=product.stock_quantity  # <-- ИЗМЕНЕНИЕ
        )
        session.add(product)
        session.add(movement)

    estimate.status = EstimateStatusEnum.IN_PROGRESS
    estimate.worker_id = worker.id
    session.add(estimate)
    session.commit()

    return {"message": f"Смета №{estimate.estimate_number} успешно отгружена на работника {worker.name}."}


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


# --- Эндпоинты для Договоров (Contracts) ---

@app.post("/contracts/", response_model=Contract, summary="Создать новый договор на бурение", tags=["Договоры"])
def create_contract(contract: Contract, session: Session = Depends(get_session)):
    """Создает 'шапку' договора. Фактические данные вносятся позже."""
    session.add(contract)
    session.commit()
    session.refresh(contract)
    return contract


@app.get("/contracts/", response_model=List[Contract], summary="Получить список всех договоров", tags=["Договоры"])
def read_contracts(session: Session = Depends(get_session)):
    """Возвращает список всех договоров."""
    contracts = session.query(Contract).all()
    return contracts


@app.get("/contracts/{contract_id}", response_model=Contract, summary="Получить один договор по ID", tags=["Договоры"])
def read_contract(contract_id: int, session: Session = Depends(get_session)):
    """Возвращает полную информацию по одному договору."""
    contract = session.get(Contract, contract_id)
    if not contract:
        raise HTTPException(status_code=404, detail="Договор не найден")
    return contract


@app.patch("/contracts/{contract_id}", response_model=Contract, summary="Обновить данные договора", tags=["Договоры"])
def update_contract(contract_id: int, contract_update: ContractUpdate, session: Session = Depends(get_session)):
    """
    Обновляет данные договора. Используется для внесения фактических данных после бурения.
    """
    db_contract = session.get(Contract, contract_id)
    if not db_contract:
        raise HTTPException(status_code=404, detail="Договор не найден")

    # Получаем данные из запроса
    update_data = contract_update.model_dump(exclude_unset=True)

    # Обновляем поля в объекте из БД
    for key, value in update_data.items():
        setattr(db_contract, key, value)

    session.add(db_contract)
    session.commit()
    session.refresh(db_contract)

    return db_contract


@app.post("/contracts/{contract_id}/write-off-pipes", response_model=Contract, summary="Списать трубы и ЗАВЕРШИТЬ договор", tags=["Договоры"])
def write_off_pipes_and_complete_contract(contract_id: int, session: Session = Depends(get_session)):
    contract = session.get(Contract, contract_id)
    if not contract:
        raise HTTPException(status_code=404, detail="Договор не найден")

    # Проверяем, что есть что списывать
    if not contract.pipe_steel_used and not contract.pipe_plastic_used:
        raise HTTPException(
            status_code=400, detail="Не указано количество использованных труб для списания.")

    messages = []
    pipe_skus_map = {"PIPE-STEEL-DRILL": contract.pipe_steel_used,
                     "PIPE-PLASTIC-DRILL": contract.pipe_plastic_used}

    for sku_anchor, qty in pipe_skus_map.items():
        if qty and qty > 0:
            # ... (логика поиска и списания труб остается БЕЗ ИЗМЕНЕНИЙ, как в прошлом ответе)
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
            status_code=400, detail="Не указано количество труб для списания > 0.")

    # --- НОВАЯ ЛОГИКА: АВТОМАТИЧЕСКАЯ СМЕНА СТАТУСА ---
    contract.status = ContractStatusEnum.COMPLETED
    session.add(contract)

    session.commit()
    session.refresh(contract)

    # Возвращаем обновленный объект договора
    return contract


class ProductPage(BaseModel):
    total: int
    items: List[Product]


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    supplier_sku: Optional[str] = None
    unit: Optional[UnitEnum] = None
    purchase_price: Optional[float] = None
    retail_price: Optional[float] = None
    stock_quantity: Optional[float] = None
    min_stock_level: Optional[float] = None
    # Важно: internal_sku тоже можно менять!
    internal_sku: Optional[str] = None


@app.patch("/products/{product_id}", response_model=Product, summary="Обновить товар", tags=["Товары"])
def update_product(product_id: int, product_update: ProductUpdate, session: Session = Depends(get_session)):
    db_product = session.get(Product, product_id)
    if not db_product:
        raise HTTPException(status_code=404, detail="Товар не найден")

    old_quantity = db_product.stock_quantity
    update_data = product_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_product, key, value)

    # Если остаток изменился, создаем корректирующую запись
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


DELETED_PRODUCTS_CACHE = {}


@app.delete("/products/{product_id}", summary="Удалить товар", tags=["Товары"])
def delete_product(product_id: int, session: Session = Depends(get_session)):
    """Удаляет товар по его ID."""
    product = session.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Товар не найден")

    # Проверка, есть ли связанные записи, чтобы не нарушить целостность
    has_movements = session.exec(select(StockMovement).where(
        StockMovement.product_id == product_id)).first()
    if has_movements:
        raise HTTPException(
            status_code=400, detail="Нельзя удалить товар, так как по нему есть движения в истории. Сначала удалите связанные движения.")

    # Сохраняем во временный кеш
    DELETED_PRODUCTS_CACHE[product_id] = product.model_dump()
    session.delete(product)
    session.commit()
    return {"message": "Товар удален", "product_id": product_id}


@app.post("/products/restore/{product_id}", summary="Восстановить товар", tags=["Товары"])
def restore_product(product_id: int, session: Session = Depends(get_session)):
    if product_id in DELETED_PRODUCTS_CACHE:
        product_data = DELETED_PRODUCTS_CACHE.pop(product_id)
        # Убираем id, чтобы база данных сгенерировала новый
        product_data.pop('id', None)
        new_product = Product.model_validate(product_data)
        session.add(new_product)
        session.commit()
        return new_product
    raise HTTPException(
        status_code=404, detail="Товар для восстановления не найден в кеше.")


@app.post("/actions/clear-all-data/", summary="!!! ОПАСНО: Удалить ВСЕ данные !!!", tags=["_Служебное_"])
def clear_all_data(session: Session = Depends(get_session)):
    """
    Удаляет все данные из таблиц в правильном порядке, чтобы избежать ошибок внешних ключей.
    ИСПОЛЬЗОВАТЬ С ОСТОРОЖНОСТЬЮ!
    """

    # Сначала удаляем из "дочерних" таблиц
    session.query(StockMovement).delete()
    session.query(EstimateItem).delete()

    # Затем из "родительских"
    session.query(Estimate).delete()
    session.query(Contract).delete()
    session.query(Worker).delete()
    session.query(Product).delete()

    session.commit()

    return {"message": "Все данные успешно удалены."}


@app.get("/contracts/{contract_id}/generate-docx", summary="Сгенерировать договор в формате .docx", tags=["Договоры"])
def generate_contract_docx(contract_id: int, session: Session = Depends(get_session)):
    """
    [v2] Находит договор по ID, берет шаблон, вставляет данные
    (с прочерками для пустых полей) и отдает готовый файл.
    """
    contract = session.get(Contract, contract_id)
    if not contract:
        raise HTTPException(status_code=404, detail="Договор не найден")

    template_path = os.path.join("templates", "contract_template.docx")
    if not os.path.exists(template_path):
        raise HTTPException(
            status_code=500, detail="Шаблон договора 'contract_template.docx' не найден в папке 'templates'")

    doc = DocxTemplate(template_path)

    contract_date = contract.contract_date if contract.contract_date else date.today()

    estimated_cost = "____________"
    if contract.estimated_depth and contract.price_per_meter_soil:
        estimated_cost = int(contract.estimated_depth *
                             contract.price_per_meter_soil)

    # Функция-помощник для обработки пустых значений
    def get_value(value, placeholder="_________________"):
        return value if value else placeholder

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

    output_filename = f"Contract_{contract.contract_number}.docx"
    doc.save(output_filename)

    return FileResponse(path=output_filename, filename=output_filename, media_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document')


class WorkerUpdate(BaseModel):
    name: str


@app.patch("/workers/{worker_id}", response_model=Worker, summary="Обновить работника", tags=["Работники"])
def update_worker(worker_id: int, worker_update: WorkerUpdate, session: Session = Depends(get_session)):
    """Обновляет имя работника по его ID."""
    db_worker = session.get(Worker, worker_id)
    if not db_worker:
        raise HTTPException(status_code=404, detail="Работник не найден")

    # Обновляем поле имени
    db_worker.name = worker_update.name

    session.add(db_worker)
    session.commit()
    session.refresh(db_worker)

    return db_worker


@app.delete("/workers/{worker_id}", status_code=204, summary="Удалить работника", tags=["Работники"])
def delete_worker(worker_id: int, session: Session = Depends(get_session)):
    """Удаляет работника по его ID."""
    db_worker = session.get(Worker, worker_id)
    if not db_worker:
        raise HTTPException(status_code=404, detail="Работник не найден")

    # Проверка, есть ли связанные движения
    has_movements = session.exec(select(StockMovement).where(
        StockMovement.worker_id == worker_id)).first()
    if has_movements:
        raise HTTPException(
            status_code=400, detail="Нельзя удалить работника, так как за ним числятся движения товаров.")

    session.delete(db_worker)
    session.commit()
    return None


class ImportMode(str, Enum):
    TO_STOCK = "to_stock"  # Пополнение склада
    AS_ESTIMATE = "as_estimate"  # Создание сметы


@app.post("/actions/universal-import/", summary="[v9] Универсальный 'умный' импорт", tags=["Операции"])
async def universal_import_v9(
    mode: ImportMode = Form(..., description="Режим импорта"),
    is_initial_load: bool = Form(
        False, description="Установить остатки (а не добавить)"),
    auto_create_new: bool = Form(
        True, description="Создавать новые товары, если не найдены"),  # <-- ВЕРНУЛИ
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
            status_code=400, detail="Не найдены заголовки ('КОД', 'ТОВАР'...) или ('internal_sku', 'name'...)")

    data_df = df.iloc[start_row + 1:].where(pd.notna(df), None)

    if mode == ImportMode.TO_STOCK:
        report = {"created": [], "updated": [], "skipped": [], "errors": []}
        for i, row in data_df.iterrows():
            try:
                # Безопасно извлекаем данные из строки DataFrame
                name_val = row.get(header_map.get('name'))
                qty_val = row.get(header_map.get('qty'))

                # Пропускаем строку, если нет наименования или количества
                if not name_val or qty_val is None:
                    continue

                # Конвертируем значения, обрабатывая возможные ошибки
                qty = float(qty_val)
                price_val = row.get(header_map.get('price'))
                price = float(price_val or 0.0)

                sku_val = row.get(header_map.get('sku'))
                sku = str(sku_val).strip() if sku_val else None

                internal_sku_val = row.get(header_map.get('internal_sku'))
                internal_sku = str(internal_sku_val).strip(
                ) if internal_sku_val else None

                # Ищем товар в базе данных
                product: Optional[Product] = None
                if sku:
                    product = session.exec(select(Product).where(
                        Product.supplier_sku == sku)).first()
                if not product and internal_sku:
                    product = session.exec(select(Product).where(
                        Product.internal_sku == internal_sku)).first()

                # Основная логика: обновить, создать или пропустить
                if product:
                    # СЦЕНАРИЙ 1: ТОВАР НАЙДЕН - ОБНОВЛЯЕМ
                    if is_initial_load:
                        product.stock_quantity = qty  # Устанавливаем остаток
                    else:
                        product.stock_quantity += qty  # Добавляем к остатку

                    product.purchase_price = price
                    session.add(product)

                    movement = StockMovement(
                        product_id=product.id,
                        quantity=qty,  # Поступление всегда положительное
                        type=MovementTypeEnum.INCOME,
                        stock_after=product.stock_quantity
                    )
                    session.add(movement)
                    report["updated"].append(f"{product.name}")

                elif auto_create_new:
                    # СЦЕНАРИЙ 2: ТОВАР НЕ НАЙДЕН, НО РАЗРЕШЕНО СОЗДАНИЕ
                    final_internal_sku = internal_sku if internal_sku else f"AUTO-{sku or re.sub('[^0-9a-zA-Zа-яА-Я]+', '', str(name_val))[:10].upper()}"

                    new_product = Product(
                        name=str(name_val),
                        supplier_sku=sku,
                        internal_sku=final_internal_sku,
                        stock_quantity=qty,
                        purchase_price=price,
                        retail_price=price * 1.2
                    )
                    session.add(new_product)
                    session.flush()  # Получаем ID для нового продукта

                    movement = StockMovement(
                        product_id=new_product.id,
                        quantity=qty,
                        type=MovementTypeEnum.INCOME,
                        stock_after=new_product.stock_quantity
                    )
                    session.add(movement)
                    report["created"].append(f"{name_val}")

                else:
                    # СЦЕНАРИЙ 3: ТОВАР НЕ НАЙДЕН, СОЗДАНИЕ ЗАПРЕЩЕНО
                    report["skipped"].append(
                        f"{name_val} (артикул {sku or internal_sku})")

            except Exception as e:
                report["errors"].append(f"Строка {i + start_row + 2}: {e}")

        session.commit()
        return report

    elif mode == ImportMode.AS_ESTIMATE:
        items_to_create = []
        not_found_skus = []

        # Безопасно получаем номера колонок из карты
        sku_col = header_map.get('sku')
        qty_col = header_map.get('qty')
        price_col = header_map.get('price')

        for i, row in data_df.iterrows():
            try:
                # Безопасно извлекаем данные
                sku_val = row.get(sku_col)
                qty_val = row.get(qty_col)
                price_val = row.get(
                    price_col) if price_col is not None else 0.0

                sku = str(sku_val).strip() if sku_val else None

                # Пропускаем, если нет артикула или количества
                if not sku or qty_val is None:
                    continue

                qty = float(qty_val)
                price = float(price_val or 0.0)

                # Ищем товар в базе
                product = session.exec(select(Product).where(
                    Product.supplier_sku == sku)).first()

                if product:
                    # Сохраняем не только ID и кол-во, но и цену из файла
                    items_to_create.append({
                        "product_id": product.id,
                        "quantity": qty,
                        "price_from_file": price
                    })
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

        # Поиск номера заказа (без изменений)
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

        # Создание сметы (без изменений)
        new_estimate = Estimate(
            estimate_number=f"Импорт-{order_number}", client_name="Импорт из файла", location="Петрович")
        session.add(new_estimate)
        session.flush()

        # Создание позиций сметы с ценой из файла
        for item in items_to_create:
            est_item = EstimateItem(
                product_id=item["product_id"],
                quantity=item["quantity"],
                unit_price=item["price_from_file"],  # <-- КЛЮЧЕВОЕ ИЗМЕНЕНИЕ
                estimate_id=new_estimate.id
            )
            session.add(est_item)

        session.commit()
        session.refresh(new_estimate)
        return new_estimate


@app.get("/actions/history/", summary="Получить историю всех движений", tags=["Операции"])
def get_history(session: Session = Depends(get_session)):
    """
    Возвращает полный лог всех движений товаров,
    включая названия товаров и имена работников.
    """
    history_records = session.exec(
        select(StockMovement).order_by(StockMovement.id.desc())
    ).all()

    # Вручную собираем ответ, чтобы гарантировать правильную структуру
    response = []
    for movement in history_records:
        response.append({
            "id": movement.id,
            "timestamp": movement.timestamp,
            "type": movement.type,
            "quantity": movement.quantity,
            "product": {
                "name": movement.product.name if movement.product else "Товар удален"
            },
            # Явно проверяем, есть ли работник, и подставляем None, если нет
            "worker": {
                "name": movement.worker.name
            } if movement.worker else None
        })

    return response


@app.post("/actions/history/cancel/{movement_id}", summary="Отменить движение товара", tags=["Операции"])
def cancel_movement(movement_id: int, session: Session = Depends(get_session)):
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
        stock_after=product.stock_quantity  # <-- ИЗМЕНЕНИЕ
    )
    session.add(product)
    session.add(correction_movement)
    session.commit()
    return {"message": f"Операция ID {movement_id} успешно отменена."}


class EstimateUpdate(BaseModel):
    estimate_number: Optional[str] = None
    client_name: Optional[str] = None
    location: Optional[str] = None
    status: Optional[EstimateStatusEnum] = None
    # Позволяем обновить ВЕСЬ список товаров
    items: Optional[List[EstimateItemCreate]] = None


# --- ЗАМЕНИТЕ ЭТУ ФУНКЦИЮ ЦЕЛИКОМ ---
@app.patch("/estimates/{estimate_id}", response_model=Estimate, summary="Обновить смету", tags=["Сметы"])
def update_estimate(estimate_id: int, request: EstimateUpdate, session: Session = Depends(get_session)):
    """
    Обновляет данные сметы. Позволяет менять 'шапку' и/или полностью
    заменять состав товаров, если смета еще не отгружена.
    """
    db_estimate = session.get(Estimate, estimate_id)
    if not db_estimate:
        raise HTTPException(status_code=404, detail="Смета не найдена")

    if db_estimate.status == EstimateStatusEnum.COMPLETED:
        raise HTTPException(
            status_code=400, detail="Нельзя редактировать завершенную смету.")

    # Запрещаем менять состав товаров, если смета уже в работе
    if request.items is not None and db_estimate.status == EstimateStatusEnum.IN_PROGRESS:
        raise HTTPException(
            status_code=400, detail="Состав отгруженной сметы можно менять только через 'довыдачу'.")

    # Обновляем поля "шапки"
    update_data = request.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if key != "items":
            setattr(db_estimate, key, value)

    # Полностью заменяем состав товаров, если он был передан и смета в нужном статусе
    if request.items is not None:
        # --- ИСПРАВЛЕННАЯ ЛОГИКА УДАЛЕНИЯ ---
        items_to_delete = session.exec(select(EstimateItem).where(
            EstimateItem.estimate_id == estimate_id)).all()
        for item in items_to_delete:
            session.delete(item)
        # --- КОНЕЦ ИСПРАВЛЕНИЯ ---

        # Добавляем новые
        for item_data in request.items:
            product = session.get(Product, item_data.product_id)
            if not product:
                raise HTTPException(
                    status_code=404, detail=f"Товар ID {item_data.product_id} не найден.")

            # --- ИСПРАВЛЕНИЕ: Проверяем наличие unit_price ---
            unit_price = item_data.unit_price if hasattr(
                item_data, 'unit_price') else product.retail_price

            new_item = EstimateItem(
                estimate_id=estimate_id,
                product_id=product.id,
                quantity=item_data.quantity,
                unit_price=unit_price
            )
            session.add(new_item)

    session.add(db_estimate)
    session.commit()
    session.refresh(db_estimate)
    return db_estimate


@app.delete("/estimates/{estimate_id}", status_code=204, summary="Удалить смету", tags=["Сметы"])
def delete_estimate(estimate_id: int, session: Session = Depends(get_session)):
    """
    Удаляет смету и все связанные с ней позиции (EstimateItem).
    Не позволяет удалить смету, если по ней уже были движения.
    """
    db_estimate = session.get(Estimate, estimate_id)
    if not db_estimate:
        raise HTTPException(status_code=404, detail="Смета не найдена")

    if db_estimate.status not in [EstimateStatusEnum.DRAFT, EstimateStatusEnum.APPROVED, EstimateStatusEnum.CANCELLED]:
        raise HTTPException(
            status_code=400, detail=f"Нельзя удалить смету в статусе '{db_estimate.status.value}'.")

    # --- ИСПРАВЛЕННАЯ ЛОГИКА УДАЛЕНИЯ ---
    # 1. Находим все дочерние записи (позиции сметы)
    items_to_delete = session.exec(select(EstimateItem).where(
        EstimateItem.estimate_id == estimate_id)).all()

    # 2. Удаляем их в цикле
    for item in items_to_delete:
        session.delete(item)

    # 3. Теперь удаляем саму смету
    session.delete(db_estimate)

    session.commit()
    return None


@app.patch("/estimates/{estimate_id}/items/{item_id}", response_model=EstimateItem, summary="Обновить позицию в смете", tags=["Сметы"])
def update_estimate_item(estimate_id: int, item_id: int, quantity: float = Query(..., gt=0), session: Session = Depends(get_session)):
    item = session.get(EstimateItem, item_id)
    if not item or item.estimate_id != estimate_id:
        raise HTTPException(status_code=404, detail="Позиция сметы не найдена")

    item.quantity = quantity
    session.add(item)
    session.commit()
    session.refresh(item)
    return item


@app.delete("/estimates/{estimate_id}/items/{item_id}", status_code=204, summary="Удалить позицию из сметы", tags=["Сметы"])
def delete_estimate_item(estimate_id: int, item_id: int, session: Session = Depends(get_session)):
    item = session.get(EstimateItem, item_id)
    if not item or item.estimate_id != estimate_id:
        raise HTTPException(status_code=404, detail="Позиция сметы не найдена")

    session.delete(item)
    session.commit()
    return None


class AddItemsRequest(BaseModel):
    items: List[EstimateItemCreate]


@app.post("/estimates/{estimate_id}/issue-additional", summary="[Новая логика] Довыдача товаров по смете", tags=["Сметы"])
def issue_additional_items(estimate_id: int, request: AddItemsRequest, session: Session = Depends(get_session)):
    """
    Добавляет новые позиции в смету и СРАЗУ ЖЕ списывает их на работника,
    привязанного к этой смете.
    """
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

        # 1. Уменьшаем остаток на основном складе
        product.stock_quantity -= item_data.quantity

        # 2. Создаем новую позицию в смете
        new_item = EstimateItem(
            estimate_id=estimate_id,
            product_id=product.id,
            quantity=item_data.quantity,
            unit_price=item_data.unit_price
        )
        # 3. Создаем запись в истории о выдаче
        movement = StockMovement(
            product_id=product.id,
            worker_id=worker.id,
            quantity=-item_data.quantity,
            type=MovementTypeEnum.ISSUE_TO_WORKER,
            stock_after=product.stock_quantity
        )
        session.add(product)
        session.add(new_item)
        session.add(movement)

    session.commit()
    return {"message": "Товары успешно довыданы."}


@app.post("/estimates/{estimate_id}/complete", summary="[Новая логика] Завершить и закрыть смету", tags=["Сметы"])
def complete_estimate(estimate_id: int, session: Session = Depends(get_session)):
    """
    Переводит смету в статус 'Выполнена'. 
    Рассчитывает фактический расход и создает операции 'Списание работником'.
    """
    estimate = session.get(Estimate, estimate_id)
    if not estimate:
        raise HTTPException(status_code=404, detail="Смета не найдена")
    if estimate.status != EstimateStatusEnum.IN_PROGRESS:
        raise HTTPException(
            status_code=400, detail="Завершить можно только смету в статусе 'В работе'.")
    if not estimate.worker_id:
        raise HTTPException(
            status_code=400, detail="К смете не привязан работник.")

    # Получаем все товары, которые когда-либо были в этой смете
    estimate_items = session.exec(select(EstimateItem).where(
        EstimateItem.estimate_id == estimate_id)).all()

    for item in estimate_items:
        # Считаем баланс по этому товару у этого работника
        balance_query = select(func.sum(StockMovement.quantity)).where(
            StockMovement.worker_id == estimate.worker_id,
            StockMovement.product_id == item.product_id
        )
        on_hand_sum = session.exec(balance_query).one_or_none() or 0
        quantity_on_hand = -on_hand_sum

        # Если после всех возвратов что-то осталось на руках - это и есть фактический расход
        if quantity_on_hand > 0:
            product = session.get(Product, item.product_id)
            # Создаем операцию финального списания
            write_off_movement = StockMovement(
                product_id=item.product_id,
                worker_id=estimate.worker_id,
                quantity=quantity_on_hand,  # Положительное значение
                type=MovementTypeEnum.WRITE_OFF_WORKER,
                stock_after=product.stock_quantity  # Остаток на складе не меняется
            )
            session.add(write_off_movement)

    # Меняем статус сметы
    estimate.status = EstimateStatusEnum.COMPLETED
    session.add(estimate)
    session.commit()

    return {"message": "Смета успешно завершена. Фактический расход списан с работников."}


class WriteOffItemRequest(BaseModel):
    product_id: int
    worker_id: int
    quantity: float


@app.post("/actions/write-off-item/", response_model=StockMovement, summary="Списать товар, числящийся за работником", tags=["Операции"])
def write_off_item_from_worker(request: WriteOffItemRequest, session: Session = Depends(get_session)):
    """
    Создает запись о финальном списании товара, который был на руках у работника.
    Эта операция НЕ меняет остаток на основном складе.
    """
    product = session.get(Product, request.product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Товар не найден")

    worker = session.get(Worker, request.worker_id)
    if not worker:
        raise HTTPException(status_code=404, detail="Работник не найден")

    # Проверяем, достаточно ли товара на руках у работника для списания
    # Считаем текущий баланс на руках
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

    # Создаем новую запись в истории.
    # ВАЖНО: для списания мы добавляем ПОЛОЖИТЕЛЬНОЕ движение,
    # т.к. баланс работника считается как -SUM().
    # Было: -10 (выдача). Стало: -10 + 5 (списание) = -5. Остаток на руках: 5.
    movement = StockMovement(
        product_id=request.product_id,
        worker_id=request.worker_id,
        quantity=request.quantity,  # Положительное значение
        type=MovementTypeEnum.WRITE_OFF_WORKER,
        stock_after=product.stock_quantity  # Остаток на ОСНОВНОМ складе не меняется
    )

    session.add(movement)
    session.commit()
    session.refresh(movement)

    return movement

# --- Модели для Отчета ---


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

# --- Эндпоинт для Отчета ---


@app.get("/reports/profit", response_model=ProfitReportResponse, summary="Отчет по прибыли (гибкий)", tags=["Отчеты"])
def get_profit_report(
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    estimate_id: Optional[int] = None,  # Новый необязательный параметр
    session: Session = Depends(get_session)
):
    """
    Рассчитывает прибыль.
    - Если передан estimate_id, ищет только по нему.
    - Иначе, ищет по диапазону дат.
    """

    # Начинаем строить запрос
    query = select(Estimate).where(
        Estimate.status.in_([EstimateStatusEnum.COMPLETED,
                            EstimateStatusEnum.IN_PROGRESS])
    )

    # Динамически добавляем фильтры
    if estimate_id:
        query = query.where(Estimate.id == estimate_id)
    elif start_date and end_date:
        query = query.where(
            Estimate.created_at >= start_date,
            Estimate.created_at < date(
                end_date.year, end_date.month, end_date.day + 1)
        )
    else:
        # Если не передан ни ID, ни даты, возвращаем пустой отчет
        return ProfitReportResponse(items=[], grand_total_retail=0, grand_total_purchase=0, grand_total_profit=0, average_margin=0)

    estimates = session.exec(query).all()

    report_items = []
    grand_total_retail = 0
    grand_total_purchase = 0

    for estimate in estimates:
        total_retail = 0
        total_purchase = 0

        # Находим все фактически списанные товары по этой смете
        # Это более точный подход, чем просто смотреть на состав сметы

        # 1. Находим ID работника по смете
        worker_id = estimate.worker_id
        if not worker_id:
            continue  # Пропускаем сметы без отгрузки

        # 2. Суммируем все списания (WRITE_OFF) и выдачи (ISSUE), связанные с этим работником
        # (Более точная логика потребует связи движения со сметой, пока упростим)

        for item in estimate.items:
            # Сумма продажи считается по цене, зафиксированной в смете
            total_retail += item.quantity * item.unit_price

            # Себестоимость считается по текущей закупочной цене товара в справочнике
            product = session.get(Product, item.product_id)
            if product:
                total_purchase += item.quantity * product.purchase_price

        profit = total_retail - total_purchase
        margin = (profit / total_retail * 100) if total_retail > 0 else 0

        report_items.append(ProfitReportItem(
            estimate_id=estimate.id,
            estimate_number=estimate.estimate_number,
            client_name=estimate.client_name,
            completed_at=estimate.created_at.date(),
            total_retail=total_retail,
            total_purchase=total_purchase,
            profit=profit,
            margin=margin
        ))

        grand_total_retail += total_retail
        grand_total_purchase += total_purchase

    grand_total_profit = grand_total_retail - grand_total_purchase
    average_margin = (grand_total_profit / grand_total_retail *
                      100) if grand_total_retail > 0 else 0

    return ProfitReportResponse(
        items=report_items,
        grand_total_retail=grand_total_retail,
        grand_total_purchase=grand_total_purchase,
        grand_total_profit=grand_total_profit,
        average_margin=average_margin
    )

# --- ДОБАВЬТЕ ЭТОТ НОВЫЙ ЭНДПОИНТ В СЕКЦИЮ "Товары" ---


@app.patch("/products/{product_id}/toggle-favorite", response_model=Product, summary="Переключить статус 'Избранное' у товара", tags=["Товары"])
def toggle_favorite(product_id: int, session: Session = Depends(get_session)):
    product = session.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Товар не найден")

    product.is_favorite = not product.is_favorite  # Инвертируем значение
    session.add(product)
    session.commit()
    session.refresh(product)
    return product
