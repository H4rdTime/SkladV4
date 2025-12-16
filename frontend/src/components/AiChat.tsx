// src/components/AiChat.tsx
'use client';
import { useState } from 'react';
import { MessageCircle, X, Send } from 'lucide-react';
import toast from 'react-hot-toast';
import { API_URL, fetchApi } from '@/lib/api';

interface Message {
    role: 'user' | 'assistant';
    content: string;
    function_results?: Array<{
        function: string;
        success: boolean;
        result: string;
    }>;
}

export default function AiChat() {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const sendMessage = async () => {
        if (!input.trim() || isLoading) return;

        const userMessage: Message = { role: 'user', content: input };
        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setIsLoading(true);

        try {
            const response = await fetchApi('/ai/chat', {
                method: 'POST',
                body: JSON.stringify({ message: input })
            });

            const assistantMessage: Message = {
                role: 'assistant',
                content: response.response || 'Выполнено',
                function_results: response.function_results || []
            };

            setMessages(prev => [...prev, assistantMessage]);

            // Если были успешные операции с товарами, диспатчим событие для обновления склада
            const hasSuccessfulOperations = response.function_results?.some((fr: any) => fr.success);
            if (hasSuccessfulOperations) {
                window.dispatchEvent(new CustomEvent('ai-warehouse-update'));
            }
        } catch (err: any) {
            toast.error(err.message || 'Ошибка AI: проверьте, что GEMINI_API_KEY установлен');
            const errorMessage: Message = {
                role: 'assistant',
                content: `Ошибка: ${err.message || 'Не удалось обработать запрос'}`
            };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <>
            {/* Floating Button */}
            {!isOpen && (
                <button
                    onClick={() => setIsOpen(true)}
                    className="fixed bottom-6 right-6 bg-blue-600 text-white p-4 rounded-full shadow-lg hover:bg-blue-700 transition-all z-50"
                    aria-label="Открыть AI-чат"
                >
                    <MessageCircle size={24} />
                </button>
            )}

            {/* Chat Window */}
            {isOpen && (
                <div className="fixed bottom-6 right-6 w-96 h-[600px] bg-white rounded-lg shadow-2xl flex flex-col z-50 border border-gray-200">
                    {/* Header */}
                    <div className="bg-blue-600 text-white p-4 rounded-t-lg flex justify-between items-center">
                        <div className="flex items-center gap-2">
                            <MessageCircle size={20} />
                            <span className="font-semibold">AI-Ассистент</span>
                        </div>
                        <button
                            onClick={() => setIsOpen(false)}
                            className="hover:bg-blue-700 p-1 rounded"
                        >
                            <X size={20} />
                        </button>
                    </div>

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-3">
                        {messages.length === 0 && (
                            <div className="text-center text-gray-500 mt-8">
                                <p className="font-semibold">Привет! Я AI-ассистент</p>
                                <p className="text-sm mt-2">Попробуйте:</p>
                                <ul className="text-xs mt-2 text-left inline-block">
                                    <li>• "Добавь товар кабель 100м"</li>
                                    <li>• "Найди все товары с низким остатком"</li>
                                    <li>• "Выдай кабель 15м работнику Иванов"</li>
                                </ul>
                            </div>
                        )}

                        {messages.map((msg, idx) => (
                            <div
                                key={idx}
                                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                            >
                                <div
                                    className={`max-w-[80%] p-3 rounded-lg ${msg.role === 'user'
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-gray-100 text-gray-800'
                                        }`}
                                >
                                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>

                                    {/* Function Results */}
                                    {msg.function_results && msg.function_results.length > 0 && (
                                        <div className="mt-2 space-y-1">
                                            {msg.function_results.map((fr, i) => (
                                                <div
                                                    key={i}
                                                    className={`text-xs p-2 rounded ${fr.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                                        }`}
                                                >
                                                    {fr.result}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}

                        {isLoading && (
                            <div className="flex justify-start">
                                <div className="bg-gray-100 p-3 rounded-lg">
                                    <div className="flex gap-1">
                                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Input */}
                    <div className="p-4 border-t border-gray-200">
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                                placeholder="Напишите команду..."
                                className="flex-1 p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                disabled={isLoading}
                            />
                            <button
                                onClick={sendMessage}
                                disabled={isLoading || !input.trim()}
                                className="bg-blue-600 text-white p-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                            >
                                <Send size={20} />
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
