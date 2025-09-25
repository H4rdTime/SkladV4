// frontend/src/app/reports/page.tsx
'use client';

import React, { useState, useEffect, FormEvent } from 'react';
import { fetchApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { ShoppingCart, DollarSign, Plus } from 'lucide-react';

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
    const [includeInProgress, setIncludeInProgress] = useState(false);

    // Details cache / loading / error states for each estimate
    interface ProfitDetailItem {
        product_id: number;
        product_name: string;
        unit?: string | null;
        quantity: number;
        unit_price: number;
        purchase_price?: number | null;
        total_retail?: number | null;
        total_purchase?: number | null;
        difference?: number | null;
    }

    interface ProfitDetailResponse {
        estimate_id: number;
        items: ProfitDetailItem[];
        total_retail: number;
        total_purchase: number;
        total_profit: number;
    }

    const [detailsCache, setDetailsCache] = useState<Record<number, ProfitDetailResponse | null>>({});
    const [detailsLoading, setDetailsLoading] = useState<Record<number, boolean>>({});
    const [detailsError, setDetailsError] = useState<Record<number, string | null>>({});

    const fetchDetails = async (estimateId: number) => {
        if (detailsCache[estimateId] || detailsLoading[estimateId]) return;
        setDetailsError(prev => ({ ...prev, [estimateId]: null }));
        setDetailsLoading(prev => ({ ...prev, [estimateId]: true }));
        try {
            const data: ProfitDetailResponse = await fetchApi(`/reports/profit/${estimateId}/details`);
            setDetailsCache(prev => ({ ...prev, [estimateId]: data }));
        } catch (e: any) {
            setDetailsError(prev => ({ ...prev, [estimateId]: e?.message || 'Ошибка загрузки' }));
        } finally {
            setDetailsLoading(prev => ({ ...prev, [estimateId]: false }));
        }
    };

    // API_URL больше не нужен, используем fetchApi

    useEffect(() => {
        const fetchProductsToOrder = async () => {
            setIsLoadingStock(true);
            try {
                const data = await fetchApi('/products/?stock_status=low_stock');
                // Ensure we have an array, sort from largest stock_quantity -> smallest (0 last)
                const items: ProductToOrder[] = Array.isArray(data.items) ? data.items : [];
                items.sort((a, b) => b.stock_quantity - a.stock_quantity);
                setProductsToOrder(items);
            } catch (error: any) { toast.error(error.message); }
            finally { setIsLoadingStock(false); }
        };
        fetchProductsToOrder();
    }, []);

    const handleFetchProfitReport = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setIsLoadingProfit(true);
        setProfitReport(null);

        let url = '/reports/profit?';

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
            if (includeInProgress) url += `${url.endsWith('?') ? '' : '&'}include_in_progress=true`;
            const data = await fetchApi(url);
            setProfitReport(data);
        } catch (error: any) {
            toast.error(error.message);
        } finally {
            setIsLoadingProfit(false);
        }
    };

    return (
        <main className=" mx-auto p-4 sm:p-6 lg:p-8">
            <h1 className="text-3xl font-bold text-gray-800 mb-6">Отчеты</h1>

            <div className="grid grid-cols-1  gap-6">
                <div className="lg:col-span-2 space-y-6">
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
                                <div className="flex items-center gap-2">
                                    <label className="inline-flex items-center text-sm">
                                        <input type="checkbox" className="mr-2" checked={includeInProgress} onChange={e => setIncludeInProgress(e.target.checked)} />
                                        Включать сметы "В работе"
                                    </label>
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
                            <div className="p-4">
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
                                                <th className="p-2 text-center">Детали</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y">
                                            {profitReport.items.map(item => (
                                                <React.Fragment key={item.estimate_id}>
                                                    <tr className="hover:bg-gray-50">
                                                        <td className="p-2">{item.estimate_number}</td>
                                                        <td className="p-2">{item.client_name}</td>
                                                        <td className="p-2 text-right">{item.total_retail.toFixed(2)} ₽</td>
                                                        <td className="p-2 text-right text-gray-600">{item.total_purchase.toFixed(2)} ₽</td>
                                                        <td className="p-2 text-right font-bold text-green-700">{item.profit.toFixed(2)} ₽</td>
                                                        <td className="p-2 text-right">{item.margin.toFixed(1)}%</td>
                                                        <td className="p-2 text-center">
                                                            <button className="p-1 rounded hover:bg-gray-100" onClick={async () => {
                                                                const el = document.getElementById(`details-${item.estimate_id}`);
                                                                if (el) el.classList.toggle('hidden');
                                                                // fetch details lazily
                                                                if (!detailsCache[item.estimate_id] && !detailsLoading[item.estimate_id]) {
                                                                    await fetchDetails(item.estimate_id);
                                                                }
                                                            }} title="Показать детали"><Plus size={14} /></button>
                                                        </td>
                                                    </tr>
                                                    <tr id={`details-${item.estimate_id}`} className="bg-gray-50 hidden">
                                                        <td colSpan={7} className="p-4">
                                                            <div className="text-sm text-gray-700">
                                                                {detailsLoading[item.estimate_id] ? (
                                                                    <div>Загрузка позиций...</div>
                                                                ) : detailsError[item.estimate_id] ? (
                                                                    <div className="text-red-600">Ошибка: {detailsError[item.estimate_id]}</div>
                                                                ) : detailsCache[item.estimate_id] ? (
                                                                    (() => {
                                                                        const detail = detailsCache[item.estimate_id]!;
                                                                        return (
                                                                            <div>
                                                                                <div className="mb-3 font-medium">Подробный отчет по смете {item.estimate_number}</div>
                                                                                <div className="overflow-x-auto">
                                                                                    <table className="min-w-full text-sm">
                                                                                        <thead className="bg-white border-b">
                                                                                            <tr>
                                                                                                <th className="p-2 text-left">Товар</th>
                                                                                                <th className="p-2 text-left">Ед.</th>
                                                                                                <th className="p-2 text-right">Кол-во</th>
                                                                                                <th className="p-2 text-right">Цена ед.</th>
                                                                                                <th className="p-2 text-right">Итого (розн.)</th>
                                                                                                <th className="p-2 text-right">Себестоимость ед.</th>
                                                                                                <th className="p-2 text-right">Итого (закуп)</th>
                                                                                                <th className="p-2 text-right">Разница</th>
                                                                                            </tr>
                                                                                        </thead>
                                                                                        <tbody className="divide-y">
                                                                                            {detail.items.map((d, idx) => (
                                                                                                <tr key={idx} className="bg-white">
                                                                                                    <td className="p-2">{d.product_name}</td>
                                                                                                    <td className="p-2">{d.unit || 'шт.'}</td>
                                                                                                    <td className="p-2 text-right">{Number(d.quantity).toFixed(2)}</td>
                                                                                                    <td className="p-2 text-right">{Number(d.unit_price || 0).toFixed(2)} ₽</td>
                                                                                                    <td className="p-2 text-right">{Number(d.total_retail || 0).toFixed(2)} ₽</td>
                                                                                                    <td className="p-2 text-right">{d.purchase_price != null ? Number(d.purchase_price).toFixed(2) + ' ₽' : '—'}</td>
                                                                                                    <td className="p-2 text-right">{Number(d.total_purchase || 0).toFixed(2)} ₽</td>
                                                                                                    <td className="p-2 text-right">{Number(d.difference || 0).toFixed(2)} ₽</td>
                                                                                                </tr>
                                                                                            ))}
                                                                                        </tbody>
                                                                                        <tfoot className="bg-gray-50 font-semibold border-t">
                                                                                            <tr>
                                                                                                <td className="p-2" colSpan={4}>Итого по смете:</td>
                                                                                                <td className="p-2 text-right">{Number(detail.total_retail).toFixed(2)} ₽</td>
                                                                                                <td className="p-2" />
                                                                                                <td className="p-2 text-right">{Number(detail.total_purchase).toFixed(2)} ₽</td>
                                                                                                <td className="p-2 text-right">{Number(detail.total_profit).toFixed(2)} ₽</td>
                                                                                            </tr>
                                                                                        </tfoot>
                                                                                    </table>
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    })()
                                                                ) : (
                                                                    <div className="text-gray-600">Пустой отчёт по позициям.</div>
                                                                )}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                </React.Fragment>
                                            ))}
                                        </tbody>
                                        <tfoot className="bg-gray-100 font-bold border-t-2">
                                            <tr>
                                                <td className="p-2" colSpan={2}>ИТОГО:</td>
                                                <td className="p-2 text-right">{profitReport.grand_total_retail.toFixed(2)} ₽</td>
                                                <td className="p-2 text-right">{profitReport.grand_total_purchase.toFixed(2)} ₽</td>
                                                <td className="p-2 text-right text-green-800">{profitReport.grand_total_profit.toFixed(2)} ₽</td>
                                                <td className="p-2 text-right">{profitReport.average_margin.toFixed(1)}%</td>
                                                <td />
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            </div>
                        )}
                        {!profitReport && !isLoadingProfit && <p className="p-4 text-center text-gray-500">Выберите фильтр и нажмите "Сформировать".</p>}
                    </div>
                </div>

                <div className="hidden lg:block">
                    {/* Right column intentionally empty for cleaner report view */}
                </div>
            </div>
        </main>
    );
}