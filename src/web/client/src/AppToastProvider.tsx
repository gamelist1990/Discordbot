import React, { createContext, useContext } from 'react';
import useToast from './hooks/useToast';
import Toast from './components/Toast/Toast';
import styles from './components/Toast/Toast.module.css';

type ToastContextType = {
  addToast: (message: string, type?: 'info' | 'success' | 'error', title?: string, timeout?: number) => string;
  removeToast: (id: string) => void;
};

const ToastContext = createContext<ToastContextType | null>(null);

export const useAppToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useAppToast must be used within AppToastProvider');
  return ctx;
};

export const AppToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { toasts, addToast, removeToast } = useToast();

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}
      <div className={styles.toastContainer} aria-live="polite">
        {toasts.map(t => (
          <Toast key={t.id} type={t.type} title={t.title} message={t.message} />
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export default AppToastProvider;
