// src/app/reports/page.tsx

import Link from 'next/link';
import { LineChart, Hammer } from 'lucide-react';

export default function ReportsIndexPage() {
    return (
        <main className="container mx-auto p-4 sm:p-6 lg:p-8">
            <h1 className="text-3xl font-bold text-gray-800 mb-6">Отчеты</h1>
            <p className="mb-8 text-gray-600">Выберите отчет для просмотра:</p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Ссылка на отчет по сметам */}
                <Link href="/reports/profit" className="block p-6 bg-white rounded-lg shadow-md hover:shadow-xl transition-shadow">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-blue-100 rounded-full">
                            <LineChart className="h-6 w-6 text-blue-600" />
                        </div>
                        <div>
                            <h2 className="text-xl font-semibold text-gray-800">Прибыль по сметам</h2>
                            <p className="text-gray-500 mt-1">Анализ рентабельности по выполненным сметам.</p>
                        </div>
                    </div>
                </Link>

                {/* Ссылка на отчет по бурению */}
                <Link href="/reports/drilling" className="block p-6 bg-white rounded-lg shadow-md hover:shadow-xl transition-shadow">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-green-100 rounded-full">
                            <Hammer className="h-6 w-6 text-green-600" />
                        </div>
                        <div>
                            <h2 className="text-xl font-semibold text-gray-800">Прибыль по бурению</h2>
                            <p className="text-gray-500 mt-1">Анализ рентабельности по договорам на бурение.</p>
                        </div>
                    </div>
                </Link>

            </div>
        </main>
    );
}