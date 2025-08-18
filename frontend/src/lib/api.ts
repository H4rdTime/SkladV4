// frontend/src/lib/api.ts
import Cookies from 'js-cookie';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://sklad-petrovich-api.onrender.com';

export const fetchApi = async (url: string, options: RequestInit = {}) => {
    const token = Cookies.get('accessToken');

    const headers: Record<string, string> = { ...(options.headers as Record<string, string> ?? {}) };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    if (!(options.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
    }

    try {
        const response = await fetch(`${API_URL}${url}`, { ...options, headers });

        if (!response.ok) {
            // --- УМНАЯ ОБРАБОТКА ОШИБКИ 401 ---
            if (response.status === 401) {
                // Если мы не авторизованы, удаляем "протухший" cookie
                Cookies.remove('accessToken');
                // И если мы в браузере, перенаправляем на логин
                if (typeof window !== 'undefined') {
                    window.location.href = '/login';
                }
                // Создаем специальную ошибку, чтобы прервать выполнение
                throw new Error("Сессия истекла или недействительна.");
            }
            // --- КОНЕЦ УМНОЙ ОБРАБОТКИ ---
            
            const errorData = await response.json();
            throw new Error(errorData.detail || `Ошибка ${response.status}`);
        }
        
        if (response.status === 204) return null;
        return response.json();
    } catch (error) {
        console.error("API Error in fetchApi:", error);
        throw error;
    }
};