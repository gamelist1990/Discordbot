import React, { useEffect, useRef, useState } from 'react';
import { createSkin3dViewer } from './skin3dWrapper.js';
import './MinecraftViewer.css';

const MinecraftViewerEnhanced = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<any>(null);
  const [fileName, setFileName] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'viewer'|'controls'|'pose'|'presets'>('viewer');
  const [zoom, setZoomState] = useState<number>(0.73);
  // rotation via slider removed per request
  const [autoRotate, setAutoRotateState] = useState<boolean>(false);
  // Pose tab state - sliders for X/Y/Z rotation
  const [selectedPart, setSelectedPart] = useState<string | null>(null);
  const [partRotation, setPartRotation] = useState<{ x: number; y: number; z: number }>({ x: 0, y: 0, z: 0 });
  // Background settings
  const [backgroundType, setBackgroundType] = useState<'preset'|'custom'|'panorama'>('preset');
  const [selectedPreset, setSelectedPreset] = useState<string>('white');
  const [backgroundFileName, setBackgroundFileName] = useState<string>('');
  // Preset management
  const [presets, setPresets] = useState<Array<{
    id: string;
    name: string;
    camera: any;
    pose: any;
    background: { type: string; preset?: string; customUrl?: string };
    screenshot?: string;
    createdAt: string;
  }>>([]);
  const [currentPresetName, setCurrentPresetName] = useState<string>('');

  useEffect(() => {
    let mounted = true;
    if (!containerRef.current) return;

    (async () => {
      try {
        const handle = await createSkin3dViewer(containerRef.current!);
        if (!mounted) {
          handle.destroy();
          return;
        }
        viewerRef.current = handle;
        // enable controls by default
        try { viewerRef.current?.enableControls?.(true); } catch {}
  // apply initial zoom and autoRotate
  try { viewerRef.current?.setZoom?.(zoom); viewerRef.current?.setAutoRotate?.(autoRotate); } catch {}
      } catch (e) {
        console.error('Failed to init viewer', e);
        setError('ビューの初期化に失敗しました');
      }
    })();

    return () => {
      mounted = false;
      try { viewerRef.current?.destroy(); } catch {}
      viewerRef.current = null;
    };
  }, []);

  // Enable part picking and disable model rotation only when Pose tab is active
  useEffect(() => {
    const handle = viewerRef.current;
    if (!handle) return;
    if (activeTab === 'pose') {
      // Pose mode: disable model rotation/zoom, enable part picking
      try { handle.setPoseMode?.(true); } catch (e) {}
      try { handle.setOnPartSelected?.((part: string | null) => {
        if (!part) {
          setSelectedPart(null);
          setPartRotation({ x: 0, y: 0, z: 0 });
          return;
        }
        setSelectedPart(part);
        // Get current rotation values for the sliders
        try {
          const currentRot = handle.getCurrentPartRotation?.(part);
          if (currentRot) {
            // Convert radians to degrees for slider display
            setPartRotation({
              x: Math.round((currentRot.x * 180) / Math.PI),
              y: Math.round((currentRot.y * 180) / Math.PI),
              z: Math.round((currentRot.z * 180) / Math.PI)
            });
          }
        } catch (e) {
          console.debug('Failed to get current rotation:', e);
        }
      }); } catch (e) {}
      try { handle.enablePartPicking?.(true); } catch (e) {}
    } else {
      // Normal mode: enable model rotation/zoom
      try { handle.setPoseMode?.(false); } catch (e) {}
      try { handle.enablePartPicking?.(false); } catch (e) {}
      // Clear selection when leaving pose mode
      setSelectedPart(null);
      setPartRotation({ x: 0, y: 0, z: 0 });
    }
    return () => {
      try { handle.setPoseMode?.(false); } catch (e) {}
      try { handle.setOnPartSelected?.(() => {}); } catch (e) {}
      try { handle.enablePartPicking?.(false); } catch (e) {}
    };
  }, [activeTab]);

  // apply zoom when changed
  useEffect(() => {
    try {
      viewerRef.current?.setZoom?.(zoom);
    } catch (e) { console.debug('apply zoom failed', e); }
  }, [zoom]);

  useEffect(() => {
    try { viewerRef.current?.setAutoRotate?.(autoRotate); } catch (e) { console.debug('apply autoRotate failed', e); }
  }, [autoRotate]);

  // apply preset background when changed
  useEffect(() => {
    if (backgroundType === 'preset') {
      applyBackground();
    }
  }, [selectedPreset, backgroundType]);

  const onFileChange: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    setError(null);
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setFileName(f.name);
    const url = URL.createObjectURL(f);
    try {
      if (viewerRef.current) {
        await viewerRef.current.loadSkin(url);
        try { viewerRef.current.setFrontView(); } catch {}
      }
    } catch (err) {
      console.error('loadSkin failed', err);
      setError('スキンの読み込みに失敗しました');
    }
  };

  const resetView = () => {
    setZoomState(0.73);
    setAutoRotateState(true);
    try { viewerRef.current?.setFrontView?.(); } catch {}
  };

  // Background presets
  const backgroundPresets = {
    white: { name: '白', color: 0xffffff },
    black: { name: '黒', color: 0x000000 },
    gray: { name: 'グレー', color: 0x808080 },
    lightGray: { name: '薄グレー', color: 0xc0c0c0 },
    darkGray: { name: '濃グレー', color: 0x404040 },
    blue: { name: '青', color: 0x0000ff },
    lightBlue: { name: '薄青', color: 0x87ceeb },
    green: { name: '緑', color: 0x008000 },
    lightGreen: { name: '薄緑', color: 0x90ee90 },
    red: { name: '赤', color: 0xff0000 },
    lightRed: { name: '薄赤', color: 0xffb6c1 },
  };

  const applyBackground = async () => {
    try {
      if (backgroundType === 'preset') {
        const preset = backgroundPresets[selectedPreset as keyof typeof backgroundPresets];
        if (preset) {
          viewerRef.current?.setBackgroundColor?.(preset.color);
        }
      } else if (backgroundType === 'custom' || backgroundType === 'panorama') {
        // Will be handled by file input handlers
      }
    } catch (e) {
      console.debug('applyBackground failed', e);
    }
  };

  const onBackgroundFileChange: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setBackgroundFileName(f.name);
    const url = URL.createObjectURL(f);
    try {
      if (backgroundType === 'custom') {
        await viewerRef.current?.loadBackground?.(url);
      } else if (backgroundType === 'panorama') {
        await viewerRef.current?.loadPanorama?.(url);
      }
    } catch (err) {
      console.error('Background load failed', err);
      setError('背景の読み込みに失敗しました');
    }
  };

  // Preset management functions
  const saveCurrentPreset = async () => {
    if (!currentPresetName.trim()) {
      setError('プリセット名を入力してください');
      return;
    }

    try {
      const camera = viewerRef.current?.getCameraState?.();
      const pose = viewerRef.current?.getPoseState?.();
      const screenshot = await viewerRef.current?.takeScreenshot?.();

      if (!camera || !pose) {
        setError('カメラまたはポーズ情報の取得に失敗しました');
        return;
      }

      const newPreset = {
        id: Date.now().toString(),
        name: currentPresetName.trim(),
        camera,
        pose,
        background: {
          type: backgroundType,
          preset: backgroundType === 'preset' ? selectedPreset : undefined,
          customUrl: backgroundType !== 'preset' ? backgroundFileName : undefined
        },
        screenshot,
        createdAt: new Date().toISOString()
      };

      setPresets(prev => [...prev, newPreset]);
      setCurrentPresetName('');
      setError(null);
    } catch (err) {
      console.error('Preset save failed', err);
      setError('プリセットの保存に失敗しました');
    }
  };

  const loadPreset = async (preset: typeof presets[0]) => {
    try {
      // Load camera state
      if (preset.camera) {
        viewerRef.current?.setCameraState?.(preset.camera);
      }

      // Load pose state
      if (preset.pose) {
        viewerRef.current?.setPoseState?.(preset.pose);
      }

      // Load background
      if (preset.background) {
        if (preset.background.type === 'preset' && preset.background.preset) {
          const presetColor = backgroundPresets[preset.background.preset as keyof typeof backgroundPresets];
          if (presetColor) {
            viewerRef.current?.setBackgroundColor?.(presetColor.color);
          }
        }
        // Note: Custom backgrounds would need to be re-uploaded
      }

      setError(null);
    } catch (err) {
      console.error('Preset load failed', err);
      setError('プリセットの読み込みに失敗しました');
    }
  };

  const deletePreset = (id: string) => {
    if (confirm('このプリセットを削除しますか？')) {
      setPresets(prev => prev.filter(p => p.id !== id));
    }
  };

  const exportPreset = (preset: typeof presets[0]) => {
    const dataStr = JSON.stringify(preset, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);

    const exportFileDefaultName = `${preset.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_preset.json`;

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  const importPreset = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const preset = JSON.parse(e.target?.result as string);
        // Validate preset structure
        if (preset.name && preset.camera && preset.pose) {
          setPresets(prev => [...prev, { ...preset, id: Date.now().toString() }]);
          setError(null);
        } else {
          setError('無効なプリセットファイルです');
        }
      } catch (err) {
        setError('プリセットファイルの読み込みに失敗しました');
      }
    };
  return (
    <div className="minecraft-viewer">
      <div className="viewer-header">
        <h1>Minecraft Skin Viewer</h1>
        <p>3D スキンの表示・回転・ズーム・アニメーションをサポートします</p>
      </div>

      <div className="viewer-container">
        <div className="canvas-area">
          <div className="viewer-canvas" ref={containerRef} />
        </div>

        <aside className="control-section">
          <div className="tabs">
            <button className={`tab ${activeTab === 'viewer' ? 'active' : ''}`} onClick={() => setActiveTab('viewer')}>Image</button>
            <button className={`tab ${activeTab === 'controls' ? 'active' : ''}`} onClick={() => setActiveTab('controls')}>View</button>
            <button className={`tab ${activeTab === 'pose' ? 'active' : ''}`} onClick={() => setActiveTab('pose')}>Pose</button>
            <button className={`tab ${activeTab === 'presets' ? 'active' : ''}`} onClick={() => setActiveTab('presets')}>Presets</button>
          </div>

          {activeTab === 'viewer' && (
            <div className="tab-panel">
              <div className="file-input-group">
                <input type="file" accept="image/png" onChange={onFileChange} />
              </div>
              {fileName && <div className="hint-text">読み込みファイル: {fileName}</div>}
              {error && <div className="error-message">{error}</div>}

              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                <h4 style={{ margin: '0 0 12px 0', color: 'var(--text)' }}>背景設定</h4>

                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>背景タイプ</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input
                        type="radio"
                        name="backgroundType"
                        value="preset"
                        checked={backgroundType === 'preset'}
                        onChange={(e) => setBackgroundType(e.target.value as 'preset')}
                      />
                      プリセット
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input
                        type="radio"
                        name="backgroundType"
                        value="custom"
                        checked={backgroundType === 'custom'}
                        onChange={(e) => setBackgroundType(e.target.value as 'custom')}
                      />
                      カスタム画像
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input
                        type="radio"
                        name="backgroundType"
                        value="panorama"
                        checked={backgroundType === 'panorama'}
                        onChange={(e) => setBackgroundType(e.target.value as 'panorama')}
                      />
                      パノラマ
                    </label>
                  </div>
                </div>

                {backgroundType === 'preset' && (
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>プリセット色</label>
                    <select
                      value={selectedPreset}
                      onChange={(e) => setSelectedPreset(e.target.value)}
                      style={{ width: '100%', padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 4 }}
                    >
                      {Object.entries(backgroundPresets).map(([key, preset]) => (
                        <option key={key} value={key}>{preset.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {(backgroundType === 'custom' || backgroundType === 'panorama') && (
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>
                      {backgroundType === 'custom' ? '背景画像' : 'パノラマ画像'} (PNG/GIF)
                    </label>
                    <input
                      type="file"
                      accept="image/png,image/gif"
                      onChange={onBackgroundFileChange}
                      style={{ width: '100%' }}
                    />
                    {backgroundFileName && <div className="hint-text" style={{ marginTop: 4 }}>読み込みファイル: {backgroundFileName}</div>}
                  </div>
                )}

                <div style={{ marginTop: 12 }}>
                  <button className="btn btn-secondary btn-small" onClick={applyBackground}>
                    背景適用
                  </button>
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                <button className="btn btn-primary" onClick={() => viewerRef.current?.setFrontView?.()}>前面表示</button>
                <button className="btn btn-secondary btn-small" style={{ marginLeft: 8 }} onClick={() => resetView()}>リセット</button>
              </div>
            </div>
          )}

          {activeTab === 'presets' && (
            <div className="tab-panel">
              <div style={{ padding: '12px 0' }}>
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>
                  📸 <strong>プリセット管理:</strong> 現在のカメラ位置・ポーズ・背景を保存して共有可能
                </p>
              </div>

              {/* Screenshot */}
              <div style={{ marginBottom: 16 }}>
                <button className="btn btn-primary" onClick={takeScreenshot} style={{ width: '100%' }}>
                  📸 スクリーンショット撮影
                </button>
              </div>

              {/* Save Current Preset */}
              <div style={{ marginBottom: 16, padding: '12px', background: '#f6f9ff', border: '1px solid rgba(26,115,232,0.1)', borderRadius: '8px' }}>
                <h4 style={{ margin: '0 0 8px 0', color: 'var(--primary)', fontSize: '14px' }}>現在の状態を保存</h4>
                <input
                  type="text"
                  placeholder="プリセット名を入力"
                  value={currentPresetName}
                  onChange={(e) => setCurrentPresetName(e.target.value)}
                  style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--border)', borderRadius: '4px', marginBottom: '8px' }}
                />
                <button
                  className="btn btn-secondary"
                  onClick={saveCurrentPreset}
                  disabled={!currentPresetName.trim()}
                  style={{ width: '100%' }}
                >
                  💾 プリセット保存
                </button>
              </div>

              {/* Import Preset */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: '500' }}>
                  JSONからプリセットをインポート
                </label>
                <input
                  type="file"
                  accept=".json"
                  onChange={importPreset}
                  style={{ width: '100%' }}
                />
              </div>

              {/* Preset List */}
              <div style={{ marginBottom: 16 }}>
                <h4 style={{ margin: '0 0 8px 0', color: 'var(--text)', fontSize: '14px' }}>
                  保存済みプリセット ({presets.length})
                </h4>
                {presets.length === 0 ? (
                  <p style={{ margin: 0, color: 'var(--muted)', fontSize: '13px' }}>
                    まだプリセットが保存されていません
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {presets.map((preset) => (
                      <div key={preset.id} style={{
                        padding: '10px',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        background: 'var(--surface)'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                          <strong style={{ fontSize: '14px', color: 'var(--text)' }}>{preset.name}</strong>
                          <small style={{ color: 'var(--muted)' }}>
                            {new Date(preset.createdAt).toLocaleDateString()}
                          </small>
                        </div>
                        {preset.screenshot && (
                          <div style={{ marginBottom: '8px' }}>
                            <img
                              src={preset.screenshot}
                              alt={`${preset.name} preview`}
                              style={{ width: '100%', height: '60px', objectFit: 'cover', borderRadius: '4px' }}
                            />
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button
                            className="btn btn-primary btn-small"
                            onClick={() => loadPreset(preset)}
                            style={{ flex: 1 }}
                          >
                            適用
                          </button>
                          <button
                            className="btn btn-secondary btn-small"
                            onClick={() => exportPreset(preset)}
                          >
                            📤
                          </button>
                          <button
                            className="btn btn-danger btn-small"
                            onClick={() => deletePreset(preset.id)}
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'controls' && (
            <div className="tab-panel">
              <div className="slider-group">
                <label>ズーム: {zoom.toFixed(2)}x</label>
                <input type="range" min={0.5} max={3} step={0.01} value={zoom} onChange={(e) => setZoomState(Number(e.target.value))} />
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                <label style={{ marginRight: 8 }}>自動回転</label>
                <input type="checkbox" checked={autoRotate} onChange={(e) => setAutoRotateState(e.target.checked)} />
              </div>

            </div>
          )}

          {activeTab === 'pose' && (
            <div className="tab-panel">
              <div style={{ padding: '12px 0' }}>
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>
                  🎛️ <strong>ポーズ編集モード:</strong> モデルをクリックして部位を選択 → スライダーでX/Y/Z軸の回転を調整
                </p>
              </div>
              {selectedPart && (
                <div style={{ background: '#f6f9ff', border: '1px solid rgba(26,115,232,0.1)', borderRadius: 8, padding: 10, marginTop: 8 }}>
                  <strong style={{ color: 'var(--primary)' }}>選択中: {selectedPart}</strong>
                  <div style={{ marginTop: 12 }}>
                    <div className="slider-group" style={{ marginBottom: 8 }}>
                      <label style={{ color: '#ff4444' }}>X軸 (赤): {partRotation.x}°</label>
                      <input
                        type="range"
                        min={-180}
                        max={180}
                        step={1}
                        value={partRotation.x}
                        onChange={(e) => {
                          const newX = Number(e.target.value);
                          setPartRotation(prev => ({ ...prev, x: newX }));
                          try {
                            viewerRef.current?.setPartRotation?.(selectedPart, newX * Math.PI / 180, partRotation.y * Math.PI / 180, partRotation.z * Math.PI / 180);
                          } catch (err) {
                            console.debug('Failed to set part rotation:', err);
                          }
                        }}
                      />
                      <input
                        type="number"
                        min={-180}
                        max={180}
                        step={1}
                        value={partRotation.x}
                        onChange={(e) => {
                          const newX = Math.max(-180, Math.min(180, Number(e.target.value) || 0));
                          setPartRotation(prev => ({ ...prev, x: newX }));
                          try {
                            viewerRef.current?.setPartRotation?.(selectedPart, newX * Math.PI / 180, partRotation.y * Math.PI / 180, partRotation.z * Math.PI / 180);
                          } catch (err) {
                            console.debug('Failed to set part rotation:', err);
                          }
                        }}
                        style={{ width: '60px', marginLeft: '8px', padding: '2px 4px', border: '1px solid var(--border)', borderRadius: '3px', fontSize: '12px' }}
                      />
                    </div>
                    <div className="slider-group" style={{ marginBottom: 8 }}>
                      <label style={{ color: '#44ff44' }}>Y軸 (緑): {partRotation.y}°</label>
                      <input
                        type="range"
                        min={-180}
                        max={180}
                        step={1}
                        value={partRotation.y}
                        onChange={(e) => {
                          const newY = Number(e.target.value);
                          setPartRotation(prev => ({ ...prev, y: newY }));
                          try {
                            viewerRef.current?.setPartRotation?.(selectedPart, partRotation.x * Math.PI / 180, newY * Math.PI / 180, partRotation.z * Math.PI / 180);
                          } catch (err) {
                            console.debug('Failed to set part rotation:', err);
                          }
                        }}
                      />
                      <input
                        type="number"
                        min={-180}
                        max={180}
                        step={1}
                        value={partRotation.y}
                        onChange={(e) => {
                          const newY = Math.max(-180, Math.min(180, Number(e.target.value) || 0));
                          setPartRotation(prev => ({ ...prev, y: newY }));
                          try {
                            viewerRef.current?.setPartRotation?.(selectedPart, partRotation.x * Math.PI / 180, newY * Math.PI / 180, partRotation.z * Math.PI / 180);
                          } catch (err) {
                            console.debug('Failed to set part rotation:', err);
                          }
                        }}
                        style={{ width: '60px', marginLeft: '8px', padding: '2px 4px', border: '1px solid var(--border)', borderRadius: '3px', fontSize: '12px' }}
                      />
                    </div>
                    <div className="slider-group" style={{ marginBottom: 8 }}>
                      <label style={{ color: '#4444ff' }}>Z軸 (青): {partRotation.z}°</label>
                      <input
                        type="range"
                        min={-180}
                        max={180}
                        step={1}
                        value={partRotation.z}
                        onChange={(e) => {
                          const newZ = Number(e.target.value);
                          setPartRotation(prev => ({ ...prev, z: newZ }));
                          try {
                            viewerRef.current?.setPartRotation?.(selectedPart, partRotation.x * Math.PI / 180, partRotation.y * Math.PI / 180, newZ * Math.PI / 180);
                          } catch (err) {
                            console.debug('Failed to set part rotation:', err);
                          }
                        }}
                      />
                      <input
                        type="number"
                        min={-180}
                        max={180}
                        step={1}
                        value={partRotation.z}
                        onChange={(e) => {
                          const newZ = Math.max(-180, Math.min(180, Number(e.target.value) || 0));
                          setPartRotation(prev => ({ ...prev, z: newZ }));
                          try {
                            viewerRef.current?.setPartRotation?.(selectedPart, partRotation.x * Math.PI / 180, partRotation.y * Math.PI / 180, newZ * Math.PI / 180);
                          } catch (err) {
                            console.debug('Failed to set part rotation:', err);
                          }
                        }}
                        style={{ width: '60px', marginLeft: '8px', padding: '2px 4px', border: '1px solid var(--border)', borderRadius: '3px', fontSize: '12px' }}
                      />
                    </div>
                  </div>
                </div>
              )}
              <div style={{ marginTop: 12 }}>
                <button className="btn btn-secondary" onClick={() => { try { viewerRef.current?.setFrontView?.(); } catch {} }} style={{ width: '100%' }}>前面表示</button>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};

export default MinecraftViewerEnhanced;


