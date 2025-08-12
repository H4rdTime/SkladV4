// frontend/src/app/layout.tsx
'use client';

import { Inter } from "next/font/google";
import "./globals.css";
import Link from 'next/link';
import { Toaster, toast } from 'react-hot-toast'; // Импортируем Toaster и toast
import { Warehouse, Users, FileText, BookUser, Trash2, History, PackageCheck } from 'lucide-react';

const inter = Inter({ subsets: ["latin"] });

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const API_URL = 'http://127.0.0.1:8000';

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
        setTimeout(() => window.location.reload(), 1500); // Небольшая задержка перед перезагрузкой
      } catch (err: any) {
        toast.error(`Ошибка: ${err.message}`, { id: toastId });
      }
    }
  };

  return (
    <html lang="ru">
      <head>
        <title>Система Учета "Склад v4"</title>
      </head>
      <body className={`${inter.className} bg-gray-50`}>
        {/* Контейнер для всплывающих уведомлений */}
        <Toaster position="bottom-right" toastOptions={{ duration: 5000 }} />

        <div className="flex h-screen">
          <aside className="w-64 bg-white shadow-md flex flex-col">
            <div className="p-4 border-b">
              <h1 className="text-2xl font-bold text-blue-600">Склад v4</h1>
            </div>
            <nav className="flex-grow p-4 space-y-2">
              <Link href="/" className="flex items-center gap-3 px-3 py-2 text-gray-700 rounded-md hover:bg-gray-100 transition-colors">
                <Warehouse size={20} />
                <span>Склад</span>
              </Link>
              <Link href="/workers" className="flex items-center gap-3 px-3 py-2 text-gray-700 rounded-md hover:bg-gray-100 transition-colors">
                <Users size={20} />
                <span>Работники</span>
              </Link>
              <Link href="/estimates" className="flex items-center gap-3 px-3 py-2 text-gray-700 rounded-md hover:bg-gray-100 transition-colors">
                <FileText size={20} />
                <span>Сметы</span>
              </Link>
              <Link href="/contracts" className="flex items-center gap-3 px-3 py-2 text-gray-700 rounded-md hover:bg-gray-100 transition-colors">
                <BookUser size={20} />
                <span>Договоры</span>
              </Link>
              <Link href="/history" className="flex items-center gap-3 px-3 py-2 text-gray-700 rounded-md hover:bg-gray-100 transition-colors">
                <History size={20} />
                <span>История</span>
              </Link>
              <Link href="/worker-stock" className="flex items-center gap-3 px-3 py-2 text-gray-700 rounded-md hover:bg-gray-100 transition-colors">
                <PackageCheck size={20} />
                <span>На руках</span>
              </Link>
            </nav>
            <div className="p-4 border-t">
              <button
                onClick={handleClearData}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-red-600 bg-red-50 rounded-md hover:bg-red-100 hover:text-red-800 transition-colors"
              >
                <Trash2 size={16} />
                <span>Очистить БД</span>
              </button>
            </div>
          </aside>

          <div className="flex-1 overflow-y-auto">
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}