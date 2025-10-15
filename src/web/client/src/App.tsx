import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import AppHeader from './components/Common/AppHeader';
import SettingsPage from './pages/Settings';
import SettingsListPage from './pages/SettingsList';
import PrivateChatPage from './pages/PrivateChat';
import RoleManagerPage from './pages/RoleManager';
import StaffHelpPage from './pages/StaffHelp';
import NotFoundPage from './pages/NotFound';
import TodoDashboard from './pages/Todo/TodoDashboard';
import TodoSession from './pages/Todo/TodoSession';
import UserProfile from './pages/Profile';
import FeedbackPage from './pages/Feedback';
import { useAuthGuard } from './hooks/useAuthGuard';
import HomePage from './pages/Home';

// Protected route component for staff access
const StaffGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { loading, redirect } = useAuthGuard({ requireStaff: true });

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        fontSize: '1.2em'
      }}>
        読み込み中...
      </div>
    );
  }

  if (redirect) {
    return <Navigate to={redirect} replace />;
  }

  return <>{children}</>;
};

const App: React.FC = () => {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <AppHeader />
      <main style={{ flex: 1 }}>
        <Routes>
  <Route path="/" element={<HomePage />} />
      <Route path="/profile" element={<UserProfile />} />
      <Route path="/settings" element={<SettingsListPage />} />
      <Route path="/settings/:guildId" element={<SettingsPage />} />
      <Route path="/feedback" element={<FeedbackPage />} />
  <Route path="/staff" element={<StaffGuard><StaffHelpPage /></StaffGuard>} />
  <Route path="/staff/privatechat" element={<StaffGuard><PrivateChatPage /></StaffGuard>} />
  <Route path="/staff/rolemanager" element={<StaffGuard><RoleManagerPage /></StaffGuard>} />
  {/* Legacy/typo alias: accept /staff/privateChat (capital C) and redirect to canonical path */}
  <Route path="/staff/privateChat" element={<Navigate to="/staff/privatechat" replace />} />
      <Route path="/todo/:guildId" element={<TodoDashboard />} />
      <Route path="/todo/:guildId/session/:sessionId" element={<TodoSession />} />
      <Route path="/todo/shared/:token" element={<TodoSession />} />
      <Route path="/404" element={<NotFoundPage />} />
      <Route path="*" element={<Navigate to="/404" replace />} />
    </Routes>
      </main>
    </div>
  );
};

export default App;
