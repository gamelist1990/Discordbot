import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import DashboardPage from './pages/Dashboard';
import SettingsPage from './pages/Settings';
import PrivateChatPage from './pages/PrivateChat';
import NotFoundPage from './pages/NotFound';
import TodoDashboard from './pages/Todo/TodoDashboard';
import TodoSession from './pages/Todo/TodoSession';
import UserProfile from './pages/Profile';

const App: React.FC = () => {
  return (
    <Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/profile" element={<UserProfile />} />
      <Route path="/settings/:token" element={<SettingsPage />} />
      <Route path="/staff/privatechat/:token" element={<PrivateChatPage />} />
      <Route path="/todo/:guildId" element={<TodoDashboard />} />
      <Route path="/todo/:guildId/session/:sessionId" element={<TodoSession />} />
      <Route path="/todo/shared/:token" element={<TodoSession />} />
      <Route path="/404" element={<NotFoundPage />} />
      <Route path="*" element={<Navigate to="/404" replace />} />
    </Routes>
  );
};

export default App;
