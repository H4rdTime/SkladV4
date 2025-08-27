// frontend/src/app/contracts/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { fetchApi } from '@/lib/api';
import { Plus, Eye } from 'lucide-react';
import Link from 'next/link';
import { Search } from 'lucide-react';

interface Contract {
  id: number;
  contract_number: string;
  contract_date: string;
  client_name: string;
  location: string;
  status: string;
}

export default function ContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [sortBy, setSortBy] = useState<'contract_date' | 'contract_number'>('contract_date');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');

  // API_URL больше не нужен, используем fetchApi

  // debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const fetchContracts = async () => {
      setIsLoading(true);
      try {
        const q = new URLSearchParams();
        if (debouncedSearch) q.set('search', debouncedSearch);
        if (sortBy) q.set('sort_by', sortBy);
        if (order) q.set('order', order);
        const suffix = q.toString() ? `?${q.toString()}` : '';
        const data = await fetchApi(`/contracts/${suffix}`);
        setContracts(data);
      } catch (error) {
        console.error(error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchContracts();
  }, [debouncedSearch, sortBy, order]);

  const formatDate = (dateString: string) => new Date(dateString).toLocaleDateString('ru-RU');

  return (
    <main className="container mx-auto p-4 sm:p-6 lg:p-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Договоры на бурение</h1>
          <div className="mt-2 flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск по номеру или клиенту"
                className="pl-10 pr-3 py-2 border rounded-md w-72 text-sm"
              />
            </div>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} className="border p-2 rounded-md text-sm">
              <option value="contract_date">Сортировать: дата</option>
              <option value="contract_number">Сортировать: номер</option>
            </select>
            <select value={order} onChange={(e) => setOrder(e.target.value as any)} className="border p-2 rounded-md text-sm">
              <option value="desc">По убыванию</option>
              <option value="asc">По возрастанию</option>
            </select>
          </div>
        </div>
        <Link href="/contracts/new" className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600">
          <Plus size={18} /> Создать договор
        </Link>
      </div>

      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="py-3 px-4 text-left font-semibold text-gray-600">Номер</th>
              <th className="py-3 px-4 text-left font-semibold text-gray-600">Дата</th>
              <th className="py-3 px-4 text-left font-semibold text-gray-600">Клиент</th>
              <th className="py-3 px-4 text-left font-semibold text-gray-600">Объект</th>
              <th className="py-3 px-4 text-left font-semibold text-gray-600">Статус</th>
              <th className="py-3 px-4 text-center font-semibold text-gray-600">Действия</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {isLoading ? (
              <tr><td colSpan={6} className="text-center py-10">Загрузка...</td></tr>
            ) : (
              contracts.map(contract => (
                <tr key={contract.id} className="hover:bg-gray-50">
                  <td className="py-3 px-4 font-medium">{contract.contract_number}</td>
                  <td className="py-3 px-4 text-gray-500">{formatDate(contract.contract_date)}</td>
                  <td className="py-3 px-4">{contract.client_name}</td>
                  <td className="py-3 px-4 text-gray-600">{contract.location || '—'}</td>
                  <td className="py-3 px-4">
                    <span className="px-2 py-1 text-xs font-semibold text-blue-800 bg-blue-100 rounded-full">
                      {contract.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-center">
                    <Link href={`/contracts/${contract.id}`} className="p-1 text-gray-600 hover:text-blue-600" title="Просмотреть/Редактировать">
                      <Eye size={16} />
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}