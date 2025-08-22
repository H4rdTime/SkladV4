// frontend/src/app/login/page.tsx
'use client';
import { useState, FormEvent } from 'react';
import toast from 'react-hot-toast';
import { useRouter } from 'next/navigation';
import Cookies from 'js-cookie';
import { KeyRound } from 'lucide-react';

export default function LoginPage() {
    const [username, setUsername] = useState(''); // Для удобства
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const router = useRouter();

    // Используем переменную окружения
    const API_URL = process.env.NEXT_PUBLIC_API_URL;

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        const toastId = toast.loading('Вход в систему...');

        try {
            if (!API_URL) {
                throw new Error("URL API не настроен");
            }

            const response = await fetch(`${API_URL}/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ username, password }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || 'Неверный логин или пароль');
            }

            const data = await response.json();

            Cookies.set('accessToken', data.access_token, { expires: 7, path: '/', secure: true, sameSite: 'strict' });

            toast.success('Вход выполнен успешно!', { id: toastId });

            // Вместо router.push используем window.location.href для полной перезагрузки
            window.location.href = '/dashboard';

        } catch (err: any) {
            toast.error(err.message, { id: toastId });
        } finally {
            setIsLoading(false);
        }
    };
    return (
        <div className="flex items-center justify-center min-h-screen bg-gray-100">
            <div className="p-8 bg-white rounded-lg shadow-xl w-full max-w-sm">
                <div className="flex justify-center mb-6">
                    <KeyRound size={40} className="text-blue-600" />
                </div>
                <h1 className="text-2xl font-bold mb-6 text-center text-gray-800">Вход в Систему</h1>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label htmlFor="username" className="block text-sm font-medium text-gray-700">Логин</label>
                        <input
                            type="text"
                            id="username"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            placeholder="admin"
                            required
                            className="mt-1 w-full p-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <div>
                        <label htmlFor="password">Пароль</label>
                        <input
                            type="password"
                            id="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            placeholder="••••••••"
                            required
                            className="mt-1 w-full p-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full p-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
                    >
                        {isLoading ? 'Вход...' : 'Войти'}
                    </button>
                </form>
            </div>
        </div>
    );
}