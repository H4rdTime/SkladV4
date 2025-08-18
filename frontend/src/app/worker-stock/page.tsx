// frontend/src/app/worker-stock/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { fetchApi } from '@/lib/api';
import toast from 'react-hot-toast';

interface Worker {
  id: number;
  name: string;
}
interface StockItem {
  product_id: number;
  product_name: string;
  quantity_on_hand: number;
  unit: string;
}

export default function WorkerStockPage() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [selectedWorkerId, setSelectedWorkerId] = useState<string>('');
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // API_URL больше не нужен, используем fetchApi

  useEffect(() => {
    const fetchWorkers = async () => {
      try {
        const data: Worker[] = await fetchApi('/workers/');
        setWorkers(data);
        if (data.length > 0) {
          setSelectedWorkerId(String(data[0].id));
        }
      } catch (error) {
        toast.error('Не удалось загрузить работников');
      }
    };
    fetchWorkers();
  }, []);

  const fetchStockForWorker = async (workerId: string) => {
    if (!workerId) {
      setStockItems([]);
      return;
    }
    setIsLoading(true);
    try {
      const data = await fetchApi(`/actions/worker-stock/${workerId}`);
      setStockItems(data);
    } catch (error) {
      toast.error('Не удалось загрузить товары работника');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStockForWorker(selectedWorkerId);
  }, [selectedWorkerId]);

  const performReturn = async (item: StockItem, quantity: number) => {
    const toastId = toast.loading('Выполняется возврат...');
    try {
      await fetchApi('/actions/return-item/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: item.product_id,
          worker_id: Number(selectedWorkerId),
          quantity: quantity
        }),
      });
      toast.success('Товар успешно возвращен.', { id: toastId });
      fetchStockForWorker(selectedWorkerId);
    } catch (error: any) {
        toast.error(`Ошибка: ${error.message}`, { id: toastId });
    }
  };

  const handleReturnPartial = (item: StockItem) => {
    const quantityToReturn = prompt(`Сколько "${item.product_name}" вернуть на склад?\nНа руках: ${item.quantity_on_hand}`, String(item.quantity_on_hand));
    if (quantityToReturn === null) return;
    
    const quantity = parseFloat(quantityToReturn);
    if (isNaN(quantity) || quantity <= 0 || quantity > item.quantity_on_hand) {
      toast.error('Неверное количество для возврата.');
      return;
    }
    performReturn(item, quantity);
  };

  const handleReturnAll = (item: StockItem) => {
    if (confirm(`Вернуть все ${item.quantity_on_hand} ${item.unit} товара "${item.product_name}" на склад?`)) {
      performReturn(item, item.quantity_on_hand);
    }
  };

  const handleWriteOff = async (item: StockItem) => {
    const quantityToWriteOff = prompt(`Сколько "${item.product_name}" СПИСАТЬ (было использовано)?\nНа руках: ${item.quantity_on_hand}`, String(item.quantity_on_hand));
    if (quantityToWriteOff === null) return;
    
    const quantity = parseFloat(quantityToWriteOff);
    if (isNaN(quantity) || quantity <= 0 || quantity > item.quantity_on_hand) {
      toast.error('Неверное количество для списания.');
      return;
    }

    const toastId = toast.loading('Выполнение списания...');
    try {
      await fetchApi('/actions/write-off-item/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: item.product_id,
          worker_id: Number(selectedWorkerId),
          quantity: quantity
        }),
      });
      toast.success('Товар успешно списан.', { id: toastId });
      fetchStockForWorker(selectedWorkerId);
    } catch (error: any) {
      toast.error(`Ошибка: ${error.message}`, { id: toastId });
    }
  };
  // ...existing code...

  return (
    <main className="container mx-auto p-4 sm:p-6 lg:p-8">
      <h1 className="text-3xl font-bold text-gray-800 mb-6">Товары на руках у монтажников</h1>

      <div className="mb-4">
        <label htmlFor="worker-select" className="block text-sm font-medium text-gray-700 mb-1">Выберите работника:</label>
        <select
          id="worker-select"
          value={selectedWorkerId}
          onChange={e => setSelectedWorkerId(e.target.value)}
          className="block w-full md:w-1/3 p-2 border bg-white rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
                <thead className="bg-gray-100 border-b-2 border-gray-200">
                    <tr>
                    <th className="py-3 px-4 text-left font-semibold text-gray-600 uppercase tracking-wider">Наименование</th>
                    <th className="py-3 px-4 text-right font-semibold text-gray-600 uppercase tracking-wider">На руках</th>
                    <th className="py-3 px-4 text-center font-semibold text-gray-600 uppercase tracking-wider">Действия</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                    {isLoading ? (
                    <tr><td colSpan={3} className="text-center py-10 text-gray-500">Загрузка...</td></tr>
                    ) : stockItems.length === 0 ? (
                    <tr><td colSpan={3} className="text-center py-10 text-gray-500">У этого работника нет товаров.</td></tr>
                    ) : (
                    stockItems.map(item => (
                        <tr key={item.product_id} className="hover:bg-gray-50 transition-colors">
                            <td className="py-3 px-4 font-medium text-gray-900">{item.product_name}</td>
                            <td className="py-3 px-4 text-right font-bold text-gray-800">{item.quantity_on_hand} {item.unit}</td>
                            <td className="py-3 px-4 text-center">
                                <div className="flex justify-center items-center space-x-2">
                                    <button onClick={() => handleWriteOff(item)} className="px-3 py-1 bg-green-500 text-white rounded-md text-xs hover:bg-green-600 font-semibold">
                                        Списать
                                    </button>
                                    <button onClick={() => handleReturnAll(item)} className="px-3 py-1 bg-blue-500 text-white rounded-md text-xs hover:bg-blue-600">
                                        Вернуть всё
                                    </button>
                                    <button onClick={() => handleReturnPartial(item)} className="text-gray-500 hover:underline text-xs">
                                        Вернуть часть
                                    </button>
                                </div>
                            </td>
                        </tr>
                    ))
                    )}
                </tbody>
            </table>
        </div>
      </div>
    </main>
  );
}