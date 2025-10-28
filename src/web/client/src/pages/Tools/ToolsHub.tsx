import React from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuthGuard } from '../../hooks/useAuthGuard';
import './ToolsHub.css';

const ToolsHub: React.FC = () => {
  const navigate = useNavigate();
  const { loading, redirect } = useAuthGuard();

  if (loading) {
    return (
      <div className="tools-hub-loading">
        <div>読み込み中...</div>
      </div>
    );
  }

  if (redirect) {
    return <Navigate to={redirect} replace />;
  }

  const tools = [
    {
      id: 'minecraft-skin-viewer',
      title: 'Minecraft Skin Viewer',
      description: '3D スキン表示・回転・アニメーション・プリセット保存・共有',
      path: '/tools/minecraft',
      icon: 'smart_toy'
    },
    {
      id: 'coming-soon-1',
      title: 'Coming Soon',
      description: '将来追加されるツール用のプレースホルダ',
      path: '/tools/coming-soon',
      icon: 'build'
    }
  ];

  return (
    <div className="tools-hub">
      <header className="tools-hub-header">
        <h1>Tools Hub</h1>
        <p>ここから利用可能なツールへアクセスできます。ログインが必要なツールは認証後に利用可能です。</p>
      </header>

      <div className="tools-grid">
        {tools.map((t) => (
          <article
            key={t.id}
            className={`tool-card ${t.id.startsWith('coming-soon') ? 'disabled' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => !t.id.startsWith('coming-soon') && navigate(t.path)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (!t.id.startsWith('coming-soon')) {
                  navigate(t.path);
                }
              }
            }}
            aria-label={`${t.title} - ${t.description}`}
            aria-disabled={t.id.startsWith('coming-soon')}
          >
            <div className="tool-icon" aria-hidden="true">
              <span className="material-icons">{t.icon}</span>
            </div>
            <div className="tool-body">
              <h3>{t.title}</h3>
              <p>{t.description}</p>
            </div>
            <div className="tool-cta" aria-hidden="true">
              {t.id.startsWith('coming-soon') ? '近日公開' : '開く'}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
};

export default ToolsHub;
