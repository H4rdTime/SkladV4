// frontend/src/components/ContractForm.tsx
'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { ArrowLeft, Download, Edit, Save } from 'lucide-react';

// Полный интерфейс договора
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
    contract_type: string;
}

interface ContractFormProps {
    contractId?: string;
}

// Вспомогательный компонент для красивого отображения данных
const ViewField = ({ label, value }: { label: string, value: any }) => (
    <div>
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">{label}</p>
        <p className="text-base text-gray-900">{value || '—'}</p>
    </div>
);

export default function ContractForm({ contractId }: ContractFormProps) {
    const router = useRouter();
    const API_URL = 'https://sklad-petrovich-api.onrender.com';

    const [formData, setFormData] = useState<Partial<Contract>>({ status: 'В работе' });
    const [isLoading, setIsLoading] = useState(!!contractId);
    const [isEditing, setIsEditing] = useState(!contractId);
    const isCreating = !contractId;

    const fetchContract = async () => {
        if (isCreating) return;
        setIsLoading(true);
        try {
            const response = await fetch(`${API_URL}/contracts/${contractId}`);
            if (!response.ok) throw new Error("Не удалось загрузить договор");
            const data = await response.json();
            setFormData(data);
            if (data.status === 'Завершен') setIsEditing(false); // Если завершен, сразу открываем в режиме просмотра
        } catch (error: any) {
            toast.error(error.message);
            router.push('/contracts');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchContract();
    }, [contractId]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value === '' ? null : value }));
    };

    const handleSave = async () => {
        const toastId = toast.loading('Сохранение...');
        const url = isCreating ? `${API_URL}/contracts/` : `${API_URL}/contracts/${contractId}`;
        const method = isCreating ? 'POST' : 'PATCH';

        try {
            const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formData) });
            if (!response.ok) throw new Error((await response.json()).detail || 'Ошибка сохранения');
            const savedContract = await response.json();
            toast.success('Договор успешно сохранен!', { id: toastId });
            if (isCreating) {
                router.push(`/contracts/${savedContract.id}`); // Переходим на страницу редактирования нового договора
            } else {
                setFormData(savedContract); // Обновляем данные на странице
                setIsEditing(false); // Выходим из режима редактирования
            }
        } catch (error: any) {
            toast.error(`Ошибка: ${error.message}`, { id: toastId });
        }
    };

    const handleWriteOffPipes = async () => {
        if (!formData.pipe_steel_used && !formData.pipe_plastic_used) {
            toast.error("Укажите количество использованных труб для списания.");
            return;
        }
        if (!confirm('Списать трубы и завершить договор? Это действие изменит остатки на складе и статус договора.')) return;

        const toastId = toast.loading('Списание и завершение...');
        try {
            await fetch(`${API_URL}/contracts/${contractId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formData) });
            const response = await fetch(`${API_URL}/contracts/${contractId}/write-off-pipes`, { method: 'POST' });
            if (!response.ok) throw new Error((await response.json()).detail || 'Ошибка списания');
            const updatedContract = await response.json();
            toast.success('Трубы списаны, договор завершен!', { id: toastId, duration: 4000 });
            setFormData(updatedContract);
            setIsEditing(false);
        } catch (error: any) {
            toast.error(`Ошибка: ${error.message}`, { id: toastId });
        }
    };

    const handleReopen = async () => {
        if (!confirm('Вернуть договор в работу? Это позволит редактировать данные. Списание труб НЕ будет отменено.')) return;
        const toastId = toast.loading('Возврат в работу...');
        try {
            const response = await fetch(`${API_URL}/contracts/${contractId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'В работе' }) });
            if (!response.ok) throw new Error((await response.json()).detail);
            const updatedContract = await response.json();
            toast.success('Договор снова в работе.', { id: toastId });
            setFormData(updatedContract);
            setIsEditing(true);
        } catch (error: any) {
            toast.error(`Ошибка: ${error.message}`, { id: toastId });
        }
    };

    const handleDownloadDocx = async () => {
        const toastId = toast.loading('Генерация документа...');
        try {
            const response = await fetch(`${API_URL}/contracts/${contractId}/generate-docx`);
            if (!response.ok) throw new Error((await response.json()).detail || 'Ошибка генерации файла');
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Contract_${formData.contract_number || contractId}.docx`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
            toast.success('Документ готов!', { id: toastId });
        } catch (error: any) {
            toast.error(`Ошибка: ${error.message}`, { id: toastId });
        }
    };

    if (isLoading) return <div className="p-8 text-center">Загрузка...</div>;

    return (
        <main className="container mx-auto p-4 sm:p-6 lg:p-8">
            <button onClick={() => router.push('/contracts')} className="flex items-center gap-2 mb-6 text-blue-600 hover:underline">
                <ArrowLeft size={18} />
                Назад к списку договоров
            </button>

            {isEditing ? (
                // --- РЕЖИМ РЕДАКТИРОВАНИЯ ---
                <form onSubmit={(e) => { e.preventDefault(); handleSave(); }}>
                    <div className="bg-white p-6 rounded-lg shadow-md">
                        <h1 className="text-2xl font-bold mb-6">{isCreating ? 'Новый договор' : `Редактирование договора №${formData.contract_number}`}</h1>

                        <fieldset className="border p-4 rounded-md mb-6">
                            <legend className="px-2 font-semibold">Основные данные</legend>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                                <input
                                    name="contract_number"
                                    value={formData.contract_number || ''}
                                    onChange={handleChange}
                                    placeholder="Номер договора"
                                    required
                                    className="border p-2 rounded-md"
                                />
                                <div>
                                    <select
                                        name="contract_type"
                                        value={formData.contract_type || 'Бурение скважины'}
                                        onChange={handleChange}
                                        className="w-full border p-2 rounded-md bg-white h-full"
                                    >
                                        <option>Бурение скважины</option>
                                        <option>Монтаж насосного оборудования</option>
                                    </select>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 gap-4">
                                <input
                                    name="client_name"
                                    value={formData.client_name || ''}
                                    onChange={handleChange}
                                    placeholder="Имя клиента"
                                    required
                                    className="border p-2 rounded-md"
                                />
                                <input
                                    name="location"
                                    value={formData.location || ''}
                                    onChange={handleChange}
                                    placeholder="Адрес объекта"
                                    required
                                    className="border p-2 rounded-md"
                                />
                            </div>
                        </fieldset>

                        <fieldset className="border p-4 rounded-md mb-6">
                            <legend className="px-2 font-semibold">Паспортные данные</legend>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <input name="passport_series_number" value={formData.passport_series_number || ''} onChange={handleChange} placeholder="Серия и номер" className="border p-2 rounded-md" />
                                <input name="passport_dep_code" value={formData.passport_dep_code || ''} onChange={handleChange} placeholder="Код подразделения" className="border p-2 rounded-md" />
                                <input name="passport_issue_date" value={formData.passport_issue_date || ''} onChange={handleChange} placeholder="Дата выдачи" className="border p-2 rounded-md" />
                                <div className="md:col-span-3">
                                    <input name="passport_issued_by" value={formData.passport_issued_by || ''} onChange={handleChange} placeholder="Кем выдан" className="border p-2 rounded-md w-full" />
                                </div>
                                <div className="md:col-span-3">
                                    <input name="passport_address" value={formData.passport_address || ''} onChange={handleChange} placeholder="Адрес регистрации" className="border p-2 rounded-md w-full" />
                                </div>
                            </div>
                        </fieldset>

                        <fieldset className="border p-4 rounded-md mb-6">
                            <legend className="px-2 font-semibold">Параметры бурения</legend>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <input type="number" step="0.1" name="estimated_depth" value={formData.estimated_depth ?? ''} onChange={handleChange} placeholder="План. глубина, м" className="border p-2 rounded-md" />
                                <input type="number" step="0.01" name="price_per_meter_soil" value={formData.price_per_meter_soil ?? ''} onChange={handleChange} placeholder="Цена (до скалы)" className="border p-2 rounded-md" />
                                <input type="number" step="0.01" name="price_per_meter_rock" value={formData.price_per_meter_rock ?? ''} onChange={handleChange} placeholder="Цена (по скале)" className="border p-2 rounded-md" />
                                <div></div>
                                <input type="number" step="0.1" name="actual_depth_soil" value={formData.actual_depth_soil ?? ''} onChange={handleChange} placeholder="Факт (до скалы), м" className="border p-2 rounded-md" />
                                <input type="number" step="0.1" name="actual_depth_rock" value={formData.actual_depth_rock ?? ''} onChange={handleChange} placeholder="Факт (по скале), м" className="border p-2 rounded-md" />
                                <input type="number" step="0.1" name="pipe_steel_used" value={formData.pipe_steel_used ?? ''} onChange={handleChange} placeholder="Исп. сталь, м" className="border p-2 rounded-md" />
                                <input type="number" step="0.1" name="pipe_plastic_used" value={formData.pipe_plastic_used ?? ''} onChange={handleChange} placeholder="Исп. пластик, м" className="border p-2 rounded-md" />
                            </div>
                        </fieldset>

                        <div className="flex justify-between items-center mt-6 pt-4 border-t">
                            <button type="button" onClick={() => isCreating ? router.push('/contracts') : setIsEditing(false)} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300">Отмена</button>
                            <div className="flex items-center space-x-2">
                                {!isCreating && <button type="button" onClick={handleWriteOffPipes} className="px-4 py-2 bg-orange-500 text-white rounded-md hover:bg-orange-600">Списать и Завершить</button>}
                                <button type="submit" className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-md hover:bg-blue-700 flex items-center gap-2"><Save size={18} /> {isCreating ? 'Создать' : 'Сохранить'}</button>
                            </div>
                        </div>
                    </div>
                </form>
            ) : (
                // --- РЕЖИМ ПРОСМОТРА ---
                <div className="bg-white p-6 rounded-lg shadow-md">
                    <div className="flex justify-between items-start mb-6 pb-4 border-b">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-800">Договор №{formData.contract_number}</h1>
                            {formData.contract_type && (
                                <p className="text-sm text-blue-600 font-semibold mt-1">{formData.contract_type}</p>
                            )}
                            <p className="text-gray-500 mt-1">Статус: <span className="font-semibold text-green-600">{formData.status}</span></p>
                        </div>
                        <div className="flex space-x-2">
                            <button onClick={() => setIsEditing(true)} className="p-2 bg-gray-200 rounded-md hover:bg-gray-300" title="Редактировать"><Edit size={18} /></button>
                            <button onClick={handleDownloadDocx} className="p-2 bg-teal-500 text-white rounded-md hover:bg-teal-600" title="Скачать .docx"><Download size={18} /></button>
                        </div>
                    </div>
                    <div className="space-y-6">
                        <div>
                            <h3 className="font-semibold text-lg mb-2">Основные данные</h3>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <ViewField label="Клиент" value={formData.client_name} />
                                <ViewField label="Объект" value={formData.location} />
                                <ViewField label="Дата договора" value={new Date(formData.contract_date || '').toLocaleDateString('ru-RU')} />
                            </div>
                        </div>
                        <div>
                            <h3 className="font-semibold text-lg mb-2">Фактические результаты</h3>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <ViewField label="Исп. сталь, м" value={formData.pipe_steel_used} />
                                <ViewField label="Исп. пластик, м" value={formData.pipe_plastic_used} />
                                <ViewField label="Факт (до скалы), м" value={formData.actual_depth_soil} />
                                <ViewField label="Факт (по скале), м" value={formData.actual_depth_rock} />
                            </div>
                        </div>
                        <div>
                            <h3 className="font-semibold text-lg mb-2">Паспортные данные</h3>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                <ViewField label="Серия и номер" value={formData.passport_series_number} />
                                <ViewField label="Код" value={formData.passport_dep_code} />
                                <ViewField label="Дата выдачи" value={formData.passport_issue_date} />
                                <div className="md:col-span-3">
                                    <ViewField label="Кем выдан" value={formData.passport_issued_by} />
                                </div>
                                <div className="md:col-span-3">
                                    <ViewField label="Адрес регистрации" value={formData.passport_address} />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
}