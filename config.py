# config.py
import os
from dotenv import load_dotenv

# Загружаем переменные из .env файла
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET")

# Проверка, что критически важные переменные загружены
if not SUPABASE_URL or not SUPABASE_KEY or not SUPABASE_JWT_SECRET:
    raise ValueError("Необходимо установить переменные Supabase в .env файле")

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise ValueError("Необходимо установить переменную окружения DATABASE_URL")

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY or SECRET_KEY == "e8a3a9a8d2b9f0c1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5":
    raise ValueError("Критическая ошибка: SECRET_KEY не установлен или используется значение по умолчанию.")

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 дней

# Загружаем CORS origins и преобразуем в список
cors_origins_str = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
CORS_ORIGINS = [origin.strip() for origin in cors_origins_str.split(',')]

# Минимальная стоимость готовой к эксплуатации скважины (руб.)
# Можно переопределить через переменную окружения MIN_WELL_COST
try:
    MIN_WELL_COST = float(os.getenv("MIN_WELL_COST", "75000"))
except ValueError:
    MIN_WELL_COST = 75000.0