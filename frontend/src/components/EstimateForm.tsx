// frontend/src/components/EstimateForm.tsx
'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { ArrowLeft, Plus, Trash2, Truck } from 'lucide-react';
import Modal from '@/components/Modal';

// Типы данных
interface Product {
  id: number;
  name: string;
  retail_price: number;
  stock_quantity: number;
}
interface EstimateItem {
  product_id: number;
  product_name: string;
  quantity: number;
  unit_price: number;
}
interface Worker {
  id: number;
  name: string;
}

// Тип для пропсов компонента
interface EstimateFormProps {
  estimateId?: string;
}

export default function EstimateForm({ estimateId }: EstimateFormProps) {
  const router = useRouter();
  const API_URL = 'http://127.0.0.1:8000';
  const isCreating = !estimateId;

  // Состояния для данных сметы
  const [estimateNumber, setEstimateNumber] = useState('');
  const [clientName, setClientName] = useState('');
  const [location, setLocation] = useState('');
  const [items, setItems] = useState<EstimateItem[]>([]);
  const [status, setStatus] = useState('');
  
  // Состояния для поиска товаров
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  
  // Состояния для отгрузки
  const [isShipModalOpen, setIsShipModalOpen] = useState(false);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [selectedWorkerId, setSelectedWorkerId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(!isCreating);


  useEffect(() => {
    if (isCreating) {
        setIsLoading(false); // Для новой сметы не нужно ничего загружать
        return;
    }
    
    const fetchEstimate = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(`${API_URL}/estimates/${estimateId}`);
        const data = await response.json();
        setEstimateNumber(data.estimate_number);
        setClientName(data.client_name);
        setLocation(data.location || '');
        setStatus(data.status);
        setItems(data.items.map((item: any) => ({
          product_id: item.product_id,
          product_name: item.product_name,
          quantity: item.quantity,
          unit_price: item.unit_price,
        })));
      } catch (error) {
        toast.error('Не удалось загрузить данные сметы.');
        router.push('/estimates');
      } finally {
        setIsLoading(false);
      }
    };
    fetchEstimate();
  }, [estimateId, isCreating, router]);

  useEffect(() => {
    if (searchTerm.length < 2) {
      setSearchResults([]);
      return;
    }
    const fetchProducts = async () => {
      const response = await fetch(`${API_URL}/products/?search=${searchTerm}`);
      const data: Product[] = await response.json();
      setSearchResults(data);
    };
    const debounce = setTimeout(() => fetchProducts(), 300);
    return () => clearTimeout(debounce);
  }, [searchTerm]);
  
  const addItem = (product: Product) => {
    if (items.find(item => item.product_id === product.id)) {
      toast.error("Этот товар уже есть в смете.");
      return;
    }
    setItems([...items, { product_id: product.id, product_name: product.name, quantity: 1, unit_price: product.retail_price }]);
    setSearchTerm('');
    setSearchResults([]);
  };
  
  const updateItemQuantity = (productId: number, newQuantity: number) => {
    setItems(items.map(item => item.product_id === productId ? { ...item, quantity: newQuantity > 0 ? newQuantity : 1 } : item));
  };
  
  const updateItemPrice = (productId: number, newPrice: number) => {
    setItems(items.map(item => 
        item.product_id === productId ? { ...item, unit_price: newPrice >= 0 ? newPrice : 0 } : item
    ));
  };

  const removeItem = (productId: number) => {
    setItems(items.filter(item => item.product_id !== productId));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (items.length === 0) {
        toast.error("Добавьте хотя бы один товар в смету.");
        return;
    }
    const toastId = toast.loading(isCreating ? 'Создание сметы...' : 'Сохранение изменений...');
    const estimateData = {
      estimate_number: estimateNumber,
      client_name: clientName,
      location: location,
      items: items.map(({ product_id, quantity, unit_price }) => ({ product_id, quantity, unit_price })),
    };
    const url = isCreating ? `${API_URL}/estimates/` : `${API_URL}/estimates/${estimateId}`;
    const method = isCreating ? 'POST' : 'PATCH';
    try {
      const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(estimateData) });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Ошибка сохранения');
      }
      toast.success(isCreating ? 'Смета создана!' : 'Смета обновлена!', { id: toastId });
      router.push('/estimates');
    } catch (error: any) {
      toast.error(`Ошибка: ${error.message}`, { id: toastId });
    }
  };
  
  const openShipModal = async () => {
    try {
      const response = await fetch(`${API_URL}/workers/`);
      const data = await response.json();
      setWorkers(data);
      if (data.length > 0) {
        setSelectedWorkerId(String(data[0].id));
        setIsShipModalOpen(true);
      } else {
        toast.error('В системе нет работников.');
      }
    } catch (error) { toast.error('Не удалось загрузить работников.'); }
  };
  
  const handleShipEstimate = async () => {
    if (!selectedWorkerId) {
      toast.error('Пожалуйста, выберите работника.');
      return;
    }
    const toastId = toast.loading('Выполняется отгрузка...');
    try {
      const response = await fetch(`${API_URL}/estimates/${estimateId}/ship?worker_id=${selectedWorkerId}`, { method: 'POST' });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Ошибка отгрузки');
      }
      const result = await response.json();
      toast.success(result.message || 'Смета успешно отгружена!', { id: toastId });
      setIsShipModalOpen(false);
      router.push('/estimates'); 
    } catch (err: any) {
      toast.error(`Ошибка: ${err.message}`, { id: toastId });
    }
  };

  const totalSum = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);

  if (isLoading) return <div className="p-8 text-center">Загрузка...</div>;

  return (
    <main className="container mx-auto p-4 sm:p-6 lg:p-8">
      <button onClick={() => router.back()} className="flex items-center gap-2 mb-6 text-blue-600 hover:underline">
        <ArrowLeft size={18} />
        Назад к списку смет
      </button>

      <form onSubmit={handleSubmit}>
        <div className="bg-white p-6 rounded-lg shadow-md mb-6">
          <h1 className="text-3xl font-bold text-gray-800 mb-4">{isCreating ? 'Новая смета' : `Смета №${estimateNumber}`}</h1>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <input type="text" placeholder="Номер сметы" required value={estimateNumber} onChange={e => setEstimateNumber(e.target.value)} className="border p-2 rounded-md"/>
            <input type="text" placeholder="Имя клиента" required value={clientName} onChange={e => setClientName(e.target.value)} className="border p-2 rounded-md"/>
            <input type="text" placeholder="Адрес объекта" value={location} onChange={e => setLocation(e.target.value)} className="border p-2 rounded-md"/>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-md">
          <h2 className="text-xl font-semibold mb-4 text-gray-700">Состав сметы</h2>
          <div className="relative mb-4">
            <input type="text" placeholder="Поиск и добавление товара..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full border p-2 rounded-md"/>
            {searchResults.length > 0 && (
              <ul className="absolute z-10 w-full bg-white border rounded-md mt-1 max-h-60 overflow-y-auto shadow-lg">
                {searchResults.map(product => (
                  <li key={product.id} onClick={() => addItem(product)} className="p-2 hover:bg-gray-100 cursor-pointer">
                    {product.name} <span className="text-gray-500 text-sm">(Остаток: {product.stock_quantity})</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
                <tr>
                    <th className="py-2 px-3 text-left">Наименование</th>
                    <th className="py-2 px-3 text-center w-24">Кол-во</th>
                    <th className="py-2 px-3 text-right w-32">Цена</th>
                    <th className="py-2 px-3 text-right">Сумма</th>
                    <th className="py-2 px-3 text-center w-16"></th>
                </tr>
            </thead>
            <tbody className="divide-y">
              {items.map(item => (
                <tr key={item.product_id}>
                  <td className="py-2 px-3">{item.product_name}</td>
                  <td className="py-2 px-3"><input type="number" value={item.quantity} onChange={e => updateItemQuantity(item.product_id, Number(e.target.value))} className="w-20 border rounded-md p-1 text-right" /></td>
                  <td className="py-2 px-3 text-right">
                    <input 
                        type="number" 
                        step="0.01"
                        value={item.unit_price} 
                        onChange={e => updateItemPrice(item.product_id, Number(e.target.value))} 
                        className="w-24 border rounded-md p-1 text-right" 
                    />
                  </td>
                  <td className="py-2 px-3 text-right font-semibold">{(item.quantity * item.unit_price).toFixed(2)} ₽</td>
                  <td className="py-2 px-3 text-center"><button type="button" onClick={() => removeItem(item.product_id)} className="p-1 text-red-500 hover:text-red-700"><Trash2 size={16}/></button></td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex justify-between items-center mt-6 pt-4 border-t">
            <div>
              {!isCreating && status !== 'В работе' && status !== 'Выполнена' && (
                <button type="button" onClick={openShipModal} className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-md hover:bg-orange-600">
                  <Truck size={18}/> Отгрузить
                </button>
              )}
            </div>
            <div className="flex items-center">
              <div className="text-right mr-4">
                <p className="text-gray-600">Итого:</p>
                <p className="text-2xl font-bold text-gray-900">{totalSum.toFixed(2)} ₽</p>
              </div>
              <button type="submit" className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-md hover:bg-blue-700">
                {isCreating ? 'Создать смету' : 'Сохранить изменения'}
              </button>
            </div>
          </div>
        </div>
      </form>
      
      <Modal isOpen={isShipModalOpen} onClose={() => setIsShipModalOpen(false)} title="Отгрузка сметы">
        <div className="space-y-4">
          <p>Выберите работника для отгрузки:</p>
          <select value={selectedWorkerId} onChange={(e) => setSelectedWorkerId(e.target.value)} className="w-full p-2 border rounded-md bg-white">
            {workers.map(worker => <option key={worker.id} value={worker.id}>{worker.name}</option>)}
          </select>
          <div className="flex justify-end pt-4">
            <button type="button" onClick={() => setIsShipModalOpen(false)} className="px-4 py-2 bg-gray-200 rounded-md mr-2">Отмена</button>
            <button type="button" onClick={handleShipEstimate} className="px-4 py-2 bg-blue-500 text-white rounded-md">Подтвердить</button>
          </div>
        </div>
      </Modal>
    </main>
  );
}