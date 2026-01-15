import axios, { AxiosError, AxiosHeaders } from 'axios';
import { supabase } from '@/lib/supabaseClient';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 0,
});

api.interceptors.request.use(async (config) => {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;

    if (token) {
      if (config.headers instanceof AxiosHeaders) {
        config.headers.set('Authorization', `Bearer ${token}`);
      } else {
        const headers = AxiosHeaders.from(config.headers ?? {});
        headers.set('Authorization', `Bearer ${token}`);
        config.headers = headers;
      }
    }
  } catch {
    // ignore
  }

  return config;
});

/**
 * Lit correctement le body d'erreur, même si Axios l'a reçu en Blob (responseType=blob)
 */
async function readErrorBody(data: any): Promise<string> {
  if (!data) return '(no body)';

  // Cas classique JSON
  if (typeof data === 'object' && !(data instanceof Blob)) {
    if ('message' in data) {
      const m: any = (data as any).message;
      return Array.isArray(m) ? m.join(' | ') : String(m);
    }
    try {
      return JSON.stringify(data);
    } catch {
      return String(data);
    }
  }

  // Cas string
  if (typeof data === 'string') return data;

  // ✅ Cas Blob (très fréquent quand responseType='blob')
  if (data instanceof Blob) {
    try {
      const text = await data.text();

      // si c'est du JSON Nest
      try {
        const parsed = JSON.parse(text);
        if (parsed?.message) {
          return Array.isArray(parsed.message)
            ? parsed.message.join(' | ')
            : String(parsed.message);
        }
        return JSON.stringify(parsed);
      } catch {
        return text || '(empty blob)';
      }
    } catch {
      return '(blob unreadable)';
    }
  }

  return String(data);
}

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const cfg = error.config;
    const fullUrl = `${cfg?.baseURL || ''}${cfg?.url || ''}`;

    if (!error.response) {
      console.error(`❌ NETWORK ERROR | url=${fullUrl} | msg=${error.message}`);
      return Promise.reject(error);
    }

    const status = error.response.status;
    const bodyText = await readErrorBody(error.response.data);

    console.error(`❌ API ERROR | status=${status} | url=${fullUrl} | body=${bodyText}`);

    return Promise.reject(error);
  },
);

export default api;

export async function downloadFile(path: string, filename: string) {
  const res = await api.get(path, { responseType: 'blob' });

  const blob: Blob =
    res.data instanceof Blob
      ? res.data
      : new Blob([res.data], { type: 'application/octet-stream' });

  const url = window.URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  window.URL.revokeObjectURL(url);
}
