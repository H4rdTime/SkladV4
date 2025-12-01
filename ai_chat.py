# ai_chat.py
import json
import logging
from typing import List, Dict, Any
import google.generativeai as genai
from config import GEMINI_API_KEY

logger = logging.getLogger(__name__)

# Полное определение всех функций, доступных для AI
tools_config = {
    "function_declarations": [
        {
            "name": "create_contract",
            "description": "Создать новый договор на бурение скважины",
            "parameters": {
                "type": "object",
                "properties": {
                    "contract_number": {"type": "string", "description": "Номер договора, например '555-Б'"},
                    "client_name": {"type": "string", "description": "Полное ФИО клиента"},
                    "location": {"type": "string", "description": "Адрес объекта, где будут проводиться работы"},
                    "estimated_depth": {"type": "number", "description": "Предполагаемая ориентировочная глубина бурения в метрах"},
                    "price_per_meter_soil": {"type": "number", "description": "Стоимость одного метра бурения до скальных пород"},
                    "price_per_meter_rock": {"type": "number", "description": "Стоимость одного метра бурения по скальным породам"}
                },
                "required": ["contract_number", "client_name", "location"]
            }
        },
        {
            "name": "create_estimate",
            "description": "Создать новую смету с перечнем товаров или услуг",
            "parameters": {
                "type": "object",
                "properties": {
                    "estimate_number": {"type": "string", "description": "Номер сметы, например 'СМ-123' или '1С-551'"},
                    "client_name": {"type": "string", "description": "Имя клиента"},
                    "location": {"type": "string", "description": "Адрес объекта или тема сметы"},
                    "items": {
                        "type": "array",
                        "description": "Список позиций в смете",
                        "items": {
                            "type": "object",
                            "properties": {
                                "product_name": {"type": "string", "description": "Точное название товара или услуги"},
                                "quantity": {"type": "number", "description": "Количество"},
                                "unit_price": {"type": "number", "description": "Цена за единицу (розничная)"}
                            },
                            "required": ["product_name", "quantity", "unit_price"]
                        }
                    }
                },
                "required": ["estimate_number", "client_name", "items"]
            }
        },
        {
            "name": "create_product",
            "description": "Создать новый товар на складе",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Название товара"},
                    "stock_quantity": {"type": "number", "description": "Количество на складе"},
                    "purchase_price": {"type": "number", "description": "Цена закупки"},
                    "retail_price": {"type": "number", "description": "Розничная цена"},
                    "unit": {"type": "string", "description": "Единица измерения (шт., пог. м., л., см.)"},
                },
                "required": ["name", "stock_quantity"]
            }
        },
        {
            "name": "search_products",
            "description": "Найти товары по названию или артикулу",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Поисковый запрос"}
                },
                "required": ["query"]
            }
        },
        {
            "name": "issue_to_worker",
            "description": "Выдать товар работнику",
            "parameters": {
                "type": "object",
                "properties": {
                    "product_name": {"type": "string", "description": "Название товара"},
                    "worker_name": {"type": "string", "description": "Имя работника"},
                    "quantity": {"type": "number", "description": "Количество"}
                },
                "required": ["product_name", "worker_name", "quantity"]
            }
        },
        {
            "name": "get_low_stock_products",
            "description": "Получить список товаров с низким остатком, которые пора закупать",
            "parameters": {
                "type": "object",
                "properties": {}
            }
        }
    ]
}

class AIChatAssistant:
    def __init__(self, api_key: str = None):
        self.api_key = api_key or GEMINI_API_KEY
        if not self.api_key:
            logger.warning("GEMINI_API_KEY не найден. AI-чат не будет работать.")
            self.model = None
            return
        
        try:
            genai.configure(api_key=self.api_key)
            self.model = genai.GenerativeModel(
                'gemini-1.5-flash',
                tools=[tools_config],
                system_instruction="""
Ты - AI-ассистент системы управления складом "Склад v4". 
Твоя задача - помогать пользователям управлять складом, сметами и договорами через естественный язык.

Доступные операции:
- create_contract: создать договор на бурение.
- create_estimate: создать смету с товарами и услугами.
- create_product: добавить отдельный товар на склад.
- search_products: найти товары.
- issue_to_worker: выдать товар работнику.
- get_low_stock_products: показать товары с низким остатком.

Всегда отвечай на русском языке. Будь вежлив и конкретен.
Когда пользователь просит что-то сделать, используй соответствующую функцию.
Если для создания договора или сметы не хватает данных (например, имени клиента), обязательно спроси об этом.
                """
            )
            self.chat = self.model.start_chat()
            logger.info("AI Chat initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize AI Chat: {e}")
            self.model = None
    
    def process_message(self, message: str, context: Dict[str, Any] = None) -> Dict[str, Any]:
        if not self.model:
            return {"response": "AI-чат не настроен. Добавьте GEMINI_API_KEY в .env файл.", "function_calls": []}
        
        try:
            response = self.chat.send_message(message)
            
            function_calls = []
            text_response = ""

            if response.candidates and len(response.candidates) > 0:
                # Извлекаем вызовы функций
                for part in response.candidates[0].content.parts:
                    if hasattr(part, 'function_call') and part.function_call:
                        fc = part.function_call
                        function_calls.append({"name": fc.name, "args": dict(fc.args)})
                
                # Извлекаем текстовый ответ
                try:
                    text_response = response.text
                except ValueError:
                    pass
            
            return {
                "response": text_response or ("Выполняю..." if function_calls else "Я не уверен, что понял. Можете переформулировать?"),
                "function_calls": function_calls
            }
        
        except Exception as e:
            logger.error(f"AI chat error: {e}")
            return {"response": f"Ошибка AI: {str(e)}", "function_calls": []}

# Глобальный экземпляр для использования в других частях приложения
ai_assistant = AIChatAssistant()