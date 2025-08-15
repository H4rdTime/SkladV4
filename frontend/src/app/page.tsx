// frontend/src/app/page.tsx

import { redirect } from 'next/navigation';

export default function HomePage() {
  // Эта функция выполнится на сервере Vercel
  // и отправит браузеру команду на перенаправление.
  redirect('/dashboard');
}