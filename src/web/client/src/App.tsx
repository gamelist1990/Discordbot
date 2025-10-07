import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import DashboardPage from './pages/Dashboard';
import SettingsPage from './pages/Settings';
import PrivateChatPage from './pages/PrivateChat';
import NotFoundPage from './pages/NotFound';

const App: React.FC = () => {
  return (
    <Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/settings/:token" element={<SettingsPage />} />
      <Route path="/staff/privatechat/:token" element={<PrivateChatPage />} />
      <Route path="/404" element={<NotFoundPage />} />
      <Route path="*" element={<Navigate to="/404" replace />} />
    </Routes>
  );
};

export default App;
