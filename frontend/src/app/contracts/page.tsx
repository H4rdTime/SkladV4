// frontend/src/app/contracts/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { Plus, Eye } from 'lucide-react';
import Link from 'next/link';

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

  const API_URL = 'http://127.0.0.1:8000';

  useEffect(() => {
    const fetchContracts = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(`${API_URL}/contracts/`);
        if (!response.ok) throw new Error('Ошибка загрузки договоров');
        setContracts(await response.json());
      } catch (error) {
        console.error(error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchContracts();
  }, []);

  const formatDate = (dateString: string) => new Date(dateString).toLocaleDateString('ru-RU');

  return (
    <main className="container mx-auto p-4 sm:p-6 lg:p-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-800">Договоры на бурение</h1>
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