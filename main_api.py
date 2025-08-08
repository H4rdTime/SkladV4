# main_api.py

from datetime import date, datetime
from enum import Enum
import os
from fastapi import FastAPI, Depends, Form, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
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

# Функция-зависимость для получения сессии БД


def get_session():
    with Session(engine) as session:
        yield session

# --- Событие при старте приложения ---


@app.on_event("startup")
def on_startup():
    create_db_and_tables()

# --- Эндпоинты для Товаров (Products) ---


@app.post("/products/", response_model=Product, summary="Добавить новый товар на склад", tags=["Товары"])
def create_product(product: Product, session: Session = Depends(get_session)):
    session.add(product)
    session.commit()
    session.refresh(product)
    return product


class StockStatusFilter(str, Enum):
    ALL = "all"
    LOW_STOCK = "low_stock"
    OUT_OF_STOCK = "out_of_stock"


@app.get("/products/", response_model=List[Product], summary="Получить список всех товаров с фильтрами", tags=["Товары"])
def read_products(
    search: Optional[str] = None,
    stock_status: StockStatusFilter = StockStatusFilter.ALL,
    session: Session = Depends(get_session)
):
    """
    Возвращает список всех товаров на складе с возможностью поиска и фильтрации.
    - search: Поиск по названию или артикулу.
    - stock_status: Фильтрация по остаткам (all, low_stock, out_of_stock).
    """
    # Начинаем строить запрос
    query = select(Product)

    # Добавляем условие поиска, если он есть
    if search:
        # Ищем по частичному совпадению в названии или артикулах
        query = query.where(
            (Product.name.ilike(f"%{search}%")) |
            (Product.internal_sku.ilike(f"%{search}%")) |
            (Product.supplier_sku.ilike(f"%{search}%"))
        )

    # Добавляем условие фильтрации по остаткам
    if stock_status == StockStatusFilter.LOW_STOCK:
        # Остаток меньше или равен минимальному порогу И ОДНОВРЕМЕННО больше нуля
        query = query.where(
            (Product.stock_quantity <= Product.min_stock_level) & (
                Product.stock_quantity > 0)
        )
    elif stock_status == StockStatusFilter.OUT_OF_STOCK:
        # Остаток равен нулю
        query = query.where(Product.stock_quantity == 0)

    # Выполняем итоговый запрос
    products = session.exec(query).all()
    return products

# --- Эндпоинты для Работников (Workers) ---


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
    product = session.get(Product, request.product_id)
    if not product:
        raise HTTPException(
            status_code=404, detail="Товар с таким ID не найден")

    worker = session.get(Worker, request.worker_id)
    if not worker:
        raise HTTPException(
            status_code=404, detail="Работник с таким ID не найден")

    if request.quantity <= 0:
        raise HTTPException(
            status_code=400, detail="Количество должно быть больше нуля")

    if product.stock_quantity < request.quantity:
        raise HTTPException(
            status_code=400,
            detail=f"Недостаточно товара на складе. В наличии: {product.stock_quantity}, требуется: {request.quantity}"
        )

    product.stock_quantity -= request.quantity

    movement = StockMovement(
        product_id=request.product_id,
        worker_id=request.worker_id,
        quantity=-request.quantity,
        type=MovementTypeEnum.ISSUE_TO_WORKER
    )

    session.add(product)
    session.add(movement)
    session.commit()

    session.refresh(product)
    session.refresh(movement)

    return movement


class ReturnItemRequest(BaseModel):
    product_id: int
    worker_id: int
    quantity: float


@app.post("/actions/return-item/", response_model=StockMovement, summary="Принять возврат товара от работника", tags=["Операции"])
def return_item_from_worker(request: ReturnItemRequest, session: Session = Depends(get_session)):
    """
    Принимает возврат товара от работника и зачисляет его на склад.
    1. Находит товар и работника по их ID.
    2. Увеличивает количество товара на складе.
    3. Создает запись в истории движений.
    """
    # 1. Находим товар и работника в базе данных
    product = session.get(Product, request.product_id)
    if not product:
        raise HTTPException(
            status_code=404, detail="Товар с таким ID не найден")

    worker = session.get(Worker, request.worker_id)
    if not worker:
        raise HTTPException(
            status_code=404, detail="Работник с таким ID не найден")

    # Проверяем, что количество для возврата положительное
    if request.quantity <= 0:
        raise HTTPException(
            status_code=400, detail="Количество должно быть больше нуля")

    # 2. Увеличиваем количество товара на складе
    product.stock_quantity += request.quantity

    # 3. Создаем запись в истории движений
    movement = StockMovement(
        product_id=request.product_id,
        worker_id=request.worker_id,
        quantity=request.quantity,  # Возврат - это положительное количество
        type=MovementTypeEnum.RETURN_FROM_WORKER
    )

    # Сохраняем все изменения в одной транзакции
    session.add(product)
    session.add(movement)
    session.commit()

    # Обновляем объекты
    session.refresh(product)
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
def ship_estimate(estimate_id: int, worker_id: int, session: Session = Depends(get_session)):
    """
    Производит отгрузку: списывает все товары из сметы со склада на указанного работника.
    Меняет статус сметы на "В работе".
    """
    estimate = session.get(Estimate, estimate_id)
    if not estimate:
        raise HTTPException(status_code=404, detail="Смета не найдена")

    worker = session.get(Worker, worker_id)
    if not worker:
        raise HTTPException(status_code=404, detail="Работник не найден")

    if estimate.status != EstimateStatusEnum.DRAFT and estimate.status != EstimateStatusEnum.APPROVED:
        raise HTTPException(
            status_code=400, detail=f"Нельзя отгрузить смету в статусе '{estimate.status.value}'")

    # Проходим по всем позициям в смете
    for item in estimate.items:
        product = session.get(Product, item.product_id)

        # Проверяем остаток
        if product.stock_quantity < item.quantity:
            raise HTTPException(
                status_code=400, detail=f"Недостаточно товара '{product.name}'. В наличии: {product.stock_quantity}, требуется: {item.quantity}")

        # Уменьшаем остаток
        product.stock_quantity -= item.quantity

        # Создаем запись в истории
        movement = StockMovement(
            product_id=item.product_id,
            worker_id=worker.id,
            quantity=-item.quantity,
            type=MovementTypeEnum.ISSUE_TO_WORKER,
            # TODO: Привязать ID сметы к движению
        )
        session.add(product)
        session.add(movement)

    # Обновляем статус сметы и привязываем работника
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


@app.post("/contracts/{contract_id}/write-off-pipes", summary="Списать трубы по договору", tags=["Договоры"])
def write_off_pipes_for_contract(contract_id: int, session: Session = Depends(get_session)):
    """
    Списывает стальные и пластиковые трубы со склада на основании данных из договора.
    Ищет товары по специальным внутренним артикулам.
    """
    contract = session.get(Contract, contract_id)
    if not contract:
        raise HTTPException(status_code=404, detail="Договор не найден")

    # Список для хранения сообщений о результате
    messages = []

    # --- Списание стальной трубы ---
    if contract.pipe_steel_used and contract.pipe_steel_used > 0:
        # Ищем товар "Стальная труба" по его уникальному артикулу
        steel_pipe_product = session.exec(select(Product).where(
            Product.internal_sku == "PIPE-STEEL-DRILL")).first()

        if not steel_pipe_product:
            raise HTTPException(
                status_code=404, detail="Товар 'Стальная труба' (PIPE-STEEL-DRILL) не найден на складе.")

        if steel_pipe_product.stock_quantity < contract.pipe_steel_used:
            raise HTTPException(
                status_code=400, detail=f"Недостаточно стальной трубы. В наличии: {steel_pipe_product.stock_quantity}, требуется: {contract.pipe_steel_used}")

        # Списываем
        steel_pipe_product.stock_quantity -= contract.pipe_steel_used

        # Записываем в историю
        movement = StockMovement(
            product_id=steel_pipe_product.id,
            quantity=-contract.pipe_steel_used,
            type=MovementTypeEnum.WRITE_OFF_CONTRACT
            # TODO: Привязать ID договора к движению
        )
        session.add(steel_pipe_product)
        session.add(movement)
        messages.append(
            f"Списано стальной трубы: {contract.pipe_steel_used} м.")

    # --- Списание пластиковой трубы (аналогично) ---
    if contract.pipe_plastic_used and contract.pipe_plastic_used > 0:
        plastic_pipe_product = session.exec(select(Product).where(
            Product.internal_sku == "PIPE-PLASTIC-DRILL")).first()

        if not plastic_pipe_product:
            raise HTTPException(
                status_code=404, detail="Товар 'Пластиковая труба' (PIPE-PLASTIC-DRILL) не найден на складе.")

        if plastic_pipe_product.stock_quantity < contract.pipe_plastic_used:
            raise HTTPException(
                status_code=400, detail=f"Недостаточно пластиковой трубы. В наличии: {plastic_pipe_product.stock_quantity}, требуется: {contract.pipe_plastic_used}")

        plastic_pipe_product.stock_quantity -= contract.pipe_plastic_used

        movement = StockMovement(
            product_id=plastic_pipe_product.id,
            quantity=-contract.pipe_plastic_used,
            type=MovementTypeEnum.WRITE_OFF_CONTRACT
        )
        session.add(plastic_pipe_product)
        session.add(movement)
        messages.append(
            f"Списано пластиковой трубы: {contract.pipe_plastic_used} м.")

    if not messages:
        return {"message": "В договоре не указано количество труб для списания."}

    session.commit()

    return {"status": "success", "details": messages}


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
    """Обновляет данные товара по его ID."""
    db_product = session.get(Product, product_id)
    if not db_product:
        raise HTTPException(status_code=404, detail="Товар не найден")

    update_data = product_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_product, key, value)

    session.add(db_product)
    session.commit()
    session.refresh(db_product)
    return db_product

@app.post("/actions/import-products-from-xlsx/", summary="[v5] Импорт из XLSX", tags=["Операции"])
async def import_products_v5(
    start_row: int = Form(..., description="Номер строки, с которой начинаются данные"),
    name_col: int = Form(..., description="Номер колонки с наименованием (ТОВАР)"),
    qty_col: int = Form(..., description="Номер колонки с количеством (КОЛИЧЕСТВО)"),
    internal_sku_col: int = Form(0, description="Номер колонки с ВНУТРЕННИМ артикулом (необязательно)"),
    sku_col: int = Form(0, description="Номер колонки с артикулом поставщика (КОД) (необязательно)"),
    price_col: int = Form(0, description="Номер колонки с ценой закупки (ЦЕНА) (необязательно)"),
    auto_create_new: bool = Form(True, description="Автоматически создавать новые товары"),
    
    file: UploadFile = File(...), 
    session: Session = Depends(get_session)
):
    """
    [v5] Финальная версия. Умеет извлекать числа из текстовых ячеек.
    """
    if not file.filename.endswith('.xlsx'):
        raise HTTPException(status_code=400, detail="Неверный формат файла. Требуется .xlsx")

    try:
        contents = await file.read()
        workbook = openpyxl.load_workbook(io.BytesIO(contents))
        sheet = workbook.active
        report = {"created": [], "updated": [], "skipped": [], "errors": []}

        for row_index in range(start_row, sheet.max_row + 1):
            try:
                name = str(sheet.cell(row=row_index, column=name_col).value or "").strip()
                quantity_raw = sheet.cell(row=row_index, column=qty_col).value

                if not name or quantity_raw is None:
                    report["skipped"].append(f"Строка {row_index}: Пропущена (пустое наименование или количество).")
                    continue
                
                # --- УМНЫЙ ПАРСИНГ КОЛИЧЕСТВА ---
                quantity_str = str(quantity_raw).strip()
                # Ищем первое число (целое или с точкой/запятой) в строке
                match = re.search(r'[\d\.,]+', quantity_str)
                if match:
                    # Заменяем запятую на точку для правильной конвертации
                    num_str = match.group(0).replace(',', '.')
                    quantity = float(num_str)
                else:
                    # Если число вообще не найдено, пробуем установить 0
                    quantity = 0.0
                    report["skipped"].append(f"Строка {row_index}: Не найдено число в количестве '{quantity_raw}', установлено 0.")

                # --- КОНЕЦ УМНОГО ПАРСИНГА ---

                internal_sku = str(sheet.cell(row=row_index, column=internal_sku_col).value or "").strip() if internal_sku_col > 0 else ""
                supplier_sku = str(sheet.cell(row=row_index, column=sku_col).value or "").strip() if sku_col > 0 else ""
                price_raw = sheet.cell(row=row_index, column=price_col).value if price_col > 0 else 0
                price = float(price_raw or 0)

                # Ищем товар. Приоритет у артикула поставщика, если он есть.
                product = None
                if supplier_sku:
                    product = session.exec(select(Product).where(Product.supplier_sku == str(supplier_sku))).first()
                
                if not product and internal_sku:
                    product = session.exec(select(Product).where(Product.internal_sku == str(internal_sku))).first()

                if product:
                    # При первичной загрузке мы не добавляем, а устанавливаем количество
                    product.stock_quantity = quantity 
                    if price > 0: product.purchase_price = price
                    # Добавляем артикул поставщика, если его еще не было
                    if supplier_sku and not product.supplier_sku:
                        product.supplier_sku = supplier_sku
                    session.add(product)
                    report["updated"].append(f"Обновлен: {product.name} -> {quantity} шт.")
                elif auto_create_new:
                    # Создаем новый товар
                    final_internal_sku = internal_sku if internal_sku else f"AUTO-{re.sub('[^0-9a-zA-Zа-яА-Я]+', '', name)[:10].upper()}"
                    new_product = Product(
                        name=name,
                        supplier_sku=supplier_sku if supplier_sku else None,
                        internal_sku=final_internal_sku,
                        stock_quantity=quantity,
                        purchase_price=price,
                        retail_price=price * 1.2 # Пример: ставим наценку +20% по умолчанию
                    )
                    session.add(new_product)
                    report["created"].append(f"Создан: {name} ({quantity} шт.)")
                else:
                    report["skipped"].append(f"Товар '{name}' не найден и не был создан.")

            except Exception as e:
                report["errors"].append(f"Ошибка в строке {row_index}: {e}")
        
        session.commit()
        return report

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Глобальная ошибка при обработке файла: {e}")   
    
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
    Находит договор по ID, берет шаблон 'contract_template.docx',
    вставляет в него данные и отдает готовый файл для скачивания.
    """
    contract = session.get(Contract, contract_id)
    if not contract:
        raise HTTPException(status_code=404, detail="Договор не найден")

    template_path = os.path.join("templates", "contract_template.docx")
    if not os.path.exists(template_path):
        raise HTTPException(status_code=500, detail="Шаблон договора 'contract_template.docx' не найден в папке 'templates'")

    doc = DocxTemplate(template_path)
    
    contract_date = contract.contract_date if contract.contract_date else date.today()
    
    # Автоматический расчет ориентировочной стоимости, если есть данные
    estimated_cost = "____________"
    if contract.estimated_depth and contract.price_per_meter_soil:
        # Упрощенный расчет. Можно усложнить, если нужно.
        estimated_cost = int(contract.estimated_depth * contract.price_per_meter_soil)

    # Словарь для подстановки. Ключи должны ТОЧНО совпадать с метками в .docx
    context = {
        'contract_number': contract.contract_number,
        'contract_day': contract_date.strftime('%d'),
        'contract_month_ru': ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"][contract_date.month - 1],
        'contract_year': contract_date.strftime('%Y'),
        'client_name': contract.client_name,
        'location': contract.location,
        'estimated_depth': contract.estimated_depth or "______",
        'price_per_meter_soil': contract.price_per_meter_soil or "______",
        'price_per_meter_rock': contract.price_per_meter_rock or "______",
        'estimated_total_cost': estimated_cost,

        # Паспортные данные
        'passport_series_number': contract.passport_series_number or "________________",
        'passport_issued_by': contract.passport_issued_by or "________________",
        'passport_issue_date': contract.passport_issue_date or "________________",
        'passport_dep_code': contract.passport_dep_code or "________________",
        'passport_address': contract.passport_address or "________________",
    }

    doc.render(context)
    
    output_filename = f"Contract_{contract.contract_number}.docx"
    doc.save(output_filename)
    
    return FileResponse(path=output_filename, filename=output_filename, media_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document')