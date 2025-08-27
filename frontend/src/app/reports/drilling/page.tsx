'use client';

import { useState, useEffect } from 'react';
import { fetchApi } from '@/lib/api';
import toast from 'react-hot-toast';

export default function DrillingReportsPage(){
    const [items, setItems] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [startDate, setStartDate] = useState(new Date(new Date().setDate(new Date().getDate()-30)).toISOString().split('T')[0]);
    const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);

    useEffect(()=>{
        const fetch = async ()=>{
            setIsLoading(true);
            try{
                const url = `/reports/drilling-profit?start_date=${startDate}&end_date=${endDate}`;
                const data = await fetchApi(url);
                setItems(data.items || []);
            }catch(e:any){ toast.error(e.message); }
            finally{ setIsLoading(false); }
        };
        fetch();
    }, [startDate, endDate]);

    return (
        <main className="container mx-auto p-4">
            <h1 className="text-2xl font-bold mb-4">Отчет по прибыли (бурение)</h1>
            <div className="mb-4 flex gap-2">
                <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} className="p-1 border rounded" />
                <input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} className="p-1 border rounded" />
            </div>

            {isLoading ? <p>Загрузка...</p> : (
                <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 border-b-2">
                        <tr>
                            <th className="p-2 text-left">Договор</th>
                            <th className="p-2 text-left">Клиент</th>
                            <th className="p-2 text-right">Выручка бурение</th>
                            <th className="p-2 text-right">Стоимость труб (закуп)</th>
                            <th className="p-2 text-right">Стоимость труб (розн.)</th>
                            <th className="p-2 text-right">Прибыль</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map(it=> (
                            <tr key={it.contract_id}>
                                <td className="p-2">{it.contract_number}</td>
                                <td className="p-2">{it.client_name}</td>
                                <td className="p-2 text-right">{it.drilling_retail.toFixed(2)} ₽</td>
                                <td className="p-2 text-right">{it.pipe_purchase.toFixed(2)} ₽</td>
                                <td className="p-2 text-right">{it.pipe_retail.toFixed(2)} ₽</td>
                                <td className="p-2 text-right font-bold text-green-700">{it.profit.toFixed(2)} ₽</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </main>
    );
}
