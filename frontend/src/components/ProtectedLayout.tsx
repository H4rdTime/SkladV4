// frontend/src/components/ProtectedLayout.tsx
'use client';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { Warehouse, Users, FileText, BookUser, Trash2, History, ClipboardList, LayoutDashboard } from 'lucide-react';

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
    const API_URL = process.env.NEXT_PUBLIC_API_URL;

    const handleClearData = async () => {
        if (confirm('!!! ВНИМАНИЕ !!!\n\nВы уверены, что хотите удалить ВСЕ данные (товары, сметы, договоры, историю)?\n\nЭто действие НЕОБРАТИМО.')) {
            const toastId = toast.loading('Очистка базы данных...');
            try {
                const response = await fetch(`${API_URL}/actions/clear-all-data/`, {
                    method: 'POST',
                });
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.detail || 'Не удалось очистить базу данных');
                }
                toast.success('База данных успешно очищена. Перезагрузка...', { id: toastId });
                setTimeout(() => window.location.reload(), 1500);
            } catch (err: any) {
                toast.error(`Ошибка: ${err.message}`, { id: toastId });
            }
        }
    };


    return (
        <div className="flex h-screen">
            <aside className="w-64 bg-white shadow-md flex flex-col">
                <div className="p-4 border-b">
                    <h1 className="text-2xl font-bold text-blue-600">Склад v4</h1>
                </div>
                <nav className="flex-grow p-4 space-y-2">

                    {/* --- ДОБАВЬТЕ ЭТУ ССЫЛКУ ПЕРВОЙ --- */}
                    <Link href="/dashboard" className="flex items-center gap-3 px-3 py-2 text-gray-700 rounded-md hover:bg-gray-100 transition-colors">
                        <LayoutDashboard size={20} />
                        <span>Дашборд</span>
                    </Link>

                    <Link href="/warehouse" className="flex items-center gap-3 px-3 py-2 text-gray-700 rounded-md hover:bg-gray-100 transition-colors">
                        <Warehouse size={20} />
                        <span>Склад</span>
                    </Link>
                    <Link href="/workers" className="flex items-center gap-3 px-3 py-2 text-gray-700 rounded-md hover:bg-gray-100 transition-colors">
                        <Users size={20} />
                        <span>Работники</span>
                    </Link>
                    <Link href="/estimates" className="flex items-center gap-3 px-3 py-2 text-gray-700 rounded-md hover:bg-gray-100 transition-colors">
                        <FileText size={20} />
                        <span>Сметы</span>
                    </Link>
                    <Link href="/contracts" className="flex items-center gap-3 px-3 py-2 text-gray-700 rounded-md hover:bg-gray-100 transition-colors">
                        <BookUser size={20} />
                        <span>Договоры</span>
                    </Link>
                    <Link href="/history" className="flex items-center gap-3 px-3 py-2 text-gray-700 rounded-md hover:bg-gray-100 transition-colors">
                        <History size={20} />
                        <span>История</span>
                    </Link>
                    <Link href="/worker-stock" className="flex items-center gap-3 px-3 py-2 text-gray-700 rounded-md hover:bg-gray-100 transition-colors">
                        <Users size={20} /> {/* Можно будет поменять иконку */}
                        <span>На руках</span>
                    </Link>
                    {/* --- НОВАЯ ССЫЛКА --- */}
                    <Link href="/reports" className="flex items-center gap-3 px-3 py-2 text-gray-700 rounded-md hover:bg-gray-100 transition-colors">
                        <ClipboardList size={20} />
                        <span>Отчеты</span>
                    </Link>
                </nav>
                <div className="p-4 border-t">
                    <button onClick={handleClearData} className="...">
                        <Trash2 size={16} />
                        <span>Очистить БД</span>
                    </button>
                </div>
            </aside>
            <main className="flex-1 overflow-y-auto">
                {children}
            </main>
        </div>
    );
}