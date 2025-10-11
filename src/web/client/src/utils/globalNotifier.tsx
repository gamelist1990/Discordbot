type NotifierFn = (message: string, type?: 'info' | 'success' | 'error', title?: string, timeout?: number) => string;

let notifier: NotifierFn | null = null;

export function setGlobalNotifier(fn: NotifierFn | null) {
  notifier = fn;
}

export function webNotify(message: string, type: 'info' | 'success' | 'error' = 'info', title?: string, timeout?: number) {
  if (notifier) {
    return notifier(message, type, title, timeout);
  }
  // fallback to console
  // eslint-disable-next-line no-console
  console.warn('web.notify called before notifier registered:', { message, type, title });
  return '';
}

// Attach to window under window.web.notify for global usage
declare global {
  interface Window {
    web?: {
      notify?: (message: string, type?: 'info'|'success'|'error', title?: string, timeout?: number) => string;
    };
  }
}

// ensure window.web exists
if (!globalThis.window) {
  // server environment
} else {
  if (!window.web) window.web = {};
  window.web.notify = (message: string, type: 'info' | 'success' | 'error' = 'info', title?: string, timeout?: number) => webNotify(message, type, title, timeout);
}
