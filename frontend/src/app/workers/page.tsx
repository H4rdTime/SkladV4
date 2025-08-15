// frontend/src/app/workers/page.tsx
'use client';

import { useState, useEffect, FormEvent } from 'react';
import Modal from '@/components/Modal';
import { Plus, RefreshCw, Edit, Trash2, Users } from 'lucide-react';

interface Worker {
    id: number;
    name: string;
}

export default function WorkersPage() {
    const [workers, setWorkers] = useState<Worker[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingWorker, setEditingWorker] = useState<Worker | null>(null);

    const API_URL = 'https://sklad-petrovich-api.onrender.com';

    const fetchWorkers = async () => {
        setIsLoading(true);
        try {
            const response = await fetch(`${API_URL}/workers/`);
            if (!response.ok) throw new Error('Ошибка загрузки работников');
            setWorkers(await response.json());
        } catch (error) {
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchWorkers();
    }, []);

    const openCreateModal = () => {
        setEditingWorker(null);
        setIsModalOpen(true);
    };

    const openEditModal = (worker: Worker) => {
        setEditingWorker(worker);
        setIsModalOpen(true);
    };

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const workerData = { name: formData.get('name') as string };

        // Логика теперь полная
        const url = editingWorker
            ? `${API_URL}/workers/${editingWorker.id}`
            : `${API_URL}/workers/`;
        const method = editingWorker ? 'PATCH' : 'POST';

        try {
            const response = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(workerData),
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || 'Ошибка сохранения работника');
            }
            setIsModalOpen(false);
            fetchWorkers();
        } catch (err: any) {
            alert(`Ошибка: ${err.message}`);
        }
    };

    const handleDelete = async (workerId: number) => {
        if (confirm('Вы уверены, что хотите удалить этого работника?')) {
            try {
                const response = await fetch(`${API_URL}/workers/${workerId}`, {
                    method: 'DELETE',
                });
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.detail || 'Не удалось удалить работника');
                }
                fetchWorkers(); // Обновляем список после удаления
            } catch (err: any) {
                alert(`Ошибка: ${err.message}`);
            }
        }
    };


    return (
        <main className="container mx-auto p-4 sm:p-6 lg:p-8">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold text-gray-800">Работники</h1>
                <button onClick={openCreateModal} className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600">
                    <Plus size={18} /> Добавить работника
                </button>
            </div>

            <div className="bg-white rounded-lg shadow-md overflow-hidden">
                <table className="min-w-full text-sm">
                    <thead className="bg-gray-100">
                        <tr>
                            <th className="py-3 px-4 text-left font-semibold text-gray-600">ID</th>
                            <th className="py-3 px-4 text-left font-semibold text-gray-600">Имя</th>
                            <th className="py-3 px-4 text-center font-semibold text-gray-600">Действия</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                        {isLoading ? (
                            <tr><td colSpan={3} className="text-center py-10">Загрузка...</td></tr>
                        ) : (
                            workers.map(worker => (
                                <tr key={worker.id} className="hover:bg-gray-50">
                                    <td className="py-3 px-4 text-gray-500">{worker.id}</td>
                                    <td className="py-3 px-4 font-medium">{worker.name}</td>
                                    <td className="py-3 px-4 text-center">
                                        <div className="flex justify-center items-center space-x-2">
                                            <button onClick={() => openEditModal(worker)} className="p-1 text-blue-600 hover:text-blue-800"><Edit size={16} /></button>
                                            <button onClick={() => handleDelete(worker.id)} className="p-1 text-red-600 hover:text-red-800"><Trash2 size={16} /></button>
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {isModalOpen && (
                <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingWorker ? 'Редактировать работника' : 'Новый работник'}>
                    <form onSubmit={handleSubmit}>
                        <div>
                            <label htmlFor="name" className="block text-sm font-medium text-gray-700">Имя работника</label>
                            <input type="text" name="name" id="name" required defaultValue={editingWorker?.name || ''} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3" />
                        </div>
                        <div className="flex justify-end pt-4 mt-4">
                            <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 bg-gray-200 rounded-md mr-2">Отмена</button>
                            <button type="submit" className="px-4 py-2 bg-blue-500 text-white rounded-md">Сохранить</button>
                        </div>
                    </form>
                </Modal>
            )}
        </main>
    );
}