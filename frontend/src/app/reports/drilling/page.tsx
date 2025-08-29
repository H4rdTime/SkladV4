// src/app/reports/drilling/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { fetchApi } from '@/lib/api'; // Убедитесь, что путь к вашей функции fetchApi верный
import toast from 'react-hot-toast';
import { format } from 'date-fns'; // Для удобного форматирования дат

// Определяем типы для данных из API для лучшей читаемости и безопасности
interface DrillingReportItem {
    contract_id: number;
    contract_number: string;
    client_name: string;
    drilling_retail: number;
    pipe_purchase: number;
    pipe_retail: number;
    profit: number;
}

interface DrillingReportData {
    items: DrillingReportItem[];
    grand_total_profit: number;
}

export default function DrillingReportsPage() {
    // Используем типизированное состояние для большей надежности
    const [reportData, setReportData] = useState<DrillingReportData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    
    // Устанавливаем даты по умолчанию
    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);

    const [startDate, setStartDate] = useState(format(thirtyDaysAgo, 'yyyy-MM-dd'));
    const [endDate, setEndDate] = useState(format(today, 'yyyy-MM-dd'));

    useEffect(() => {
        const fetchReport = async () => {
            setIsLoading(true);
            try {
                // Формируем URL с параметрами дат
                const url = `/reports/drilling-profit?start_date=${startDate}&end_date=${endDate}`;
                const data: DrillingReportData = await fetchApi(url);
                setReportData(data); // Сохраняем все данные, включая grand_total_profit
            } catch (e: any) {
                toast.error(e.message || 'Не удалось загрузить отчет');
                setReportData(null); // Сбрасываем данные в случае ошибки
            } finally {
                setIsLoading(false);
            }
        };

        // Запускаем загрузку только если даты корректны
        if (startDate && endDate) {
            fetchReport();
        }
    }, [startDate, endDate]);

    return (
        <main className="container mx-auto p-4">
            <div className="flex justify-between items-center mb-4">
                <h1 className="text-2xl font-bold">Отчет по прибыли (бурение)</h1>
                <div className="flex items-center gap-4">
                    <input 
                        type="date" 
                        value={startDate} 
                        onChange={e => setStartDate(e.target.value)} 
                        className="p-2 border rounded-md shadow-sm" 
                    />
                    <span className="text-gray-500">-</span>
                    <input 
                        type="date" 
                        value={endDate} 
                        onChange={e => setEndDate(e.target.value)} 
                        className="p-2 border rounded-md shadow-sm" 
                    />
                </div>
            </div>

            {isLoading ? <p className="text-center mt-8">Загрузка данных...</p> : (
                reportData && (
                    <>
                        <div className="overflow-x-auto bg-white rounded-lg shadow">
                            <table className="min-w-full text-sm">
                                <thead className="bg-gray-100 border-b-2 border-gray-200">
                                    <tr>
                                        <th className="p-3 text-left font-semibold text-gray-600">Договор</th>
                                        <th className="p-3 text-left font-semibold text-gray-600">Клиент</th>
                                        <th className="p-3 text-right font-semibold text-gray-600">Выручка бурение</th>
                                        <th className="p-3 text-right font-semibold text-gray-600">Стоимость труб (закуп)</th>
                                        <th className="p-3 text-right font-semibold text-gray-600">Стоимость труб (розн.)</th>
                                        <th className="p-3 text-right font-semibold text-gray-600">Прибыль</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {reportData.items.map((item) => (
                                        <tr key={item.contract_id} className="border-b border-gray-200 hover:bg-gray-50">
                                            <td className="p-3">{item.contract_number}</td>
                                            <td className="p-3">{item.client_name}</td>
                                            <td className="p-3 text-right">{item.drilling_retail.toLocaleString('ru-RU')} ₽</td>
                                            <td className="p-3 text-right">{item.pipe_purchase.toLocaleString('ru-RU')} ₽</td>
                                            <td className="p-3 text-right">{item.pipe_retail.toLocaleString('ru-RU')} ₽</td>
                                            <td className="p-3 text-right font-bold text-green-700">{item.profit.toLocaleString('ru-RU')} ₽</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        
                        {/* --- ОТОБРАЖЕНИЕ ИТОГОВОЙ ПРИБЫЛИ --- */}
                        <div className="mt-6 flex justify-end">
                             <div className="bg-gray-800 text-white p-4 rounded-lg shadow-lg">
                                 <span className="text-lg font-semibold">Общая прибыль за период: </span>
                                 <span className="text-xl font-bold ml-2">
                                     {reportData.grand_total_profit.toLocaleString('ru-RU', { style: 'currency', currency: 'RUB' })}
                                 </span>
                             </div>
                        </div>
                    </>
                )
            )}
            {!isLoading && !reportData?.items.length && (
                 <p className="text-center mt-8 text-gray-500">Нет данных за выбранный период.</p>
            )}
        </main>
    );
}