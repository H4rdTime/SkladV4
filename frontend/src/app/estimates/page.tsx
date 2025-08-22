'use client';

import { useState, useEffect, useRef } from 'react';
import { Plus, Eye, Upload, Trash2, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { fetchApi } from '@/lib/api';

interface Estimate {
    id: number;
    estimate_number: string;
    client_name: string;
    location: string | null;
    status: string;
    created_at: string;
    worker_id?: number | null;
    shipped_at?: string | null;
}

export default function EstimatesPage() {
    const [estimates, setEstimates] = useState<Estimate[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    
    // --- ИЗМЕНЕНИЯ: Отдельные refs и состояние загрузки для каждой кнопки ---
    const fileInputPetrovichRef = useRef<HTMLInputElement>(null);
    const fileInput1cRef = useRef<HTMLInputElement>(null);
    const [isUploading1c, setIsUploading1c] = useState(false);
    // ---

    const [searchTerm, setSearchTerm] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(0);
    const PAGE_SIZE = 20;
    const [workersMap, setWorkersMap] = useState<Record<number, string>>({});

    // Reusable loader so we can call it from handlers (delete/import) to avoid brittle state hacks
    const fetchEstimates = async (page: number, search: string) => {
        setIsLoading(true);
        try {
            const params = new URLSearchParams({ page: String(page), size: String(PAGE_SIZE) });
            if (search) params.append('search', search);

            const data = await fetchApi(`/estimates/?${params.toString()}`);
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

    useEffect(() => {
        const debounceTimer = setTimeout(() => { fetchEstimates(currentPage, searchTerm); }, 300);
        return () => clearTimeout(debounceTimer);
    }, [currentPage, searchTerm]);

    // Load workers once so we can show worker names next to shipped date
    useEffect(() => {
        const fetchWorkers = async () => {
            try {
                const data = await fetchApi('/workers/');
                if (Array.isArray(data)) {
                    const map: Record<number, string> = {};
                    data.forEach((w: any) => { if (w && typeof w.id === 'number') map[w.id] = w.name; });
                    setWorkersMap(map);
                }
            } catch (err) {
                // non-blocking: если не удалось загрузить, просто оставим пустой map
            }
        };
        fetchWorkers();
    }, []);

    const handleSearchChange = (term: string) => {
        setSearchTerm(term);
        setCurrentPage(1);
    };

    const handlePageChange = (newPage: number) => {
        if (newPage > 0 && newPage <= totalPages) setCurrentPage(newPage);
    };

    // --- ИЗМЕНЕНИЕ: Переименовали функцию для ясности ---
    const handlePetrovichFileImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);
        formData.append('mode', 'as_estimate');
        formData.append('is_initial_load', 'false');
        formData.append('auto_create_new', 'false');

        const toastId = toast.loading('Импорт сметы...');
        try {
            await fetchApi('/actions/universal-import/', { method: 'POST', body: formData });
            toast.success('Смета успешно импортирована!', { id: toastId });
            // Перезагружаем список после успешного импорта
            setCurrentPage(1);
            await fetchEstimates(1, '');
        } catch (err: any) {
            toast.error(`Ошибка: ${err.message}`, { id: toastId });
        } finally {
            if (fileInputPetrovichRef.current) {
                fileInputPetrovichRef.current.value = '';
            }
        }
    };
    
    // --- НОВАЯ ФУНКЦИЯ для импорта из 1С ---
    const handle1cFileImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setIsUploading1c(true);
        const formData = new FormData();
        formData.append('file', file); // Отправляем только файл

        const toastId = toast.loading('Импорт сметы из 1С...');
        try {
            // Вызываем новый эндпоинт
            const result = await fetchApi('/actions/import-1c-estimate/', {
                method: 'POST',
                body: formData,
            });
            
            toast.success(`Смета "${result.estimate_number}" успешно импортирована!`, { id: toastId });
            
            // Обновляем список: переключаем на страницу 1 и явно перезагружаем
            setCurrentPage(1);
            await fetchEstimates(1, '');
        } catch (err: any) {
            toast.error(`Ошибка: ${err.message}`, { id: toastId });
        } finally {
            setIsUploading1c(false);
            if (fileInput1cRef.current) {
                fileInput1cRef.current.value = '';
            }
        }
    };

    const handleDelete = async (estimateId: number) => {
        if (confirm('Вы уверены, что хотите удалить эту смету?')) {
            const toastId = toast.loading('Удаление сметы...');
            try {
                await fetchApi(`/estimates/${estimateId}`, { method: 'DELETE' });
                toast.success('Смета успешно удалена.', { id: toastId });
                // Оптимистично убираем удалённую смету из списка, чтобы избежать мерцания
                setEstimates(prev => prev.filter(e => e.id !== estimateId));
                // Затем синхронизируем с сервером — подстраховка на случай пагинации/фильтров
                const pageToLoad = currentPage === 1 ? 1 : 1;
                setCurrentPage(pageToLoad);
                await fetchEstimates(pageToLoad, searchTerm);
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
                <div className="flex flex-wrap items-center gap-2">
                    {/* --- ИЗМЕНЕНИЯ: Два отдельных input'а --- */}
                    <input
                        type="file"
                        ref={fileInputPetrovichRef}
                        onChange={handlePetrovichFileImport}
                        className="hidden"
                        accept=".xlsx,.xls"
                    />
                     <input
                        type="file"
                        ref={fileInput1cRef}
                        onChange={handle1cFileImport}
                        className="hidden"
                        accept=".xls"
                    />
                    
                    {/* --- Кнопка Петровича привязана к своему ref'у --- */}
                    <button
                        onClick={() => fileInputPetrovichRef.current?.click()}
                        className="flex items-center gap-2 px-4 py-2 bg-purple-500 text-white rounded-md hover:bg-purple-600"
                    >
                        <Upload size={18} /> Импорт (Петрович)
                    </button>

                    {/* --- Кнопка 1С привязана к своему ref'у и состоянию загрузки --- */}
                    <button
                        onClick={() => fileInput1cRef.current?.click()}
                        disabled={isUploading1c}
                        className="flex items-center gap-2 px-4 py-2 bg-yellow-500 text-black rounded-md hover:bg-yellow-600 disabled:bg-gray-400"
                    >
                        <Upload size={18} />
                        {isUploading1c ? 'Загрузка...' : 'Импорт (1С)'}
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
                                <th className="py-3 px-4 text-left font-semibold text-gray-600">ID</th>
                                <th className="py-3 px-4 text-left font-semibold text-gray-600 uppercase tracking-wider">Номер</th>
                                <th className="py-3 px-4 text-left font-semibold text-gray-600 uppercase tracking-wider">Дата</th>
                                <th className="py-3 px-4 text-left font-semibold text-gray-600 uppercase tracking-wider">Клиент</th>
                                <th className="py-3 px-4 text-left font-semibold text-gray-600 uppercase tracking-wider">Объект</th>
                                <th className="py-3 px-4 text-left font-semibold text-gray-600 uppercase tracking-wider">Статус</th>
                                <th className="py-3 px-4 text-left font-semibold text-gray-600 uppercase tracking-wider">Отгружено</th>
                                <th className="py-3 px-4 text-center font-semibold text-gray-600 uppercase tracking-wider">Действия</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {isLoading ? (
                                <tr><td colSpan={7} className="text-center py-10 text-gray-500">Загрузка...</td></tr>
                            ) : estimates.length === 0 ? (
                                <tr><td colSpan={7} className="text-center py-10 text-gray-500">Сметы не найдены.</td></tr>
                            ) : (
                                estimates.map(estimate => (
                                    <tr key={estimate.id} className="hover:bg-gray-50">
                                        <td className="py-3 px-4 text-gray-500 font-mono">{estimate.id}</td>
                                        <td className="py-3 px-4 font-medium">{estimate.estimate_number}</td>
                                        <td className="py-3 px-4 text-gray-500">{formatDate(estimate.created_at)}</td>
                                        <td className="py-3 px-4">{estimate.client_name}</td>
                                        <td className="py-3 px-4 text-gray-600">{estimate.location || '—'}</td>
                                        <td className="py-3 px-4">
                                            <span className="px-2 py-1 text-xs font-semibold text-green-800 bg-green-100 rounded-full">
                                                {estimate.status}
                                            </span>
                                        </td>
                                        <td className="py-3 px-4 text-gray-600">
                                            <div>
                                                <div>{estimate.shipped_at ? formatDate(estimate.shipped_at) : <span className="text-gray-400">—</span>}</div>
                                                {estimate.worker_id ? <div className="text-sm text-gray-500">{workersMap[estimate.worker_id] || `Работник #${estimate.worker_id}`}</div> : null}
                                            </div>
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