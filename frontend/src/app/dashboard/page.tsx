// frontend/src/app/dashboard/page.tsx
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, FileText, BookUser, DollarSign } from 'lucide-react';
import toast from 'react-hot-toast';
import { fetchApi } from '@/lib/api'; // <-- Новый импорт

interface DashboardData {
    products_to_order_count: number;
    estimates_in_progress_count: number;
    contracts_in_progress_count: number;
    profit_last_30_days: number;
}

const StatCard = ({ title, value, icon: Icon, link, color }: { title: string, value: string | number, icon: React.ElementType, link: string, color: string }) => (
    <Link href={link} className="block p-6 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow border-l-4" style={{ borderColor: color }}>
        <div className="flex items-center">
            <div className="p-3 rounded-full mr-4" style={{ backgroundColor: `${color}1A` }}>
                <Icon style={{ color: color }} size={24} />
            </div>
            <div>
                <p className="text-sm font-medium text-gray-500">{title}</p>
                <p className="text-2xl font-bold text-gray-800">{value}</p>
            </div>
        </div>
    </Link>
);

export default function DashboardPage() {
    const [data, setData] = useState<DashboardData | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const API_URL = 'https://sklad-petrovich-api.onrender.com';

    useEffect(() => {
        const fetchData = async () => {
            setIsLoading(true);
            try {
                // Используем fetchApi вместо fetch
                const data = await fetchApi('/dashboard/summary');
                setData(data);
            } catch (error: any) { toast.error(error.message); }
            finally { setIsLoading(false); }
        };
        fetchData();
    }, []);

    if (isLoading) {
        return <div className="p-8 text-center text-gray-500">Загрузка данных...</div>
    }

    return (
        <main className="container mx-auto p-4 sm:p-6 lg:p-8">
            <h1 className="text-3xl font-bold text-gray-800 mb-6">Сводная панель</h1>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard
                    title="Товары к закупке"
                    value={data?.products_to_order_count || 0}
                    icon={AlertTriangle}
                    link="/reports"
                    color="#f59e0b" // yellow-500
                />
                <StatCard
                    title="Сметы в работе"
                    value={data?.estimates_in_progress_count || 0}
                    icon={FileText}
                    link="/estimates"
                    color="#3b82f6" // blue-500
                />
                <StatCard
                    title="Договоры в работе"
                    value={data?.contracts_in_progress_count || 0}
                    icon={BookUser}
                    link="/contracts"
                    color="#8b5cf6" // violet-500
                />
                <StatCard
                    title="Прибыль за 30 дней"
                    value={`${(data?.profit_last_30_days || 0).toFixed(0)} ₽`}
                    icon={DollarSign}
                    link="/reports"
                    color="#10b981" // emerald-500
                />
            </div>
        </main>
    );
}