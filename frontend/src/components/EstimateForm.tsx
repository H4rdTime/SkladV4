// frontend/src/components/EstimateForm.tsx
'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { ArrowLeft, Plus, Trash2, Truck, CheckCircle } from 'lucide-react';
import Modal from '@/components/Modal';

// Типы данных
interface Product { id: number; name: string; retail_price: number; stock_quantity: number; }
interface EstimateItem { product_id: number; product_name: string; quantity: number; unit_price: number; }
interface Worker { id: number; name: string; }
interface EstimateFormProps { estimateId?: string; }

export default function EstimateForm({ estimateId }: EstimateFormProps) {
  const router = useRouter();
  const API_URL = 'http://127.0.0.1:8000';
  const isCreating = !estimateId;

  // Состояния
  const [estimateData, setEstimateData] = useState({ number: '', client: '', location: '' });
  const [items, setItems] = useState<EstimateItem[]>([]);
  const [status, setStatus] = useState('Черновик');
  const [isLoading, setIsLoading] = useState(!isCreating);

  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<Product[]>([]);

  const [isShipModalOpen, setIsShipModalOpen] = useState(false);
  const [isAddItemsModalOpen, setIsAddItemsModalOpen] = useState(false);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [selectedWorkerId, setSelectedWorkerId] = useState<string>('');
  const [itemsToAdd, setItemsToAdd] = useState<EstimateItem[]>([]);

  const fetchEstimate = async () => {
    if (isCreating) { setIsLoading(false); return; }
    setIsLoading(true);
    try {
      const response = await fetch(`${API_URL}/estimates/${estimateId}`);
      if (!response.ok) throw new Error('Не удалось загрузить смету');
      const data = await response.json();
      setEstimateData({ number: data.estimate_number, client: data.client_name, location: data.location || '' });
      setStatus(data.status);
      setItems(data.items.map((item: any) => ({ product_id: item.product_id, product_name: item.product_name, quantity: item.quantity, unit_price: item.unit_price })));
    } catch (error: any) {
      toast.error(error.message);
      router.push('/estimates');
    } finally {
      setIsLoading(false);
    }
  };
  useEffect(() => { fetchEstimate(); }, [estimateId]);

  useEffect(() => {
    if (searchTerm.length < 2) { setSearchResults([]); return; }
    const fetchProducts = async () => {
      const response = await fetch(`${API_URL}/products/?search=${searchTerm}`);
      setSearchResults(await response.json());
    };
    const debounce = setTimeout(() => fetchProducts(), 300);
    return () => clearTimeout(debounce);
  }, [searchTerm]);

  const addItem = (product: Product) => {
    if (items.find(item => item.product_id === product.id)) { toast.error("Этот товар уже есть в смете."); return; }
    setItems([...items, { product_id: product.id, product_name: product.name, quantity: 1, unit_price: product.retail_price }]);
    setSearchTerm(''); setSearchResults([]);
  };
  const updateItemQuantity = (productId: number, newQuantity: number) => setItems(items.map(item => item.product_id === productId ? { ...item, quantity: newQuantity > 0 ? newQuantity : 1 } : item));
  const updateItemPrice = (productId: number, newPrice: number) => setItems(items.map(item => item.product_id === productId ? { ...item, unit_price: newPrice >= 0 ? newPrice : 0 } : item));
  const removeItem = (productId: number) => setItems(items.filter(item => item.product_id !== productId));

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (items.length === 0 && isCreating) { toast.error("Добавьте товары в смету."); return; }
    const toastId = toast.loading('Сохранение...');
    const payload = {
      estimate_number: estimateData.number,
      client_name: estimateData.client,
      location: estimateData.location,
      items: items.map(({ product_id, quantity, unit_price }) => ({ product_id, quantity, unit_price })),
    };
    const url = isCreating ? `${API_URL}/estimates/` : `${API_URL}/estimates/${estimateId}`;
    const method = isCreating ? 'POST' : 'PATCH';
    try {
      const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error((await response.json()).detail || 'Ошибка сохранения');
      toast.success(isCreating ? 'Смета создана!' : 'Смета обновлена!', { id: toastId });
      if (isCreating) router.push('/estimates'); else fetchEstimate();
    } catch (error: any) { toast.error(`Ошибка: ${error.message}`, { id: toastId }); }
  };

  const openShipModal = async () => {
    try {
      const response = await fetch(`${API_URL}/workers/`);
      const data = await response.json();
      setWorkers(data);
      if (data.length > 0) { setSelectedWorkerId(String(data[0].id)); setIsShipModalOpen(true); }
      else { toast.error('Сначала добавьте работников.'); }
    } catch (error) { toast.error('Не удалось загрузить работников.'); }
  };

  const handleShipEstimate = async () => {
    const toastId = toast.loading('Выполняется отгрузка...');
    try {
      const response = await fetch(`${API_URL}/estimates/${estimateId}/ship?worker_id=${selectedWorkerId}`, { method: 'POST' });
      if (!response.ok) throw new Error((await response.json()).detail || 'Ошибка отгрузки');
      toast.success('Смета успешно отгружена!', { id: toastId });
      setIsShipModalOpen(false);
      fetchEstimate();
    } catch (err: any) { toast.error(`Ошибка: ${err.message}`, { id: toastId }); }
  };

  const handleComplete = async () => {
    if (!confirm('Завершить смету? Будет произведено финальное списание.')) return;
    const toastId = toast.loading('Завершение сметы...');
    try {
      const response = await fetch(`${API_URL}/estimates/${estimateId}/complete`, { method: 'POST' });
      if (!response.ok) throw new Error((await response.json()).detail);
      toast.success('Смета успешно завершена!', { id: toastId });
      fetchEstimate();
    } catch (err: any) { toast.error(`Ошибка: ${err.message}`, { id: toastId }); }
  };

  const openAddItemsModal = () => { setItemsToAdd([]); setSearchTerm(''); setSearchResults([]); setIsAddItemsModalOpen(true); };
  const addItemToAdditionList = (product: Product) => {
    if (items.find(i => i.product_id === product.id) || itemsToAdd.find(i => i.product_id === product.id)) { toast.error("Товар уже есть в списке."); return; }
    setItemsToAdd([...itemsToAdd, { product_id: product.id, product_name: product.name, quantity: 1, unit_price: product.retail_price }]);
    setSearchTerm(''); setSearchResults([]);
  };
  const updateQuantityForAddition = (productId: number, newQuantity: number) => setItemsToAdd(itemsToAdd.map(item => item.product_id === productId ? { ...item, quantity: newQuantity > 0 ? newQuantity : 1 } : item));
  const removeItemFromAdditionList = (productId: number) => setItemsToAdd(itemsToAdd.filter(item => item.product_id !== productId));
  const handleIssueAdditional = async () => {
    if (itemsToAdd.length === 0) { toast.error("Добавьте товары для довыдачи."); return; }
    const toastId = toast.loading('Выполняется довыдача...');
    const payload = { items: itemsToAdd.map(({ product_id, quantity }) => ({ product_id, quantity })) };
    try {
      const response = await fetch(`${API_URL}/estimates/${estimateId}/issue-additional`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error((await response.json()).detail || 'Ошибка довыдачи');
      toast.success('Товары успешно довыданы!', { id: toastId });
      setIsAddItemsModalOpen(false);
      fetchEstimate();
    } catch (err: any) { toast.error(`Ошибка: ${err.message}`, { id: toastId }); }
  };

  const totalSum = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
  const isEditable = status === 'Черновик' || status === 'Утверждена';

  if (isLoading) return <div className="p-8 text-center">Загрузка...</div>;

  const handleStatusChange = async (newStatus: string) => {
    const toastId = toast.loading('Смена статуса...');
    try {
      const response = await fetch(`${API_URL}/estimates/${estimateId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!response.ok) throw new Error("Не удалось сменить статус");
      toast.success("Статус обновлен!", { id: toastId });
      fetchEstimate(); // Перезагружаем данные, чтобы увидеть кнопки
    } catch (error: any) {
      toast.error(`Ошибка: ${error.message}`, { id: toastId });
    }
  };

  return (
    <main className="container mx-auto p-4 sm:p-6 lg:p-8">
      <button onClick={() => router.back()} className="flex items-center gap-2 mb-6 text-blue-600 hover:underline">
        <ArrowLeft size={18} /> Назад к списку
      </button>

      <form onSubmit={handleSubmit}>
        <div className="bg-white p-6 rounded-lg shadow-md mb-6">
          <div className="flex justify-between items-center">
            <h1 className="text-3xl ...">Смета №...</h1>
            {/* --- НОВЫЙ БЛОК СТАТУСА --- */}
            {!isCreating && (
              <div>
                <label>Статус: </label>
                <select
                  value={status}
                  onChange={e => handleStatusChange(e.target.value)}
                  className="p-1 border rounded-md bg-white"
                >
                  <option>Черновик</option>
                  <option>Утверждена</option>
                  <option>В работе</option>
                  <option>Выполнена</option>
                  <option>Отменена</option>
                </select>
              </div>
            )}
          </div>
          <h1 className="text-3xl font-bold text-gray-800 mb-4">{isCreating ? 'Новая смета' : `Смета №${estimateData.number}`}</h1>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <input type="text" placeholder="Номер сметы" required value={estimateData.number} onChange={e => setEstimateData({ ...estimateData, number: e.target.value })} disabled={!isEditable} className="border p-2 rounded-md disabled:bg-gray-100" />
            <input type="text" placeholder="Имя клиента" required value={estimateData.client} onChange={e => setEstimateData({ ...estimateData, client: e.target.value })} disabled={!isEditable} className="border p-2 rounded-md disabled:bg-gray-100" />
            <input type="text" placeholder="Адрес объекта" value={estimateData.location} onChange={e => setEstimateData({ ...estimateData, location: e.target.value })} disabled={!isEditable} className="border p-2 rounded-md disabled:bg-gray-100" />
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-md">
          <h2 className="text-xl font-semibold mb-4 text-gray-700">Состав сметы</h2>
          {isEditable && (
            <div className="relative mb-4">
              <input type="text" placeholder="Поиск и добавление товара..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full border p-2 rounded-md" />
              {searchResults.length > 0 && (
                <ul className="absolute z-10 w-full bg-white border rounded-md mt-1 max-h-60 overflow-y-auto shadow-lg">
                  {searchResults.map(product => <li key={product.id} onClick={() => addItem(product)} className="p-2 hover:bg-gray-100 cursor-pointer">{product.name} <span className="text-gray-500 text-sm">(Остаток: {product.stock_quantity})</span></li>)}
                </ul>
              )}
            </div>
          )}
          <div className="overflow-x-auto">
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
                    <td className="py-2 px-3"><input type="number" value={item.quantity} onChange={e => updateItemQuantity(item.product_id, Number(e.target.value))} disabled={!isEditable} className="w-20 border rounded-md p-1 text-right disabled:bg-gray-100" /></td>
                    <td className="py-2 px-3 text-right"><input type="number" step="0.01" value={item.unit_price} onChange={e => updateItemPrice(item.product_id, Number(e.target.value))} disabled={!isEditable} className="w-24 border rounded-md p-1 text-right disabled:bg-gray-100" /></td>
                    <td className="py-2 px-3 text-right font-semibold">{(item.quantity * item.unit_price).toFixed(2)} ₽</td>
                    <td className="py-2 px-3 text-center">{isEditable && (<button type="button" onClick={() => removeItem(item.product_id)} className="p-1 text-red-500 hover:text-red-700"><Trash2 size={16} /></button>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between items-center mt-6 pt-4 border-t">
            <div className="flex space-x-2">
              {status === 'Утверждена' && <button type="button" onClick={openShipModal} className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-md hover:bg-orange-600"><Truck size={18} /> Отгрузить</button>}
              {status === 'В работе' && <button type="button" onClick={openAddItemsModal} className="flex items-center gap-2 px-4 py-2 bg-cyan-500 text-white rounded-md hover:bg-cyan-600"><Plus size={18} /> Довыдать товар</button>}
              {status === 'В работе' && <button type="button" onClick={handleComplete} className="flex items-center gap-2 px-4 py-2 bg-teal-500 text-white rounded-md hover:bg-teal-600"><CheckCircle size={18} /> Завершить смету</button>}
            </div>
            <div className="flex items-center">
              <div className="text-right mr-4">
                <p className="text-gray-600">Итого:</p>
                <p className="text-2xl font-bold text-gray-900">{totalSum.toFixed(2)} ₽</p>
              </div>
              {isEditable && <button type="submit" className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-md hover:bg-blue-700">Сохранить изменения</button>}
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

      <Modal isOpen={isAddItemsModalOpen} onClose={() => setIsAddItemsModalOpen(false)} title="Довыдача товаров">
        <div className="space-y-4">
          <div className="relative">
            <input type="text" placeholder="Поиск товара для добавления..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full border p-2 rounded-md" />
            {searchResults.length > 0 && (
              <ul className="absolute z-20 w-full bg-white border rounded-md mt-1 max-h-40 overflow-y-auto shadow-lg">
                {searchResults.map(product => (<li key={product.id} onClick={() => addItemToAdditionList(product)} className="p-2 hover:bg-gray-100 cursor-pointer">{product.name}</li>))}
              </ul>
            )}
          </div>
          {itemsToAdd.length > 0 ? (
            <div className="max-h-60 overflow-y-auto border rounded-md">
              <table className="w-full text-sm">
                <tbody className="divide-y">
                  {itemsToAdd.map(item => (
                    <tr key={item.product_id}>
                      <td className="p-2">{item.product_name}</td>
                      <td className="p-2 w-24"><input type="number" value={item.quantity} onChange={e => updateQuantityForAddition(item.product_id, Number(e.target.value))} className="w-full border rounded-md p-1 text-right" /></td>
                      <td className="p-2 w-10 text-center"><button type="button" onClick={() => removeItemFromAdditionList(item.product_id)}><Trash2 size={16} className="text-red-500" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-center text-gray-500 py-4">Товары для довыдачи не добавлены.</p>}
          <div className="flex justify-end pt-4 border-t mt-4">
            <button type="button" onClick={() => setIsAddItemsModalOpen(false)} className="px-4 py-2 bg-gray-200 rounded-md mr-2">Отмена</button>
            <button type="button" onClick={handleIssueAdditional} className="px-4 py-2 bg-blue-500 text-white rounded-md">Подтвердить и выдать</button>
          </div>
        </div>
      </Modal>
    </main>
  );
}