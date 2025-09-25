"use client";

import React, { useEffect, useState } from 'react';
import ProductsToOrderPanel from '@/components/ProductsToOrderPanel';
import { fetchApi } from '@/lib/api';
import toast from 'react-hot-toast';

interface ProductToOrder {
    id: number;
    name: string;
    stock_quantity: number;
    min_stock_level: number;
    unit: string;
}

export default function ProductsToOrderPage() {
    const [items, setItems] = useState<ProductToOrder[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            try {
                const data = await fetchApi('/products/?stock_status=low_stock');
                const list: ProductToOrder[] = Array.isArray(data.items) ? data.items : [];
                list.sort((a, b) => b.stock_quantity - a.stock_quantity);
                setItems(list);
            } catch (e: any) {
                toast.error(e?.message || 'Не удалось загрузить товары');
            } finally { setLoading(false); }
        };
        load();
    }, []);

    return (
        <main className="container mx-auto p-4 sm:p-6 lg:p-8">
            <h1 className="text-2xl font-bold mb-4">Товары к закупу</h1>
            <div className="bg-white rounded-lg shadow-md p-4">
                {loading ? <div className="p-4 text-center text-gray-500">Загрузка...</div> : <ProductsToOrderPanel items={items} />}
            </div>
        </main>
    );
}
