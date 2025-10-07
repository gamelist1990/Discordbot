import React from 'react';
import styles from './Toast.module.css';

export type ToastType = 'info' | 'success' | 'error';

export interface ToastProps {
  type?: ToastType;
  title?: string;
  message: string;
}

const Toast: React.FC<ToastProps> = ({ type = 'info', title, message }) => {
  return (
    <div className={`${styles.toast} ${styles[type]}`} role="status" aria-live="polite">
      <div className={styles.toastIcon}>
        {type === 'success' ? <i className="material-icons">check_circle</i> : type === 'error' ? <i className="material-icons">error</i> : <i className="material-icons">info</i>}
      </div>
      <div className={styles.toastContent}>
        {title && <div className={styles.toastTitle}>{title}</div>}
        <div className={styles.toastMessage}>{message}</div>
      </div>
    </div>
  );
};

export default Toast;
