import React from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import PageShell from '../../components/PageShell';
import { useAuthGuard } from '../../hooks/useAuthGuard';
import './ToolsHub.css';

const tools = [
  {
    id: 'minecraft-skin-viewer',
    title: 'Minecraft Skin Viewer',
    description: '3D 表示、回転、アニメーション確認を一画面で行えるビューワーです。',
    path: '/tools/minecraft',
    icon: 'view_in_ar',
    available: true,
  },
  {
    id: 'profile-assets',
    title: 'Profile Assets',
    description: 'プロフィール向けの補助ツールをここへ集約する予定です。',
    path: '/tools/profile-assets',
    icon: 'collections',
    available: false,
  },
  {
    id: 'ops-utilities',
    title: 'Ops Utilities',
    description: '運用補助系ツールの追加枠です。必要に応じてここへ整理します。',
    path: '/tools/ops-utilities',
    icon: 'construction',
    available: false,
  },
];

const ToolsHub: React.FC = () => {
  const navigate = useNavigate();
  const { loading, redirect } = useAuthGuard();

  if (loading) {
    return <div className="tools-hub-loading">ツール面を準備しています...</div>;
  }

  if (redirect) {
    return <Navigate to={redirect} replace />;
  }

  return (
    <div className="tools-hub">
      <PageShell
        eyebrow="Utility Tools"
        title="Tools Hub"
        description="個別機能をただ並べるのではなく、用途別に整理された補助面として育てていく入口です。"
        meta={
          <>
            <span className="tools-chip">認証済みワークスペース</span>
            <span className="tools-chip">実装済みと今後追加予定を分離</span>
          </>
        }
        compact
      >
        <div className="tools-grid">
          {tools.map((tool) => (
            <article
              key={tool.id}
              className={`tool-card ${tool.available ? '' : 'disabled'}`}
              role="button"
              tabIndex={tool.available ? 0 : -1}
              onClick={() => {
                if (tool.available) {
                  navigate(tool.path);
                }
              }}
              onKeyDown={(event) => {
                if (!tool.available) {
                  return;
                }

                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  navigate(tool.path);
                }
              }}
              aria-disabled={!tool.available}
            >
              <span className="tool-icon">
                <span className="material-icons">{tool.icon}</span>
              </span>

              <div className="tool-body">
                <div className="tool-copy">
                  <strong>{tool.title}</strong>
                  <p>{tool.description}</p>
                </div>
                <span className="tool-state">{tool.available ? 'Open' : 'Coming soon'}</span>
              </div>

              <span className="tool-cta material-icons">
                {tool.available ? 'arrow_forward' : 'schedule'}
              </span>
            </article>
          ))}
        </div>
      </PageShell>
    </div>
  );
};

export default ToolsHub;
