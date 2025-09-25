// frontend/src/components/EstimateForm.tsx
'use client';

import { useState, useEffect, FormEvent } from 'react';
import { fetchApi } from '@/lib/api';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
// --- 1. ДОБАВЛЯЕМ ИКОНКИ FileText и Star ---
import { ArrowLeft, Plus, Trash2, Truck, CheckCircle, Star } from 'lucide-react';
import Modal from '@/components/Modal';

// Типы данных
interface Product { id: number; name: string; retail_price: number; stock_quantity: number; is_favorite: boolean; }
interface EstimateItem { id?: number; product_id: number; product_name: string; quantity: number; unit_price: number; }
interface Worker { id: number; name: string; }
interface EstimateFormProps { estimateId?: string; }

export default function EstimateForm({ estimateId }: EstimateFormProps) {
  const router = useRouter();
  // API_URL больше не нужен, используем fetchApi
  const isCreating = !estimateId;
  const [currentEstimateId, setCurrentEstimateId] = useState<string | undefined>(estimateId);

  // Состояния
  const [estimateData, setEstimateData] = useState({ number: '', client: '', location: '' });
  const [items, setItems] = useState<EstimateItem[]>([]);
  const [status, setStatus] = useState('Черновик');
  const [isLoading, setIsLoading] = useState(!isCreating);

  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  const [isShipModalOpen, setIsShipModalOpen] = useState(false);
  const [isShipAction, setIsShipAction] = useState(false);
  const [isAddItemsModalOpen, setIsAddItemsModalOpen] = useState(false);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [selectedWorkerId, setSelectedWorkerId] = useState<string>('');
  const [itemsToAdd, setItemsToAdd] = useState<EstimateItem[]>([]);

  const fetchEstimate = async () => {
    if (isCreating && !currentEstimateId) { setIsLoading(false); return; }
    setIsLoading(true);
    try {
      const idToFetch = currentEstimateId || estimateId;
      const data = await fetchApi(`/estimates/${idToFetch}`);
      setEstimateData({ number: data.estimate_number, client: data.client_name, location: data.location || '' });
      setStatus(data.status);
  setItems(data.items.map((item: any) => ({ id: item.id, product_id: item.product_id, product_name: item.product_name, quantity: item.quantity, unit_price: item.unit_price })));
    } catch (error: any) {
      toast.error(error.message);
      router.push('/estimates');
    } finally {
      setIsLoading(false);
    }
  };
  useEffect(() => { fetchEstimate(); }, [estimateId, currentEstimateId]);

  useEffect(() => {
    const fetchProducts = async () => {
      const data = await fetchApi(`/products/?search=${searchTerm}&size=20`);
      setSearchResults(data.items || []);
    };
    if (isSearchFocused || searchTerm.length > 0) {
      const debounce = setTimeout(() => fetchProducts(), 300);
      return () => clearTimeout(debounce);
    } else {
      setSearchResults([]);
    }
  }, [searchTerm, isSearchFocused]);

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
    try {
      if (isCreating) {
        const created = await fetchApi('/estimates/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        toast.success('Смета создана!', { id: toastId });
        // stay on page and use created id so user can immediately ship
        setCurrentEstimateId(String(created.id));
        setStatus(created.status);
        // replace url to the created estimate id (if route exists)
        try { router.replace(`/estimates/${created.id}`); } catch (_) {}
      } else {
        const idToUse = currentEstimateId || estimateId;
        await fetchApi(`/estimates/${idToUse}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        toast.success('Смета обновлена!', { id: toastId });
        fetchEstimate();
      }
    } catch (error: any) {
      toast.error(`Ошибка: ${error.message}`, { id: toastId });
    }
  };

  // --- 2. ДОБАВЛЕНА ФУНКЦИЯ-ОБРАБОТЧИК ---
  // Removed commercial proposal generation per UX request
  // --- КОНЕЦ НОВОЙ ФУНКЦИИ ---

  const openShipModal = async () => {
    try {
      // Всегда открываем модал для реальной отгрузки (списание со склада).
      const workersData = await fetchApi(`/workers/`);
      setWorkers(workersData);
      setIsShipAction(true);
      if (workersData.length > 0) { setSelectedWorkerId(String(workersData[0].id)); setIsShipModalOpen(true); }
      else { toast.error('Сначала добавьте работников.'); }
    } catch (error) { toast.error('Не удалось загрузить работников.'); }
  };

  // Create estimate then open ship modal (for creating -> ship in one flow)
  const handleCreateAndOpenShip = async () => {
    if (items.length === 0) { toast.error('Добавьте товары в смету.'); return; }
    const toastId = toast.loading('Сохранение черновика...');
    const payload = {
      estimate_number: estimateData.number,
      client_name: estimateData.client,
      location: estimateData.location,
      items: items.map(({ product_id, quantity, unit_price }) => ({ product_id, quantity, unit_price })),
    };
    try {
      const created = await fetchApi('/estimates/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      toast.success('Смета создана как черновик.', { id: toastId });
      // persist created id and open ship modal for selection
      setCurrentEstimateId(String(created.id));
      setIsShipAction(true);
      const workersData = await fetchApi(`/workers/`);
      setWorkers(workersData);
      if (workersData.length > 0) { setSelectedWorkerId(String(workersData[0].id)); setIsShipModalOpen(true); }
      else { toast.error('Сначала добавьте работников.'); }
      // update local state
      setStatus(created.status);
      // don't navigate away, allow user to finish ship flow
    } catch (error: any) {
      toast.error(`Ошибка: ${error.message}`, { id: toastId });
    }
  };

  // ...existing code...

  const handleShipEstimate = async () => {
    const idToUse = currentEstimateId || estimateId;
    if (!idToUse) { toast.error('Смета не сохранена. Сначала сохраните смету.'); return; }
    const toastId = toast.loading('Выполняется отгрузка...');
    try {
      await fetchApi(`/estimates/${idToUse}/ship?worker_id=${selectedWorkerId}`, { method: 'POST' });
      toast.success('Смета успешно отгружена!', { id: toastId });
      setIsShipModalOpen(false);
      // refresh from server
      setCurrentEstimateId(String(idToUse));
      fetchEstimate();
    } catch (err: any) { toast.error(`Ошибка: ${err.message}`, { id: toastId }); }
  };

  const handleAssignWorker = async () => {
    const idToUse = currentEstimateId || estimateId;
    const toastId = toast.loading('Привязка работника...');
    try {
      await fetchApi(`/estimates/${idToUse}/assign-worker?worker_id=${selectedWorkerId}`, { method: 'POST' });
      toast.success('Работник привязан к смете.', { id: toastId });
      setIsShipModalOpen(false);
      fetchEstimate();
    } catch (err: any) { toast.error(`Ошибка: ${err.message}`, { id: toastId }); }
  };

  const handleComplete = async () => {
    if (!confirm('Завершить смету? Будет произведено финальное списание.')) return;
    const toastId = toast.loading('Завершение сметы...');
    try {
      const idToUse = currentEstimateId || estimateId;
      await fetchApi(`/estimates/${idToUse}/complete`, { method: 'POST' });
      toast.success('Смета успешно завершена!', { id: toastId });
      fetchEstimate();
    } catch (err: any) { toast.error(`Ошибка: ${err.message}`, { id: toastId }); }
  };

  const handleCancelCompletion = async () => {
    if (!confirm('Отменить завершение сметы и вернуть списанные товары на склад?')) return;
    const toastId = toast.loading('Отмена завершения...');
    try {
      const idToUse = currentEstimateId || estimateId;
      await fetchApi(`/estimates/${idToUse}/cancel-completion`, { method: 'POST' });
      toast.success('Завершение сметы отменено. Остатки восстановлены.', { id: toastId });
      fetchEstimate();
    } catch (err: any) { toast.error(`Ошибка: ${err.message}`, { id: toastId }); }
  };

  const handleCancelInProgress = async () => {
    if (!confirm('Отменить смету и вернуть товары на склад?')) return;
    const toastId = toast.loading('Отмена сметы...');
    try {
      const idToUse = currentEstimateId || estimateId;
      await fetchApi(`/estimates/${idToUse}/cancel`, { method: 'POST' });
      toast.success('Смета отменена и товары возвращены на склад.', { id: toastId });
      fetchEstimate();
    } catch (err: any) { toast.error(`Ошибка: ${err.message}`, { id: toastId }); }
  };

  const handleReopenCancelled = async () => {
    // Reopen requires selecting a worker to re-issue goods; reuse ship modal flow
    if (!confirm('Вернуть отменённую смету в работу и отдать товары работнику? Выберите работника на следующем шаге.')) return;
    try {
      const workersData = await fetchApi(`/workers/`);
      setWorkers(workersData);
      if (workersData.length > 0) {
        setSelectedWorkerId(String(workersData[0].id));
        // open ship modal but set a special flag to indicate reopen
        setIsShipAction(false);
        setIsShipModalOpen(true);
      } else {
        toast.error('Сначала добавьте работника.');
      }
    } catch (err) { toast.error('Не удалось загрузить работников.'); }
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
    const payload = { items: itemsToAdd.map(({ product_id, quantity, unit_price }) => ({ product_id, quantity, unit_price })) };
    try {
  const idToUse = currentEstimateId || estimateId;
  await fetchApi(`/estimates/${idToUse}/issue-additional`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      toast.success('Товары успешно довыданы!', { id: toastId });
      setIsAddItemsModalOpen(false);
      fetchEstimate();
    } catch (err: any) { toast.error(`Ошибка: ${err.message}`, { id: toastId }); }
  };

  const totalSum = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
  const isQuantityEditable = status === 'Черновик';
  const isPriceEditable = status === 'Черновик' || status === 'В работе';

  const persistItemPrice = async (item: EstimateItem) => {
    // Only persist for existing items (have id) and when estimate exists on server
    const idToUse = currentEstimateId || estimateId;
    if (!item.id || !idToUse) return;
    const toastId = toast.loading('Сохраняю цену...');
    try {
      // PATCH /estimates/{estimate_id}/items/{item_id}?unit_price=...
      await fetchApi(`/estimates/${idToUse}/items/${item.id}?unit_price=${encodeURIComponent(item.unit_price)}`, { method: 'PATCH' });
      toast.success('Цена позиции сохранена', { id: toastId });
      fetchEstimate();
    } catch (err: any) {
      toast.error(`Ошибка при сохранении цены: ${err.message}`, { id: toastId });
    }
  };

  if (isLoading) return <div className="p-8 text-center">Загрузка...</div>;

  const handleStatusChange = async (newStatus: string) => {
    const toastId = toast.loading('Смена статуса...');
    try {
      await fetchApi(`/estimates/${estimateId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      toast.success("Статус обновлен!", { id: toastId });
      fetchEstimate();
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
            <div className="flex justify-between items-center mb-4">
            <h1 className="text-3xl font-bold text-gray-800 mb-4">
              {isCreating ? 'Новая смета' : `Смета №${estimateData.number}`}
              {!isCreating && <span className="ml-4 text-lg font-normal text-gray-400">(ID: {currentEstimateId || estimateId})</span>}
            </h1>
            {!isCreating && (
              <div>
                <label className="text-sm font-medium">Статус: </label>
                <select
                  value={status}
                  onChange={e => handleStatusChange(e.target.value)}
                  className="p-1 border rounded-md bg-white text-sm"
                  disabled={status === 'Выполнена'}
                >
                  <option>Черновик</option>
                  <option>В работе</option>
                  <option>Выполнена</option>
                  <option>Отменена</option>
                </select>
              </div>
            )}
          </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <input type="text" placeholder="Номер сметы" required value={estimateData.number} onChange={e => setEstimateData({ ...estimateData, number: e.target.value })} disabled={!isQuantityEditable} className="border p-2 rounded-md disabled:bg-gray-100" />
            <input type="text" placeholder="Имя клиента" required value={estimateData.client} onChange={e => setEstimateData({ ...estimateData, client: e.target.value })} disabled={!isQuantityEditable} className="border p-2 rounded-md disabled:bg-gray-100" />
            <input type="text" placeholder="Адрес объекта" value={estimateData.location} onChange={e => setEstimateData({ ...estimateData, location: e.target.value })} disabled={!isQuantityEditable} className="border p-2 rounded-md disabled:bg-gray-100" />
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-md">
          <h2 className="text-xl font-semibold mb-4 text-gray-700">Состав сметы</h2>
          {isQuantityEditable && (
            <div className="relative mb-4">
              <input
                type="text"
                placeholder="Кликните для выбора или начните поиск..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                onFocus={() => setIsSearchFocused(true)}
                onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
                className="w-full border p-2 rounded-md"
              />
              {(isSearchFocused || searchResults.length > 0) && (
                <ul className="absolute z-10 w-full bg-white border rounded-md mt-1 max-h-60 overflow-y-auto shadow-lg">
                  {searchResults.length > 0 ? (
                    searchResults.map(product => (
                      <li
                        key={product.id}
                        onMouseDown={() => addItem(product)}
                        className="p-2 hover:bg-gray-100 cursor-pointer flex justify-between items-center"
                      >
                        <span>
                          {product.name}
                          <span className="text-gray-500 text-sm ml-2">(Остаток: {product.stock_quantity})</span>
                        </span>
                        {product.is_favorite && <Star size={14} className="text-yellow-500 fill-yellow-400" />}
                      </li>
                    ))
                  ) : (
                    <li className="p-2 text-gray-500">Загрузка товаров...</li>
                  )}
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
                    <td className="py-2 px-3"><input type="number" value={item.quantity} onChange={e => updateItemQuantity(item.product_id, Number(e.target.value))} disabled={!isQuantityEditable} className="w-20 border rounded-md p-1 text-right disabled:bg-gray-100" /></td>
                    <td className="py-2 px-3 text-right"><input type="number" step="0.01" value={item.unit_price} onChange={e => updateItemPrice(item.product_id, Number(e.target.value))} onBlur={() => persistItemPrice(item)} disabled={!isPriceEditable} className="w-24 border rounded-md p-1 text-right disabled:bg-gray-100" /></td>
                    <td className="py-2 px-3 text-right font-semibold">{(item.quantity * item.unit_price).toFixed(2)} ₽</td>
                    <td className="py-2 px-3 text-center">{isQuantityEditable && (<button type="button" onClick={() => removeItem(item.product_id)} className="p-1 text-red-500 hover:text-red-700"><Trash2 size={16} /></button>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between items-center mt-6 pt-4 border-t">
            <div className="flex flex-wrap gap-2">
              {/* --- 3. ДОБАВЛЕНА НОВАЯ КНОПКА --- */}
              {(isCreating || status === 'Черновик') && (
                <button type="button" onClick={isCreating ? handleCreateAndOpenShip : openShipModal} className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-md hover:bg-orange-600"><Truck size={18} /> Отгрузить</button>
              )}
              {/* Убрана отдельная кнопка "Пометить как отгруженную" — используем единую кнопку Отгрузить */}
              {status === 'В работе' && <button type="button" onClick={openAddItemsModal} className="flex items-center gap-2 px-4 py-2 bg-cyan-500 text-white rounded-md hover:bg-cyan-600"><Plus size={18} /> Довыдать</button>}
              {status === 'В работе' && <button type="button" onClick={handleComplete} className="flex items-center gap-2 px-4 py-2 bg-teal-500 text-white rounded-md hover:bg-teal-600"><CheckCircle size={18} /> Завершить</button>}
              {status === 'В работе' && <button type="button" onClick={handleCancelInProgress} className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"><Trash2 size={18} /> Отменить смету</button>}
              {status === 'Выполнена' && <button type="button" onClick={handleCancelCompletion} className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600"><ArrowLeft size={18} /> Отменить выполнение</button>}
              {status === 'Отменена' && <button type="button" onClick={handleReopenCancelled} className="flex items-center gap-2 px-4 py-2 bg-yellow-500 text-white rounded-md hover:bg-yellow-600"><ArrowLeft size={18} /> Вернуть в работу</button>}
            </div>
            <div className="flex items-center">
              <div className="text-right mr-4">
                <p className="text-gray-600">Итого:</p>
                <p className="text-2xl font-bold text-gray-900">{totalSum.toFixed(2)} ₽</p>
              </div>
              {isQuantityEditable && <button type="submit" className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-md hover:bg-blue-700">Сохранить</button>}
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
            {/* Используем явный флаг isShipAction, основанный на свежих данных с сервера, чтобы
                не полагаться на потенциально устаревший локальный state 'status'. */}
            <button type="button" onClick={isShipAction ? handleShipEstimate : handleAssignWorker} className="px-4 py-2 bg-blue-500 text-white rounded-md">
              {isShipAction ? 'Отгрузить (спишет со склада)' : 'Привязать (без списания)'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={isAddItemsModalOpen} onClose={() => setIsAddItemsModalOpen(false)} title="Довыдача товаров">
        <div className="space-y-4">
          <div className="relative">
            <input
              type="text"
              placeholder="Кликните для выбора или начните поиск..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              onFocus={() => setIsSearchFocused(true)}
              onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
              className="w-full border p-2 rounded-md"
            />
            {(isSearchFocused || searchResults.length > 0) && (
              <ul className="absolute z-20 w-full bg-white border rounded-md mt-1 max-h-40 overflow-y-auto shadow-lg">
                {searchResults.length > 0 ? (
                  searchResults.map(product => (
                    <li
                      key={product.id}
                      onMouseDown={() => addItemToAdditionList(product)}
                      className="p-2 hover:bg-gray-100 cursor-pointer flex justify-between items-center"
                    >
                      <span>{product.name}</span>
                      {product.is_favorite && <Star size={14} className="text-yellow-500 fill-yellow-400" />}
                    </li>
                  ))
                ) : (
                  <li className="p-2 text-gray-500">Загрузка товаров...</li>
                )}
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