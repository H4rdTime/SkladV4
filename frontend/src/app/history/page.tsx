// frontend/src/app/history/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { RotateCcw } from 'lucide-react';

interface Movement {
    id: number;
    timestamp: string;
    type: string;
    quantity: number;
    stock_after: number | null;
    product: { name: string };
    worker: { name: string } | null;
}

export default function HistoryPage() {
    const [history, setHistory] = useState<Movement[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const API_URL = 'https://sklad-petrovich-api.onrender.com';

    const fetchHistory = async () => {
        setIsLoading(true);
        try {
            const response = await fetch(`${API_URL}/actions/history/`);
            if (!response.ok) throw new Error('Ошибка загрузки истории');
            setHistory(await response.json());
        } catch (error) {
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchHistory();
    }, []);

    const handleCancelMovement = async (movementId: number) => {
        if (confirm('Вы уверены, что хотите отменить эту операцию? Будет создана обратная, корректирующая запись в истории.')) {
            try {
                const response = await fetch(`${API_URL}/actions/history/cancel/${movementId}`, {
                    method: 'POST',
                });
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.detail || 'Не удалось отменить операцию');
                }
                alert('Операция успешно отменена!');
                fetchHistory(); // Обновляем историю, чтобы увидеть новую запись
            } catch (err: any) {
                alert(`Ошибка: ${err.message}`);
            }
        }
    };

    // Функция-помощник, чтобы не показывать кнопку "Отмена" для уже отмененных операций
    const isCancelable = (type: string) => !type.startsWith('Отмена');

    return (
        <main className="container mx-auto p-4 sm:p-6 lg:p-8">
            <h1 className="text-3xl font-bold text-gray-800 mb-6">История движений</h1>
            <div className="bg-white rounded-lg shadow-md overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead className="bg-gray-100 border-b-2 border-gray-200">
                            <tr>
                                <th className="py-3 px-4 text-left font-semibold text-gray-600 uppercase tracking-wider">Дата и время</th>
                                <th className="py-3 px-4 text-left font-semibold text-gray-600 uppercase tracking-wider">Действие</th>
                                <th className="py-3 px-4 text-left font-semibold text-gray-600 uppercase tracking-wider">Товар</th>
                                <th className="py-3 px-4 text-right font-semibold text-gray-600 uppercase tracking-wider">Кол-во</th>
                                <th className="py-3 px-4 text-left font-semibold text-gray-600 uppercase tracking-wider">Работник</th>
                                <th className="py-3 px-4 text-center font-semibold text-gray-600 uppercase tracking-wider">Действия</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {isLoading ? (
                                <tr><td colSpan={6} className="text-center py-10 text-gray-500">Загрузка...</td></tr>
                            ) : (
                                history.map(m => (
                                    <tr key={m.id} className={`hover:bg-gray-50 transition-colors ${!isCancelable(m.type) ? 'bg-gray-100 text-gray-500' : ''}`}>
                                        <td className="py-3 px-4 whitespace-nowrap">{new Date(m.timestamp).toLocaleString('ru-RU')}</td>
                                        <td className="py-3 px-4">{m.type}</td>
                                        <td className="py-3 px-4 font-medium text-gray-800">{m.product.name}</td>
                                        <td className={`py-3 px-4 text-right font-semibold ${m.quantity > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                            {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                                        </td>
                                        <td className="py-3 px-4">{m.worker?.name || '—'}</td>
                                        <td className="py-3 px-4 text-right font-mono text-gray-700">
                                            {m.stock_after !== null ? m.stock_after : 'N/A'}
                                        </td>
                                        <td className="py-3 px-4 text-center">
                                            {isCancelable(m.type) && (
                                                <button
                                                    onClick={() => handleCancelMovement(m.id)}
                                                    title="Отменить действие"
                                                    className="p-1 text-gray-400 hover:text-orange-600"
                                                >
                                                    <RotateCcw size={16} />
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </main>
    );
}