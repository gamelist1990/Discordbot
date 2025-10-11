import { useState, useCallback } from 'react';

const makeId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,9)}`;

export type ToastType = 'info' | 'success' | 'error';

export interface ToastItem {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
}

export default function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((message: string, type: ToastType = 'info', title?: string, timeout = 4000) => {
    const id = makeId();
    const item: ToastItem = { id, type, title, message };
    setToasts((t) => [item, ...t]);
    if (timeout > 0) {
      setTimeout(() => {
        setToasts((t) => t.filter(x => x.id !== id));
      }, timeout);
    }
    return id;
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((t) => t.filter(x => x.id !== id));
  }, []);

  return { toasts, addToast, removeToast };
}
