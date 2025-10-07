import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles/global.css';
import { AppToastProvider } from './AppToastProvider';
import { setGlobalNotifier } from './utils/globalNotifier';
import { startPrivateChatSSE } from './services/sse';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppToastProvider>
        <App />
      </AppToastProvider>
    </BrowserRouter>
  </React.StrictMode>
);

// setGlobalNotifier は AppToastProvider 内で addToast を登録するために使用されます
// ここでは型だけをエクスポートしておき、実行時には AppToastProvider が登録しますn
export {};

// If a global staff token is injected into the page (window.__STAFF_TOKEN__), start SSE to receive private chat events
try {
  const token = (window as any).__STAFF_TOKEN__ as string | undefined;
  if (token) {
    startPrivateChatSSE(token);
  }
} catch (e) {
  // eslint-disable-next-line no-console
  console.warn('Failed to auto-start PrivateChat SSE', e);
}
