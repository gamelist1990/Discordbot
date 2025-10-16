import React from 'react';

const RankManagerPage: React.FC = () => {
  return (
    <div style={{ padding: 20 }}>
      <h1>ランキング管理</h1>
      <p>ここからサーバーのランク設定、リーダーボード、パネル管理を行います。</p>
      <p>バックエンド API: <code>/api/staff/rankmanager/*</code></p>
    </div>
  );
};

export default RankManagerPage;
