// src/components/ProtectedLayout.tsx
'use client';
import Link from 'next/link';
import toast from 'react-hot-toast';
import Cookies from 'js-cookie';
import { Warehouse, Users, FileText, BookUser, Trash2, History, ClipboardList, LayoutDashboard, X, Menu, LineChart, Hammer, ShoppingCart, Download } from 'lucide-react';
import { useState } from 'react';

const NavLink = ({ href, children, onClose }: { href: string, children: React.ReactNode, onClose: () => void }) => {
    return (
        <Link
            href={href}
            onClick={onClose}
            className="flex items-center gap-3 px-3 py-2 text-gray-700 rounded-md hover:bg-gray-100 transition-colors"
        >
            {children}
        </Link>
    );
};

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
    const API_URL = process.env.NEXT_PUBLIC_API_URL;

    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    const handleDownloadBackup = async () => {
        const toastId = toast.loading('Подготовка бэкапа...');
        try {
            const token = Cookies.get('accessToken');
            if (!token) {
                throw new Error('Необходимо войти в систему');
            }
            const response = await fetch(`${API_URL}/admin/backup`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            if (!response.ok) {
                throw new Error('Не удалось скачать бэкап');
            }
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const contentDisposition = response.headers.get('Content-Disposition');
            let filename = 'backup.json';
            if (contentDisposition) {
                const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
                if (filenameMatch && filenameMatch.length === 2)
                    filename = filenameMatch[1];
            }
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            toast.success('Бэкап успешно скачан', { id: toastId });
        } catch (err: any) {
            toast.error(`Ошибка: ${err.message}`, { id: toastId });
        }
    };

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
            <aside className={`w-64 bg-white shadow-md flex-col flex-shrink-0 lg:flex ${isMobileMenuOpen ? 'flex' : 'hidden'} absolute lg:relative z-20 h-full`}>
                <div className="p-4 border-b">
                    <h1 className="text-2xl font-bold text-blue-600">Склад v4</h1>
                </div>
                <nav className="flex-grow p-4 space-y-2">
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
                    <NavLink href="/products-to-order" onClose={() => setIsMobileMenuOpen(false)}>
                        <ShoppingCart size={20} />
                        <span>Товары к закупу</span>
                    </NavLink>
                    <NavLink href="/history" onClose={() => setIsMobileMenuOpen(false)}>
                        <History size={20} />
                        <span>История</span>
                    </NavLink>
                    <NavLink href="/worker-stock" onClose={() => setIsMobileMenuOpen(false)}>
                        <Users size={20} />
                        <span>На руках</span>
                    </NavLink>

                    {/* Разделитель для секции отчетов */}
                    <div className="pt-2">
                        <span className="px-3 text-xs font-semibold uppercase text-gray-500">Отчеты</span>
                    </div>

                    <NavLink href="/reports/profit" onClose={() => setIsMobileMenuOpen(false)}>
                        <LineChart size={20} />
                        <span>Прибыль по сметам</span>
                    </NavLink>
                    <NavLink href="/reports/drilling" onClose={() => setIsMobileMenuOpen(false)}>
                        <Hammer size={20} />
                        <span>Прибыль по бурению</span>
                    </NavLink>

                </nav>
                <div className="p-4 border-t space-y-2">
                    <button onClick={handleDownloadBackup} className="w-full flex items-center justify-center gap-2 px-3 py-2 text-blue-600 bg-blue-50 rounded-md hover:bg-blue-100 hover:text-blue-800 transition-colors">
                        <Download size={16} />
                        <span>Скачать бэкап</span>
                    </button>
                    <button onClick={handleClearData} className="w-full flex items-center justify-center gap-2 px-3 py-2 text-red-600 bg-red-50 rounded-md hover:bg-red-100 hover:text-red-800 transition-colors">
                        <Trash2 size={16} />
                        <span>Очистить БД</span>
                    </button>
                </div>
            </aside>

            <div className="flex-1 flex flex-col overflow-hidden">
                <header className="lg:hidden bg-white shadow-md p-4 flex justify-between items-center">
                    <h1 className="text-xl font-bold text-blue-600">Склад v4</h1>
                    <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
                        {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
                    </button>
                </header>

                <div className="flex-1 overflow-y-auto">
                    {children}
                </div>
            </div>
        </div>
    );
}