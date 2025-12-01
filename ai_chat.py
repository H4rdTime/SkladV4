# ai_chat.py - AI Chat Integration
import json
import logging
from typing import List, Dict, Any
import google.generativeai as genai
from config import GEMINI_API_KEY

logger = logging.getLogger(__name__)

# Определение функций в формате словаря (совместимо со всеми версиями)
tools_config = {
    "function_declarations": [
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
                    "unit": {"type": "string", "description": "Единица измерения (шт., пог. м., л.)"},
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
            "description": "Получить список товаров с низким остатком",
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
            logger.warning("GEMINI_API_KEY not found. AI chat will not work.")
            self.model = None
            return
        
        try:
            genai.configure(api_key=self.api_key)
            self.model = genai.GenerativeModel(
                'models/gemini-pro-latest',  # Доступная модель из списка
                tools=[tools_config],
                system_instruction="""
Ты - AI-ассистент системы управления складом "Склад v4". 
Твоя задача - помогать пользователям управлять товарами через естественный язык.

Доступные операции:
- create_product: добавить товар
- search_products: найти товары
- issue_to_worker: выдать товар работнику
- get_low_stock_products: показать товары с низким остатком

Всегда отвечай на русском языке, будь вежлив и конкретен.
Когда пользователь просит что-то сделать, используй соответствующую функцию.
                """
            )
            self.chat = self.model.start_chat()
            logger.info("AI Chat initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize AI Chat: {e}")
            self.model = None
    
    def process_message(self, message: str, context: Dict[str, Any] = None) -> Dict[str, Any]:
        """Обработать сообщение от пользователя"""
        if not self.model:
            return {
                "response": "AI-чат не настроен. Добавьте GEMINI_API_KEY в .env файл.",
                "function_calls": []
            }
        
        try:
            response = self.chat.send_message(message)
            
            # Проверяем, есть ли вызовы функций
            function_calls = []
            if response.candidates and len(response.candidates) > 0:
                for part in response.candidates[0].content.parts:
                    if hasattr(part, 'function_call') and part.function_call:
                        fc = part.function_call
                        function_calls.append({
                            "name": fc.name,
                            "args": dict(fc.args)
                        })
            
            # Получаем текстовый ответ
            text_response = ""
            try:
                text_response = response.text
            except:
                # Если нет текста, просто пропускаем
                pass
            
            return {
                "response": text_response or "Выполняю...",
                "function_calls": function_calls
            }
        
        except Exception as e:
            logger.error(f"AI chat error: {e}")
            return {
                "response": f"Ошибка AI: {str(e)}",
                "function_calls": []
            }

# Глобальный экземпляр
ai_assistant = AIChatAssistant()
