import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AccountMenu from '../../components/AccountMenu';

interface JamboardSummary {
  id: string;
  name: string;
  type: 'staff' | 'personal';
}

const WorkspacesPage: React.FC = () => {
  const [jamboards, setJamboards] = useState<JamboardSummary[]>([]);
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const load = async () => {
      try {
        const s = await (await fetch('/api/auth/session', { credentials: 'include' })).json();
        if (!s || !s.authenticated) {
          // redirect to login flow
          window.location.href = '/api/auth/discord?redirect=/jamboard';
          return;
        }
        setUser(s.user);

        const isStaff = (s.user.permission || 0) >= 1;
        const url = isStaff ? '/api/jamboards' : '/api/jamboards';
        const resp = await fetch(url, { credentials: 'include' });
        if (resp.ok) {
          const body = await resp.json();
          setJamboards(body.jamboards || []);
        }
      } catch (e) {
        // ignore
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const handleOpen = (id: string) => {
    navigate(`/jamboard/${id}`);
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    window.location.href = '/jamboard';
  };

  return (
    <div style={{ padding: 20 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Workspaces</h1>
        {user && <AccountMenu userId={user.userId} username={user.username} onLogout={handleLogout} />}
      </header>

      {loading ? (
        <div>読み込み中...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 20 }}>
          {jamboards.map(j => (
            <div key={j.id} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
              <h3>{j.name}</h3>
              <div style={{ fontSize: 12, color: '#666' }}>{j.type === 'staff' ? 'Staff' : 'Personal'}</div>
              <div style={{ marginTop: 12 }}>
                <button onClick={() => handleOpen(j.id)}>Open</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default WorkspacesPage;
