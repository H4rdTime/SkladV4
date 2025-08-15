// frontend/src/app/estimates/page.tsx
'use client';

import { useState, useEffect, useRef } from 'react';
import { Plus, Eye, Upload, Trash2, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import toast from 'react-hot-toast';

interface Estimate {
    id: number;
    estimate_number: string;
    client_name: string;
    location: string | null;
    status: string;
    created_at: string;
}

export default function EstimatesPage() {
    const [estimates, setEstimates] = useState<Estimate[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [searchTerm, setSearchTerm] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(0);
    const PAGE_SIZE = 20;

    const API_URL = 'https://sklad-petrovich-api.onrender.com';

    useEffect(() => {
        const fetchEstimates = async () => {
            setIsLoading(true);
            try {
                const params = new URLSearchParams({ page: String(currentPage), size: String(PAGE_SIZE) });
                if (searchTerm) params.append('search', searchTerm);

                const response = await fetch(`${API_URL}/estimates/?${params.toString()}`);
                if (!response.ok) throw new Error('Ошибка загрузки смет');
                const data = await response.json();

                if (data && Array.isArray(data.items)) {
                    setEstimates(data.items);
                    setTotalPages(Math.ceil(data.total / PAGE_SIZE));
                } else {
                    setEstimates([]);
                    setTotalPages(0);
                    toast.error("Получен неожиданный формат данных от API смет.");
                }

            } catch (error: any) {
                toast.error(error.message || "Не удалось загрузить сметы.");
            } finally {
                setIsLoading(false);
            }
        };

        const debounceTimer = setTimeout(() => { fetchEstimates(); }, 300);
        return () => clearTimeout(debounceTimer);
    }, [currentPage, searchTerm]);

    const handleSearchChange = (term: string) => {
        setSearchTerm(term);
        setCurrentPage(1);
    };

    const handlePageChange = (newPage: number) => {
        if (newPage > 0 && newPage <= totalPages) setCurrentPage(newPage);
    };

    const handleFileImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);
        formData.append('mode', 'as_estimate');
        formData.append('is_initial_load', 'false');
        formData.append('auto_create_new', 'false');

        const toastId = toast.loading('Импорт сметы...');
        try {
            const response = await fetch(`${API_URL}/actions/universal-import/`, {
                method: 'POST',
                body: formData,
            });

            // --- ОБНОВЛЕННАЯ ЛОГИКА ОБРАБОТКИ ОШИБОК ---
            if (!response.ok) {
                const errorData = await response.json();
                const errorMessage = errorData.detail || 'Не удалось импортировать смету';

                // Проверяем, является ли эта ошибка той самой, которую мы хотим обработать по-особому
                if (typeof errorMessage === 'string' && errorMessage.startsWith('Товары с артикулами не найдены:')) {
                    // Формируем красивое сообщение
                    const friendlyMessage = (
                        <div>
                            <h4 className="font-bold text-lg mb-2">Товары не найдены на складе!</h4>
                            <p className="mb-2">Некоторые товары из файла отсутствуют в вашей базе данных.</p>
                            <p className="font-semibold">Что делать?</p>
                            <ol className="list-decimal list-inside text-sm">
                                <li>Перейдите на страницу <strong>"Склад"</strong>.</li>
                                <li>Нажмите кнопку <strong>"Пополнить"</strong>.</li>
                                <li>Загрузите этот же файл, чтобы добавить новые товары на склад.</li>
                                <li>Вернитесь сюда и повторите импорт сметы.</li>
                            </ol>
                        </div>
                    );
                    // Показываем кастомное уведомление. Увеличиваем длительность, чтобы пользователь успел прочитать.
                    toast.error(friendlyMessage, { id: toastId, duration: 15000 });

                } else {
                    // Если это любая другая ошибка, показываем ее как обычно
                    throw new Error(errorMessage);
                }
            } else {
                // Если все хорошо
                toast.success('Смета успешно импортирована!', { id: toastId });
                // Обновляем список смет
                if (currentPage !== 1) {
                    setCurrentPage(1);
                } else {
                    // "Дергаем" состояние, чтобы вызвать useEffect и обновить данные
                    setSearchTerm(prev => prev === '' ? ' ' : '');
                    setTimeout(() => setSearchTerm(''), 10);
                }
            }
        } catch (err: any) {
            // Этот блок теперь будет ловить только "неожиданные" ошибки
            if (err.message) { // Проверяем, что в toast не передается "пустота"
                toast.error(`Ошибка: ${err.message}`, { id: toastId });
            }
        } finally {
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    const handleDelete = async (estimateId: number) => {
        if (confirm('Вы уверены, что хотите удалить эту смету?')) {
            const toastId = toast.loading('Удаление сметы...');
            try {
                const response = await fetch(`${API_URL}/estimates/${estimateId}`, {
                    method: 'DELETE',
                });
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.detail || 'Не удалось удалить смету');
                }
                toast.success('Смета успешно удалена.', { id: toastId });

                // Триггерим обновление списка
                if (currentPage !== 1) setCurrentPage(1);
                else setSearchTerm(prev => prev); // "дергаем" состояние, чтобы вызвать useEffect
            } catch (err: any) {
                toast.error(`Ошибка: ${err.message}`, { id: toastId });
            }
        }
    };

    const formatDate = (dateString: string) => new Date(dateString).toLocaleDateString('ru-RU');

    return (
        <main className="container mx-auto p-4 sm:p-6 lg:p-8">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold text-gray-800">Сметы</h1>
                <div className="flex space-x-2">
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileImport}
                        className="hidden"
                        accept=".xlsx,.xls"
                    />
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-2 px-4 py-2 bg-purple-500 text-white rounded-md hover:bg-purple-600"
                    >
                        <Upload size={18} /> Импорт (Петрович)
                    </button>
                    <Link href="/estimates/new" className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600">
                        <Plus size={18} /> Создать смету
                    </Link>
                </div>
            </div>

            <div className="bg-white rounded-lg shadow-md overflow-hidden">
                <div className="p-4 border-b">
                    <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <Search size={18} className="text-gray-400" />
                        </div>
                        <input
                            type="text"
                            placeholder="Поиск по номеру, клиенту или объекту..."
                            value={searchTerm}
                            onChange={(e) => handleSearchChange(e.target.value)}
                            className="w-full p-2 pl-10 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead className="bg-gray-100 border-b-2 border-gray-200">
                            <tr>
                                <th className="py-3 px-4 text-left font-semibold text-gray-600 uppercase tracking-wider">Номер</th>
                                <th className="py-3 px-4 text-left font-semibold text-gray-600 uppercase tracking-wider">Дата</th>
                                <th className="py-3 px-4 text-left font-semibold text-gray-600 uppercase tracking-wider">Клиент</th>
                                <th className="py-3 px-4 text-left font-semibold text-gray-600 uppercase tracking-wider">Объект</th>
                                <th className="py-3 px-4 text-left font-semibold text-gray-600 uppercase tracking-wider">Статус</th>
                                <th className="py-3 px-4 text-center font-semibold text-gray-600 uppercase tracking-wider">Действия</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {isLoading ? (
                                <tr><td colSpan={6} className="text-center py-10 text-gray-500">Загрузка...</td></tr>
                            ) : estimates.length === 0 ? (
                                <tr><td colSpan={6} className="text-center py-10 text-gray-500">Сметы не найдены.</td></tr>
                            ) : (
                                estimates.map(estimate => (
                                    <tr key={estimate.id} className="hover:bg-gray-50">
                                        <td className="py-3 px-4 font-medium">{estimate.estimate_number}</td>
                                        <td className="py-3 px-4 text-gray-500">{formatDate(estimate.created_at)}</td>
                                        <td className="py-3 px-4">{estimate.client_name}</td>
                                        <td className="py-3 px-4 text-gray-600">{estimate.location || '—'}</td>
                                        <td className="py-3 px-4">
                                            <span className="px-2 py-1 text-xs font-semibold text-green-800 bg-green-100 rounded-full">
                                                {estimate.status}
                                            </span>
                                        </td>
                                        <td className="py-3 px-4 text-center">
                                            <div className="flex justify-center items-center space-x-2">
                                                <Link href={`/estimates/${estimate.id}`} className="p-1 text-gray-600 hover:text-blue-600" title="Просмотреть/Редактировать">
                                                    <Eye size={16} />
                                                </Link>
                                                <button onClick={() => handleDelete(estimate.id)} className="p-1 text-gray-600 hover:text-red-600" title="Удалить смету">
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
                {totalPages > 1 && (
                    <div className="p-4 border-t flex justify-between items-center">
                        <button onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1 || isLoading} className="flex items-center gap-1 px-3 py-1 bg-gray-200 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed">
                            <ChevronLeft size={16} /> Назад
                        </button>
                        <span>Страница {currentPage} из {totalPages}</span>
                        <button onClick={() => handlePageChange(currentPage + 1)} disabled={currentPage === totalPages || isLoading} className="flex items-center gap-1 px-3 py-1 bg-gray-200 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed">
                            Вперед <ChevronRight size={16} />
                        </button>
                    </div>
                )}
            </div>
        </main>
    );
}