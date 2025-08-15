// frontend/src/app/reports/page.tsx
'use client';

import { useState, useEffect, FormEvent } from 'react';
import toast from 'react-hot-toast';
import { ShoppingCart, DollarSign } from 'lucide-react';

// Типы данных для отчетов
interface ProductToOrder {
    id: number;
    name: string;
    stock_quantity: number;
    min_stock_level: number;
    unit: string;
}

interface ProfitReportItem {
    estimate_id: number;
    estimate_number: string;
    client_name: string;
    completed_at: string;
    total_retail: number;
    total_purchase: number;
    profit: number;
    margin: number;
}

interface ProfitReport {
    items: ProfitReportItem[];
    grand_total_retail: number;
    grand_total_purchase: number;
    grand_total_profit: number;
    average_margin: number;
}


export default function ReportsPage() {
    const [productsToOrder, setProductsToOrder] = useState<ProductToOrder[]>([]);
    const [isLoadingStock, setIsLoadingStock] = useState(true);

    const [profitReport, setProfitReport] = useState<ProfitReport | null>(null);
    const [isLoadingProfit, setIsLoadingProfit] = useState(false);
    const [startDate, setStartDate] = useState(new Date(new Date().setDate(1)).toISOString().split('T')[0]);
    const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
    const [estimateIdFilter, setEstimateIdFilter] = useState('');

    const API_URL = 'https://sklad-petrovich-api.onrender.com';

    useEffect(() => {
        const fetchProductsToOrder = async () => {
            setIsLoadingStock(true);
            try {
                // Используем наш готовый API с фильтром
                const response = await fetch(`${API_URL}/products/?stock_status=low_stock`);
                if (!response.ok) throw new Error('Ошибка загрузки отчета "К закупке"');

                // --- ИСПРАВЛЕНИЕ ЗДЕСЬ ---
                const data = await response.json(); // Сначала получаем объект
                setProductsToOrder(data.items);   // А в состояние кладем только массив items
                // --- КОНЕЦ ИСПРАВЛЕНИЯ ---

            } catch (error: any) { toast.error(error.message); }
            finally { setIsLoadingStock(false); }
        };
        fetchProductsToOrder();
    }, []);

    const handleFetchProfitReport = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setIsLoadingProfit(true);
        setProfitReport(null);

        let url = `${API_URL}/reports/profit?`;

        // Определяем, какой фильтр использовать
        if (estimateIdFilter) {
            url += `estimate_id=${estimateIdFilter}`;
        } else if (startDate && endDate) {
            url += `start_date=${startDate}&end_date=${endDate}`;
        } else {
            toast.error("Укажите либо ID сметы, либо период.");
            setIsLoadingProfit(false);
            return;
        }

        try {
            const response = await fetch(url);
            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.detail || "Ошибка загрузки отчета по прибыли");
            }
            setProfitReport(await response.json());
        } catch (error: any) {
            toast.error(error.message);
        } finally {
            setIsLoadingProfit(false);
        }
    };

    return (
        <main className="container mx-auto p-4 sm:p-6 lg:p-8">
            <h1 className="text-3xl font-bold text-gray-800 mb-6">Отчеты</h1>

            <div className="space-y-8">
                <div className="bg-white rounded-lg shadow-md overflow-hidden">
                    <div className="p-4 border-b flex items-center gap-3">
                        <ShoppingCart size={20} className="text-blue-600" />
                        <h2 className="text-xl font-semibold text-gray-700">Товары к закупке</h2>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                            <thead className="bg-gray-50 border-b-2 border-gray-200">
                                <tr>
                                    <th className="py-3 px-4 text-left font-semibold text-gray-600">Наименование</th>
                                    <th className="py-3 px-4 text-right font-semibold text-gray-600">Текущий остаток</th>
                                    <th className="py-3 px-4 text-right font-semibold text-gray-600">Минимальный остаток</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                                {isLoadingStock ? (
                                    <tr><td colSpan={3} className="text-center py-10 text-gray-500">Формирование отчета...</td></tr>
                                ) : productsToOrder.length === 0 ? (
                                    <tr><td colSpan={3} className="text-center py-10 text-gray-500">Всех товаров в достатке. Закупка не требуется.</td></tr>
                                ) : (
                                    productsToOrder.map(product => (
                                        <tr key={product.id} className="bg-yellow-50">
                                            <td className="py-3 px-4 font-medium text-gray-900">{product.name}</td>
                                            <td className="py-3 px-4 text-right font-bold text-red-600">{product.stock_quantity} {product.unit}</td>
                                            <td className="py-3 px-4 text-right text-gray-600">{product.min_stock_level} {product.unit}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="bg-white rounded-lg shadow-md overflow-hidden">
                    <div className="p-4 border-b flex items-center gap-3">
                        <DollarSign size={20} className="text-green-600" />
                        <h2 className="text-xl font-semibold text-gray-700">Отчет по прибыли</h2>
                    </div>

                    <form onSubmit={handleFetchProfitReport} className="p-4 bg-gray-50 space-y-4">
                        <p className="text-sm text-gray-500">Сформируйте отчет либо за период, либо по ID конкретной сметы. Если указан ID, даты игнорируются.</p>
                        <div className="flex flex-wrap items-center gap-4">
                            <div className="flex items-center gap-2">
                                <label htmlFor="start-date" className="text-sm">С:</label>
                                <input type="date" id="start-date" value={startDate} onChange={e => setStartDate(e.target.value)} className="p-1 border rounded-md" />
                            </div>
                            <div className="flex items-center gap-2">
                                <label htmlFor="end-date" className="text-sm">По:</label>
                                <input type="date" id="end-date" value={endDate} onChange={e => setEndDate(e.target.value)} className="ml-2 p-1 border rounded-md" />
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <label htmlFor="estimate-id-filter" className="text-sm font-medium">Или по ID сметы:</label>
                            <input
                                type="number"
                                id="estimate-id-filter"
                                placeholder="ID"
                                value={estimateIdFilter}
                                onChange={(e) => setEstimateIdFilter(e.target.value)}
                                className="p-1 border rounded-md w-24"
                            />
                        </div>
                        <div>
                            <button type="submit" disabled={isLoadingProfit} className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:bg-gray-400">
                                {isLoadingProfit ? 'Загрузка...' : 'Сформировать отчет'}
                            </button>
                        </div>
                    </form>

                    {isLoadingProfit && <p className="p-4 text-center text-gray-500">Формирование отчета по прибыли...</p>}

                    {profitReport && (
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-sm">
                                <thead className="bg-gray-50 border-b-2">
                                    <tr>
                                        <th className="p-2 text-left">Смета</th>
                                        <th className="p-2 text-left">Клиент</th>
                                        <th className="p-2 text-right">Сумма продажи</th>
                                        <th className="p-2 text-right">Себестоимость</th>
                                        <th className="p-2 text-right">Прибыль</th>
                                        <th className="p-2 text-right">Маржа</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {profitReport.items.map(item => (
                                        <tr key={item.estimate_id}>
                                            <td className="p-2">{item.estimate_number}</td>
                                            <td className="p-2">{item.client_name}</td>
                                            <td className="p-2 text-right">{item.total_retail.toFixed(2)} ₽</td>
                                            <td className="p-2 text-right text-gray-600">{item.total_purchase.toFixed(2)} ₽</td>
                                            <td className="p-2 text-right font-bold text-green-700">{item.profit.toFixed(2)} ₽</td>
                                            <td className="p-2 text-right">{item.margin.toFixed(1)}%</td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot className="bg-gray-100 font-bold border-t-2">
                                    <tr>
                                        <td className="p-2" colSpan={2}>ИТОГО:</td>
                                        <td className="p-2 text-right">{profitReport.grand_total_retail.toFixed(2)} ₽</td>
                                        <td className="p-2 text-right">{profitReport.grand_total_purchase.toFixed(2)} ₽</td>
                                        <td className="p-2 text-right text-green-800">{profitReport.grand_total_profit.toFixed(2)} ₽</td>
                                        <td className="p-2 text-right">{profitReport.average_margin.toFixed(1)}%</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    )}
                    {!profitReport && !isLoadingProfit && <p className="p-4 text-center text-gray-500">Выберите фильтр и нажмите "Сформировать".</p>}
                </div>
            </div>
        </main>
    );
}