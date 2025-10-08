import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import HomePage from './pages/Home';
import DashboardPage from './pages/Dashboard';
import SettingsPage from './pages/Settings';
import SettingsListPage from './pages/SettingsList';
import PrivateChatPage from './pages/PrivateChat';
import NotFoundPage from './pages/NotFound';
import TodoDashboard from './pages/Todo/TodoDashboard';
import TodoSession from './pages/Todo/TodoSession';
import UserProfile from './pages/Profile';

const App: React.FC = () => {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/profile" element={<UserProfile />} />
      <Route path="/settings" element={<SettingsListPage />} />
      <Route path="/settings/:guildId" element={<SettingsPage />} />
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
