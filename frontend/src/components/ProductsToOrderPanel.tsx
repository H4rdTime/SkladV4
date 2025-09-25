// frontend/src/components/ProductsToOrderPanel.tsx
'use client';

import React from 'react';

interface ProductToOrder {
    id: number;
    name: string;
    stock_quantity: number;
    min_stock_level: number;
    unit: string;
}

export default function ProductsToOrderPanel({ items, title = 'Товары к закупке' }: { items: ProductToOrder[]; title?: string }) {
    return (
        <aside className="w-full md:w-96 bg-white rounded-lg shadow-md p-4">
            <h3 className="text-lg font-semibold mb-3">{title}</h3>
            <div className="max-h-96 overflow-y-auto">
                {items.length === 0 ? (
                    <div className="text-sm text-gray-500">Все в порядке, закупки не требуются.</div>
                ) : (
                    <ul className="space-y-2">
                        {items.map(p => (
                            <li key={p.id} className="p-2 bg-yellow-50 rounded-md flex justify-between items-center">
                                <div className="text-sm font-medium text-gray-900">{p.name}</div>
                                <div className="text-right text-sm text-gray-700">{p.stock_quantity} {p.unit} / min {p.min_stock_level}</div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </aside>
    );
}
