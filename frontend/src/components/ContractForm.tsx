// frontend/src/components/ContractForm.tsx
'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Download, Trash2 } from 'lucide-react';

// Описываем полную модель договора
interface Contract {
    id: number;
    contract_number: string;
    contract_date: string;
    client_name: string;
    location: string;
    passport_series_number: string | null;
    passport_issued_by: string | null;
    passport_issue_date: string | null;
    passport_dep_code: string | null;
    passport_address: string | null;
    estimated_depth: number | null;
    price_per_meter_soil: number | null;
    price_per_meter_rock: number | null;
    actual_depth_soil: number | null;
    actual_depth_rock: number | null;
    pipe_steel_used: number | null;
    pipe_plastic_used: number | null;
    status: string;
}

interface ContractFormProps {
    contractId?: string; // ID будет строкой из URL
}

export default function ContractForm({ contractId }: ContractFormProps) {
    const router = useRouter();
    const API_URL = 'http://127.0.0.1:8000';
    
    const [contract, setContract] = useState<Partial<Contract>>({});
    const [isLoading, setIsLoading] = useState(true);
    const isCreating = !contractId;

    useEffect(() => {
        if (isCreating) {
            setIsLoading(false);
            return;
        }
        const fetchContract = async () => {
            const response = await fetch(`${API_URL}/contracts/${contractId}`);
            const data = await response.json();
            setContract(data);
            setIsLoading(false);
        };
        fetchContract();
    }, [contractId, isCreating]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setContract({ ...contract, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const url = isCreating ? `${API_URL}/contracts/` : `${API_URL}/contracts/${contractId}`;
        const method = isCreating ? 'POST' : 'PATCH';

        try {
            const response = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(contract),
            });
            if (!response.ok) throw new Error('Ошибка сохранения договора');
            router.push('/contracts');
        } catch (error) {
            alert(`Ошибка: ${error}`);
        }
    };

    const handleWriteOffPipes = async () => {
        if (!confirm('Вы уверены, что хотите списать трубы по этому договору?')) return;
        try {
            const response = await fetch(`${API_URL}/contracts/${contractId}/write-off-pipes`, { method: 'POST' });
            const result = await response.json();
            if (!response.ok) throw new Error(result.detail || 'Ошибка списания');
            alert(`Успешно списано: ${result.details.join(', ')}`);
        } catch (error) {
            alert(`Ошибка: ${error}`);
        }
    };

    const handleDownloadDocx = async () => {
        window.open(`${API_URL}/contracts/${contractId}/generate-docx`, '_blank');
    };

    if (isLoading) return <div className="p-8">Загрузка...</div>;

    return (
        <main className="container mx-auto p-4 sm:p-6 lg:p-8">
            <button onClick={() => router.back()} className="flex items-center gap-2 mb-6 text-blue-600 hover:underline">
                <ArrowLeft size={18} />
                Назад к списку
            </button>
            <form onSubmit={handleSubmit}>
                <div className="bg-white p-6 rounded-lg shadow-md">
                    <h1 className="text-2xl font-bold mb-4">{isCreating ? 'Новый договор' : `Редактирование договора №${contract.contract_number}`}</h1>
                    {/* --- Поля формы --- */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        <input name="contract_number" value={contract.contract_number || ''} onChange={handleChange} placeholder="Номер договора" className="border p-2 rounded"/>
                        <input name="client_name" value={contract.client_name || ''} onChange={handleChange} placeholder="Имя клиента" className="border p-2 rounded"/>
                        <input name="location" value={contract.location || ''} onChange={handleChange} placeholder="Адрес объекта" className="border p-2 rounded"/>
                        {/* ... Добавьте остальные поля по аналогии ... */}
                        <input type="number" name="pipe_steel_used" value={contract.pipe_steel_used || ''} onChange={handleChange} placeholder="Исп. стальной трубы, м" className="border p-2 rounded"/>
                        <input type="number" name="pipe_plastic_used" value={contract.pipe_plastic_used || ''} onChange={handleChange} placeholder="Исп. пласт. трубы, м" className="border p-2 rounded"/>
                    </div>
                    
                    {/* --- Кнопки действий --- */}
                    <div className="flex justify-between items-center mt-6 pt-4 border-t">
                        <div>
                            {!isCreating && (
                                <div className="flex space-x-2">
                                    <button type="button" onClick={handleWriteOffPipes} className="px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600">Списать трубы</button>
                                    <button type="button" onClick={handleDownloadDocx} className="px-4 py-2 bg-teal-500 text-white rounded hover:bg-teal-600">Скачать .docx</button>
                                </div>
                            )}
                        </div>
                        <button type="submit" className="px-6 py-2 bg-blue-600 text-white font-semibold rounded hover:bg-blue-700">Сохранить</button>
                    </div>
                </div>
            </form>
        </main>
    );
}