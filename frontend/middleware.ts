// frontend/middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Список страниц, которые доступны без авторизации
const publicPages = ['/login'];

export function middleware(request: NextRequest) {
  // Получаем токен из cookie
  const token = request.cookies.get('accessToken')?.value;
  const { pathname } = request.nextUrl;

  const isPublicPage = publicPages.includes(pathname);

  // Сценарий 1: Пользователь НЕ авторизован и пытается зайти на ЗАЩИЩЕННУЮ страницу
  if (!token && !isPublicPage) {
    // Перебрасываем его на страницу входа
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Сценарий 2: Пользователь АВТОРИЗОВАН и пытается зайти на страницу входа
  if (token && isPublicPage) {
    // Перебрасываем его на дашборд, потому что он уже вошел в систему
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }
  
  // Во всех остальных случаях - разрешаем доступ
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Сопоставлять все пути запросов, кроме тех, которые начинаются с:
     * - api (маршруты API самого Next.js)
     * - _next/static (статические файлы: js, css)
     * - _next/image (файлы оптимизации изображений)
     * - favicon.ico (файл иконки)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};