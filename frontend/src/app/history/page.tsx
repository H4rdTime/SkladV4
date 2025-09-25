// frontend/src/app/history/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { fetchApi } from '@/lib/api';
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
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [size, setSize] = useState(50);
    const [total, setTotal] = useState(0);
    const [startDate, setStartDate] = useState<string | null>(null);
    const [endDate, setEndDate] = useState<string | null>(null);
    const [movementType, setMovementType] = useState<string | null>(null);

    // API_URL больше не нужен, используем fetchApi

    const fetchHistory = async (q?: string) => {
        setIsLoading(true);
        try {
            const params = new URLSearchParams();
            if (q) params.append('search', q);
            if (startDate) params.append('start_date', startDate);
            if (endDate) params.append('end_date', endDate);
            if (movementType) params.append('movement_type', movementType);
            params.append('page', String(page));
            params.append('size', String(size));
            const url = `/actions/history/?${params.toString()}`;
            const data = await fetchApi(url);
            setHistory(data.items || []);
            setTotal(data.total || 0);
        } catch (error) {
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        const t = setTimeout(() => { setPage(1); fetchHistory(search.trim()); }, 300);
        return () => clearTimeout(t);
    }, [search, startDate, endDate, movementType, size]);

    useEffect(() => {
        // fetch when page changes
        fetchHistory(search.trim());
    }, [page]);

    const handleCancelMovement = async (movementId: number) => {
        if (confirm('Вы уверены, что хотите отменить эту операцию? Будет создана обратная, корректирующая запись в истории.')) {
            try {
                await fetchApi(`/actions/history/cancel/${movementId}`, { method: 'POST' });
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
                <div className="p-4 border-b flex flex-col sm:flex-row sm:items-center sm:space-x-3 gap-2">
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по товару или работнику..." className="w-full sm:w-1/3 p-2 border rounded-md" />
                    <div className="flex items-center space-x-2">
                        <input type="date" value={startDate || ''} onChange={(e) => setStartDate(e.target.value || null)} className="p-2 border rounded-md" />
                        <input type="date" value={endDate || ''} onChange={(e) => setEndDate(e.target.value || null)} className="p-2 border rounded-md" />
                        <select value={movementType || ''} onChange={(e) => setMovementType(e.target.value || null)} className="p-2 border rounded-md">
                            <option value="">Все типы</option>
                            <option value="INCOME">Приход</option>
                            <option value="ISSUE_TO_WORKER">Выдача</option>
                            <option value="RETURN_FROM_WORKER">Возврат</option>
                            <option value="WRITE_OFF_ESTIMATE">Списание (смета)</option>
                            <option value="WRITE_OFF_CONTRACT">Списание (договор)</option>
                        </select>
                        <select value={String(size)} onChange={(e) => setSize(Number(e.target.value))} className="p-2 border rounded-md">
                            <option value={25}>25</option>
                            <option value={50}>50</option>
                            <option value={100}>100</option>
                        </select>
                    </div>
                </div>
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
                                <tr><td colSpan={7} className="text-center py-10 text-gray-500">Загрузка...</td></tr>
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
                <div className="p-4 flex items-center justify-between">
                    <div>Показано: {total === 0 ? 0 : (page-1)*size + 1} - {Math.min(page*size, total)} из {total}</div>
                    <div className="space-x-2">
                        <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p-1))} className="px-3 py-1 border rounded">Пред.</button>
                        <button disabled={(page*size) >= total} onClick={() => setPage(p => p+1)} className="px-3 py-1 border rounded">След.</button>
                    </div>
                </div>
            </div>
        </main>
    );
}