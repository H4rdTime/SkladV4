// frontend/src/app/estimates/page.tsx
'use client';

import { useState, useEffect, useRef } from 'react';
import { Plus, Eye, Upload, Trash2 } from 'lucide-react'; // 1. ДОБАВИЛИ ИКОНКУ TRASH2
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

    const API_URL = 'http://127.0.0.1:8000';

    const fetchEstimates = async () => {
        setIsLoading(true);
        try {
            const response = await fetch(`${API_URL}/estimates/`);
            if (!response.ok) throw new Error('Ошибка загрузки смет');
            setEstimates(await response.json());
        } catch (error) {
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchEstimates();
    }, []);

    const handleFileImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);
        formData.append('mode', 'as_estimate');
        formData.append('is_initial_load', 'false'); // Для смет это всегда false
        formData.append('auto_create_new', 'false'); // Для смет не создаем новые товары

        const toastId = toast.loading('Импорт сметы...');
        try {
            const response = await fetch(`${API_URL}/actions/universal-import/`, {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || 'Не удалось импортировать смету');
            }

            toast.success('Смета успешно импортирована!', { id: toastId });
            fetchEstimates();
        } catch (err: any) {
            toast.error(`Ошибка: ${err.message}`, { id: toastId });
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
                fetchEstimates();
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
                <table className="min-w-full text-sm">
                    <thead className="bg-gray-100">
                        <tr>
                            <th className="py-3 px-4 text-left font-semibold text-gray-600">Номер</th>
                            <th className="py-3 px-4 text-left font-semibold text-gray-600">Дата</th>
                            <th className="py-3 px-4 text-left font-semibold text-gray-600">Клиент</th>
                            <th className="py-3 px-4 text-left font-semibold text-gray-600">Объект</th>
                            <th className="py-3 px-4 text-left font-semibold text-gray-600">Статус</th>
                            <th className="py-3 px-4 text-center font-semibold text-gray-600">Действия</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                        {isLoading ? (
                            <tr><td colSpan={6} className="text-center py-10">Загрузка...</td></tr>
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
                                            {/* --- 2. ДОБАВИЛИ КНОПКУ УДАЛЕНИЯ --- */}
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
        </main>
    );
}