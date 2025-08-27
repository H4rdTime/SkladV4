// frontend/src/lib/api.ts
import Cookies from 'js-cookie';

export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://sklad-petrovich-api.onrender.com';

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
            
            // Try parsing JSON, but be resilient: Pydantic may return an array of errors
            let errorData: any = null;
            try {
                errorData = await response.json();
            } catch (e) {
                // not JSON
            }

            let errorMessage = `Ошибка ${response.status}`;
            if (errorData) {
                if (Array.isArray(errorData)) {
                    errorMessage = errorData.map((item: any) => {
                        if (typeof item === 'string') return item;
                        if (item && typeof item === 'object') return item.detail || item.msg || item.message || JSON.stringify(item);
                        return String(item);
                    }).join('; ');
                } else if (typeof errorData === 'object') {
                    errorMessage = errorData.detail || errorData.message || JSON.stringify(errorData);
                } else {
                    errorMessage = String(errorData);
                }
            }
            throw new Error(errorMessage);
        }
        
        if (response.status === 204) return null;
        return response.json();
    } catch (error) {
        console.error("API Error in fetchApi:", error);
        throw error;
    }
};