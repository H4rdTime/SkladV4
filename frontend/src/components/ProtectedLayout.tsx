// frontend/src/components/ProtectedLayout.tsx
'use client';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { Warehouse, Users, FileText, BookUser, Trash2, History, ClipboardList, LayoutDashboard, X, Menu } from 'lucide-react';
import { useState } from 'react';

const NavLink = ({ href, children, onClose }: { href: string, children: React.ReactNode, onClose: () => void }) => {
    return (
        <Link
            href={href}
            onClick={onClose} // <-- ВОТ МАГИЯ: при клике вызываем функцию закрытия
            className="flex items-center gap-3 px-3 py-2 text-gray-700 rounded-md hover:bg-gray-100 transition-colors"
        >
            {children}
        </Link>
    );
};

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
    const API_URL = process.env.NEXT_PUBLIC_API_URL;

    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

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
        <div className="flex h-screen bg-gray-100">
            {/* --- Боковое меню (Сайдбар) --- */}
            {/* Оно теперь будет прятаться на экранах меньше `lg` (large) */}
            <aside className={`w-64 bg-white shadow-md flex-col flex-shrink-0 lg:flex ${isMobileMenuOpen ? 'flex' : 'hidden'} absolute lg:relative z-20 h-full`}>
                <div className="p-4 border-b">
                    <h1 className="text-2xl font-bold text-blue-600">Склад v4</h1>
                </div>
                <nav className="flex-grow p-4 space-y-2">
                    {/* --- ИЗМЕНЕНИЕ: Заменяем все <Link> на <NavLink> --- */}
                    <NavLink href="/dashboard" onClose={() => setIsMobileMenuOpen(false)}>
                        <LayoutDashboard size={20} />
                        <span>Дашборд</span>
                    </NavLink>
                    <NavLink href="/warehouse" onClose={() => setIsMobileMenuOpen(false)}>
                        <Warehouse size={20} />
                        <span>Склад</span>
                    </NavLink>
                    <NavLink href="/workers" onClose={() => setIsMobileMenuOpen(false)}>
                        <Users size={20} />
                        <span>Работники</span>
                    </NavLink>
                    <NavLink href="/estimates" onClose={() => setIsMobileMenuOpen(false)}>
                        <FileText size={20} />
                        <span>Сметы</span>
                    </NavLink>
                    <NavLink href="/contracts" onClose={() => setIsMobileMenuOpen(false)}>
                        <BookUser size={20} />
                        <span>Договоры</span>
                    </NavLink>
                    <NavLink href="/history" onClose={() => setIsMobileMenuOpen(false)}>
                        <History size={20} />
                        <span>История</span>
                    </NavLink>
                    <NavLink href="/worker-stock" onClose={() => setIsMobileMenuOpen(false)}>
                        <Users size={20} />
                        <span>На руках</span>
                    </NavLink>
                    <NavLink href="/reports" onClose={() => setIsMobileMenuOpen(false)}>
                        <ClipboardList size={20} />
                        <span>Отчеты</span>
                    </NavLink>
                </nav>
                <div className="p-4 border-t">
                    <button onClick={handleClearData} className="w-full flex items-center justify-center gap-2 px-3 py-2 text-red-600 bg-red-50 rounded-md hover:bg-red-100 hover:text-red-800 transition-colors">
                        <Trash2 size={16} />
                        <span>Очистить БД</span>
                    </button>
                </div>
            </aside>

            {/* --- Основной контент --- */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* --- НОВАЯ ВЕРХНЯЯ ПАНЕЛЬ (Header) --- */}
                <header className="lg:hidden bg-white shadow-md p-4 flex justify-between items-center">
                    <h1 className="text-xl font-bold text-blue-600">Склад v4</h1>
                    <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
                        {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
                    </button>
                </header>

                {/* Контент страницы теперь имеет свой скролл */}
                <div className="flex-1 overflow-y-auto">
                    {children}
                </div>
            </div>
        </div>
    );
}