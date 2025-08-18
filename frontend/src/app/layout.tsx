// frontend/src/app/layout.tsx
'use client';

import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from 'react-hot-toast';
import { usePathname } from 'next/navigation'; // Импортируем хук
import ProtectedLayout from "@/components/ProtectedLayout"; // Импортируем наш новый компонент

const inter = Inter({ subsets: ["latin"] });

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const pathname = usePathname(); // Получаем текущий URL
  const isLoginPage = pathname === '/login';

  return (
    <html lang="ru">
      <head>
        <title>Система Учета "Склад v4"</title>
      </head>
      <body className={`${inter.className} bg-gray-50`}>
        <Toaster position="bottom-right" toastOptions={{ duration: 5000 }} />
        
        {isLoginPage ? (
            // Если это страница логина, показываем только ее содержимое
            children
        ) : (
            // Для всех остальных страниц оборачиваем их в наш layout с меню
            <ProtectedLayout>
                {children}
            </ProtectedLayout>
        )}
      </body>
    </html>
  );
}