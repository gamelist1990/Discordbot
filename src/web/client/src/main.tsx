import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles/global.css';
import { AppToastProvider } from './AppToastProvider';
import { startPrivateChatSSE } from './services/sse';

// Handle redirection logic after successful authentication
const handlePostAuthRedirect = () => {
  const returnPath = localStorage.getItem('returnPath');
  if (returnPath && returnPath !== '/' && returnPath !== window.location.pathname) {
    localStorage.removeItem('returnPath');
    window.location.href = returnPath;
  }
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppToastProvider>
        <App />
      </AppToastProvider>
    </BrowserRouter>
  </React.StrictMode>
);

// Handle redirection after authentication
handlePostAuthRedirect();

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
