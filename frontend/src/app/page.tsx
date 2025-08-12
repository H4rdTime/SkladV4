// frontend/src/app/page.tsx

'use client';

import { useState, useEffect, FormEvent, useRef } from 'react';
import toast from 'react-hot-toast';
import Modal from '@/components/Modal';
import { Plus, RefreshCw, Edit, Trash2, Upload, FileUp, Send } from 'lucide-react';

interface Worker {
  id: number;
  name: string;
}

interface Product {
  id: number;
  internal_sku: string;
  name: string;
  supplier_sku: string | null;
  stock_quantity: number;
  min_stock_level: number;
  unit: string;
  purchase_price: number;
  retail_price: number;
}

export default function WarehousePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [isIssueModalOpen, setIsIssueModalOpen] = useState(false);

  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const [issueProduct, setIssueProduct] = useState<Product | null>(null);
  const [issueQuantity, setIssueQuantity] = useState(1);
  const [issueWorkerId, setIssueWorkerId] = useState('');
  const [workers, setWorkers] = useState<Worker[]>([]);

  const initialLoadInputRef = useRef<HTMLInputElement>(null);
  const supplierImportInputRef = useRef<HTMLInputElement>(null);

  const API_URL = 'http://127.0.0.1:8000';

  const fetchProducts = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/products/`);
      if (!response.ok) throw new Error('Ошибка сети при загрузке товаров');
      const data: Product[] = await response.json();
      setProducts(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  const openCreateModal = () => {
    setEditingProduct(null);
    setIsProductModalOpen(true);
  };

  const openEditModal = (product: Product) => {
    setEditingProduct(product);
    setIsProductModalOpen(true);
  };

  const openIssueModal = async (product: Product) => {
    setIssueProduct(product);
    setIssueQuantity(1);
    if (workers.length === 0) {
      try {
        const response = await fetch(`${API_URL}/workers/`);
        const data: Worker[] = await response.json();
        setWorkers(data);
        if (data.length > 0) {
          setIssueWorkerId(String(data[0].id));
        } else {
          toast.error("Сначала добавьте работников в систему.");
          return;
        }
      } catch (error) { toast.error("Не удалось загрузить работников"); }
    } else if (issueWorkerId === '') {
      setIssueWorkerId(String(workers[0].id));
    }
    setIsIssueModalOpen(true);
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>, isInitial: boolean) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('mode', 'to_stock');
    formData.append('is_initial_load', String(isInitial).toLowerCase());
    formData.append('auto_create_new', 'true'); // <-- ДОБАВЛЯЕМ ЭТОТ ФЛАГ
    const toastId = toast.loading('Импорт файла...');
    try {
      const response = await fetch(`${API_URL}/actions/universal-import/`, { method: 'POST', body: formData });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Ошибка импорта');
      toast.success(`Импорт завершен! Создано: ${result.created.length}, Обновлено: ${result.updated.length}`, { id: toastId, duration: 6000 });
      fetchProducts();
    } catch (err: any) {
      toast.error(`Ошибка: ${err.message}`, { id: toastId });
    } finally {
      if (event.target) event.target.value = '';
    }
  };

  const handleDelete = async (productId: number) => {
    if (confirm('Вы уверены, что хотите удалить этот товар? Это действие необратимо.')) {
      const toastId = toast.loading('Удаление товара...');
      try {
        const response = await fetch(`${API_URL}/products/${productId}`, { method: 'DELETE' });
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.detail || 'Не удалось удалить товар');
        }
        toast.success('Товар успешно удален.', { id: toastId });
        fetchProducts();
      } catch (err: any) {
        toast.error(`Ошибка: ${err.message}`, { id: toastId });
      }
    }
  };

  const handleProductSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const toastId = toast.loading(editingProduct ? 'Сохранение...' : 'Создание...');
    const formData = new FormData(event.currentTarget);
    const productData = {
      name: formData.get('name') as string,
      internal_sku: formData.get('internal_sku') as string,
      unit: formData.get('unit') as string,
      stock_quantity: Number(formData.get('stock_quantity')),
      purchase_price: Number(formData.get('purchase_price')),
      retail_price: Number(formData.get('retail_price')),
      min_stock_level: Number(formData.get('min_stock_level')),
      supplier_sku: (formData.get('supplier_sku') as string) || null,
    };
    const url = editingProduct ? `${API_URL}/products/${editingProduct.id}` : `${API_URL}/products/`;
    const method = editingProduct ? 'PATCH' : 'POST';
    try {
      const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(productData) });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Ошибка сохранения');
      }
      toast.success(editingProduct ? 'Товар обновлен' : 'Товар создан', { id: toastId });
      setIsProductModalOpen(false);
      fetchProducts();
    } catch (err: any) {
      toast.error(`Ошибка: ${err.message}`, { id: toastId });
    }
  };

  const handleIssueSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!issueProduct || !issueWorkerId || issueQuantity <= 0) {
      toast.error("Проверьте введенные данные");
      return;
    }
    const toastId = toast.loading('Выдача товара...');
    try {
      const response = await fetch(`${API_URL}/actions/issue-item/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: issueProduct.id,
          worker_id: Number(issueWorkerId),
          quantity: issueQuantity
        })
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Ошибка при выдаче товара');
      }
      toast.success("Товар успешно выдан", { id: toastId });
      setIsIssueModalOpen(false);
      fetchProducts();
    } catch (err: any) {
      toast.error(`Ошибка: ${err.message}`, { id: toastId });
    }
  };

  const getRowClass = (product: Product): string => {
    if (product.stock_quantity <= 0) return 'bg-red-50 hover:bg-red-100';
    if (product.stock_quantity > 0 && product.stock_quantity <= product.min_stock_level) return 'bg-yellow-50 hover:bg-yellow-100';
    return 'hover:bg-gray-50';
  };

  return (
    <div className="bg-gray-50 min-h-screen">
      <main className="container mx-auto p-4 sm:p-6 lg:p-8">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-gray-800">Склад</h1>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={fetchProducts} className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors">
              <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} /> Обновить
            </button>
            <input type="file" ref={initialLoadInputRef} onChange={(e) => handleImport(e, true)} className="hidden" accept=".xlsx,.xls" />
            <button onClick={() => initialLoadInputRef.current?.click()} className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700">
              <FileUp size={18} /> Загрузить мой склад
            </button>
            <input type="file" ref={supplierImportInputRef} onChange={(e) => handleImport(e, false)} className="hidden" accept=".xlsx,.xls" />
            <button onClick={() => supplierImportInputRef.current?.click()} className="flex items-center gap-2 px-4 py-2 bg-indigo-500 text-white rounded-md hover:bg-indigo-600">
              <Upload size={18} /> Пополнить (Петрович)
            </button>
            <button onClick={openCreateModal} className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 transition-colors">
              <Plus size={18} /> Добавить товар
            </button>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100 border-b-2 border-gray-200">
                <tr>
                  <th className="py-3 px-4 text-left font-semibold text-gray-600 uppercase tracking-wider">Вн. код</th>
                  <th className="py-3 px-4 text-left font-semibold text-gray-600 uppercase tracking-wider">Наименование</th>
                  <th className="py-3 px-4 text-left font-semibold text-gray-600 uppercase tracking-wider">Артикул</th>
                  <th className="py-3 px-4 text-right font-semibold text-gray-600 uppercase tracking-wider">Остаток</th>
                  <th className="py-3 px-4 text-left font-semibold text-gray-600 uppercase tracking-wider">Ед.</th>
                  <th className="py-3 px-4 text-right font-semibold text-gray-600 uppercase tracking-wider">Закуп.</th>
                  <th className="py-3 px-4 text-right font-semibold text-gray-600 uppercase tracking-wider">Розн.</th>
                  <th className="py-3 px-4 text-center font-semibold text-gray-600 uppercase tracking-wider">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {isLoading ? (
                  <tr><td colSpan={8} className="text-center py-10 text-gray-500">Загрузка данных...</td></tr>
                ) : error ? (
                  <tr><td colSpan={8} className="text-center py-10 text-red-600">Ошибка: {error}</td></tr>
                ) : (
                  products.map(product => (
                    <tr key={product.id} className={`${getRowClass(product)} transition-colors duration-150 ease-in-out`}>
                      <td className="py-3 px-4 whitespace-nowrap text-gray-500">{product.internal_sku}</td>
                      <td className="py-3 px-4 font-medium text-gray-900">{product.name}</td>
                      <td className="py-3 px-4 whitespace-nowrap text-gray-500">{product.supplier_sku || '—'}</td>
                      <td className="py-3 px-4 text-right font-bold text-gray-800">{product.stock_quantity}</td>
                      <td className="py-3 px-4 text-gray-500">{product.unit}</td>
                      <td className="py-3 px-4 text-right text-gray-600">{product.purchase_price.toFixed(2)} ₽</td>
                      <td className="py-3 px-4 text-right text-gray-800">{product.retail_price.toFixed(2)} ₽</td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex justify-center items-center space-x-2">
                          <button onClick={() => openIssueModal(product)} className="p-1 text-green-600 hover:text-green-800" title="Выдать товар">
                            <Send size={16} />
                          </button>
                          <button onClick={() => openEditModal(product)} className="p-1 text-blue-600 hover:text-blue-800" title="Редактировать">
                            <Edit size={16} />
                          </button>
                          <button onClick={() => handleDelete(product.id)} className="p-1 text-red-600 hover:text-red-800" title="Удалить">
                            <Trash2 size={16} />
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

      {isProductModalOpen && (
        <Modal
          isOpen={isProductModalOpen}
          onClose={() => setIsProductModalOpen(false)}
          title={editingProduct ? "Редактировать товар" : "Новый товар"}
        >
          <form onSubmit={handleProductSubmit} className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label htmlFor="name" className="block text-sm font-medium text-gray-700">Наименование</label>
              <input type="text" name="name" id="name" required defaultValue={editingProduct?.name || ''} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500" />
            </div>
            <div>
              <label htmlFor="internal_sku" className="block text-sm font-medium text-gray-700">Внутренний артикул</label>
              <input type="text" name="internal_sku" id="internal_sku" required defaultValue={editingProduct?.internal_sku || ''} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3" />
            </div>
            <div>
              <label htmlFor="supplier_sku" className="block text-sm font-medium text-gray-700">Артикул поставщика</label>
              <input type="text" name="supplier_sku" id="supplier_sku" defaultValue={editingProduct?.supplier_sku || ''} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3" />
            </div>
            <div>
              <label htmlFor="stock_quantity" className="block text-sm font-medium text-gray-700">Остаток</label>
              <input type="number" step="0.01" name="stock_quantity" id="stock_quantity" required defaultValue={editingProduct?.stock_quantity ?? 0} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3" />
            </div>
            <div>
              <label htmlFor="unit" className="block text-sm font-medium text-gray-700">Ед. изм.</label>
              <select name="unit" id="unit" required defaultValue={editingProduct?.unit || 'шт.'} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 bg-white focus:outline-none focus:ring-indigo-500 focus:border-indigo-500">
                <option>шт.</option>
                <option>пог. м.</option>
                <option>л.</option>
                <option>кг.</option>
                <option>кв. м.</option>
                <option>куб. м.</option>
              </select>
            </div>
            <div>
              <label htmlFor="purchase_price" className="block text-sm font-medium text-gray-700">Цена закупки, ₽</label>
              <input type="number" step="0.01" name="purchase_price" id="purchase_price" defaultValue={editingProduct?.purchase_price ?? 0} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3" />
            </div>
            <div>
              <label htmlFor="retail_price" className="block text-sm font-medium text-gray-700">Цена розничная, ₽</label>
              <input type="number" step="0.01" name="retail_price" id="retail_price" defaultValue={editingProduct?.retail_price ?? 0} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3" />
            </div>
            <div className="col-span-2">
              <label htmlFor="min_stock_level" className="block text-sm font-medium text-gray-700">Минимальный остаток для оповещения</label>
              <input type="number" step="0.01" name="min_stock_level" id="min_stock_level" defaultValue={editingProduct?.min_stock_level ?? 0} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3" />
            </div>
            <div className="col-span-2 flex justify-end pt-4">
              <button type="button" onClick={() => setIsProductModalOpen(false)} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md mr-2 hover:bg-gray-300">Отмена</button>
              <button type="submit" className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600">Сохранить</button>
            </div>
          </form>
        </Modal>
      )}

      {isIssueModalOpen && issueProduct && (
        <Modal isOpen={isIssueModalOpen} onClose={() => setIsIssueModalOpen(false)} title="Выдать товар со склада">
          <form onSubmit={handleIssueSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Товар</label>
              <p className="mt-1 font-semibold text-lg">{issueProduct.name}</p>
              <p className="text-sm text-gray-500">В наличии: {issueProduct.stock_quantity} {issueProduct.unit}</p>
            </div>
            <div>
              <label htmlFor="issue-quantity" className="block text-sm font-medium text-gray-700">Количество</label>
              <input
                type="number"
                id="issue-quantity"
                value={issueQuantity}
                onChange={(e) => setIssueQuantity(Number(e.target.value))}
                max={issueProduct.stock_quantity}
                min="1"
                required
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
              />
            </div>
            <div>
              <label htmlFor="issue-worker" className="block text-sm font-medium text-gray-700">Выдать работнику</label>
              <select
                id="issue-worker"
                value={issueWorkerId}
                onChange={(e) => setIssueWorkerId(e.target.value)}
                required
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 bg-white"
              >
                {workers.map(worker => (
                  <option key={worker.id} value={worker.id}>{worker.name}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end pt-4 border-t mt-4">
              <button type="button" onClick={() => setIsIssueModalOpen(false)} className="px-4 py-2 bg-gray-200 rounded-md mr-2">Отмена</button>
              <button type="submit" className="px-4 py-2 bg-green-500 text-white rounded-md">Выдать</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}