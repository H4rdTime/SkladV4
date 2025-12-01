// frontend/src/app/layout.tsx
'use client';

import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from 'react-hot-toast';
import { usePathname } from 'next/navigation';
import ProtectedLayout from "@/components/ProtectedLayout";
import AiChat from "@/components/AiChat";

const inter = Inter({ subsets: ["latin"] });

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const pathname = usePathname();
  const isLoginPage = pathname === '/login';

  return (
    <html lang="ru">
      <head>
        <title>Система Учета "Склад v4"</title>
      </head>
      <body className={`${inter.className} bg-gray-50`}>
        <Toaster position="bottom-right" toastOptions={{ duration: 5000 }} />

        {isLoginPage ? (
          children
        ) : (
          <ProtectedLayout>
            {children}
          </ProtectedLayout>
        )}

        {/* AI Chat - доступен на всех страницах кроме логина */}
        {!isLoginPage && <AiChat />}
      </body>
    </html>
  );
}