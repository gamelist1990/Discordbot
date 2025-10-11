import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles/global.css';
import { AppToastProvider } from './AppToastProvider';
import { startPrivateChatSSE } from './services/sse';

// Handle redirection logic after successful authentication
// Only perform the stored-returnPath redirect when the app is on the root page
// or when coming back from an auth callback. This avoids stealing navigation
// when a user visits a shared URL like /todo/shared/:token.
const handlePostAuthRedirect = () => {
  const returnPath = localStorage.getItem('returnPath');
  const currentPath = window.location.pathname;

  // Only redirect if there is a stored returnPath, it's different from root and
  // it's not the same as the current path AND the user is currently on the root
  // (or an auth callback). This prevents unexpected redirects when visiting
  // deep links such as /todo/shared/:token.
  const isAuthCallback = currentPath.startsWith('/auth') || currentPath.startsWith('/callback');
  if (
    returnPath &&
    returnPath !== '/' &&
    returnPath !== currentPath &&
    (currentPath === '/' || isAuthCallback)
  ) {
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
