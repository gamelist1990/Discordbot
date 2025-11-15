import React, { useEffect, useRef, useState } from 'react';
import { createSkin3dViewer } from './skin3dWrapper.js';
import './styles/index.css';

const PRESETS_STORAGE_KEY = 'minecraft-viewer-presets';

// localStorage utilities
const loadPresetsFromStorage = (): Array<{
  id: string;
  name: string;
  camera: any;
  pose: any;
  background: { type: string; preset?: string; customUrl?: string };
  screenshot?: string;
  partVisibility?: Record<string, boolean>;
  createdAt: string;
}> => {
  try {
    const stored = localStorage.getItem(PRESETS_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('Failed to load presets from localStorage:', error);
    return [];
  }
};

const savePresetsToStorage = (presets: Array<{
  id: string;
  name: string;
  camera: any;
  pose: any;
  background: { type: string; preset?: string; customUrl?: string };
  screenshot?: string;
  partVisibility?: Record<string, boolean>;
  createdAt: string;
}>) => {
  try {
    localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
  } catch (error) {
    console.error('Failed to save presets to localStorage:', error);
  }
};

const MinecraftViewerEnhanced = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<any>(null);
  const [fileName, setFileName] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'viewer'|'controls'|'pose'|'presets'|'frames'>('viewer');
  // コマドリ用state
  type Frame = {
    id: string;
    pose: any;
    camera: any;
    background: { type: string; preset?: string; customUrl?: string };
    thumb?: string;
    createdAt: string;
  };

  // Import frames JSON (array of frames) and merge into current frames
  const importFrames = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target?.result as string);
        const toAdd: Frame[] = [];
        if (Array.isArray(parsed)) {
          parsed.forEach((item: any) => {
            if (!item || typeof item !== 'object') return;
            // basic validation: must have pose and camera
            if (!item.pose || !item.camera) return;
            toAdd.push({
              id: item.id || (Date.now().toString() + Math.random().toString(36).slice(2)),
              pose: item.pose,
              camera: item.camera,
              background: item.background || { type: 'preset', preset: 'white' },
              thumb: item.thumb,
              createdAt: item.createdAt || new Date().toISOString()
            });
          });
        } else if (parsed && typeof parsed === 'object') {
          // single frame object
          const item = parsed;
          if (item.pose && item.camera) {
            toAdd.push({
              id: item.id || (Date.now().toString() + Math.random().toString(36).slice(2)),
              pose: item.pose,
              camera: item.camera,
              background: item.background || { type: 'preset', preset: 'white' },
              thumb: item.thumb,
              createdAt: item.createdAt || new Date().toISOString()
            });
          }
        }

        if (toAdd.length === 0) {
          setError('インポートされたファイルに有効なフレームが含まれていません');
        } else {
          setFrames(prev => [...prev, ...toAdd]);
          setError(null);
        }
      } catch (err) {
        console.error('importFrames failed', err);
        setError('フレームのインポートに失敗しました');
      }
    };
    reader.readAsText(file);
    // reset input
    event.target.value = '';
  };

  // Clear all frames
  const clearAllFrames = () => {
    if (!confirm('全てのコマを削除しますか？この操作は取り消せません。')) return;
    setFrames([]);
    setActiveFrameIndex(0);
  };

  // Preview (play) frames sequentially
  const playPreview = async () => {
    if (!viewerRef.current || frames.length === 0) return;
    if (isPlayingRef.current) return; // already playing
    isPlayingRef.current = true;
    setIsPlaying(true);
    const fps = exportFPS || 30;
    const delay = Math.max(50, Math.round(1000 / fps));
    try {
      for (let i = 0; i < frames.length; i++) {
        if (!isPlayingRef.current) break;
        const f = frames[i];
        try { if (f.camera) viewerRef.current?.setCameraState?.(f.camera); } catch (e) {}
        try { if (f.pose) viewerRef.current?.setPoseState?.(f.pose); } catch (e) {}
        try {
          if (f.background && f.background.type === 'preset' && f.background.preset) {
            const presetColor = backgroundPresets[f.background.preset as keyof typeof backgroundPresets];
            if (presetColor) viewerRef.current?.setBackgroundColor?.(presetColor.color);
          }
        } catch (e) {}
        setActiveFrameIndex(i);
        // wait for rendering
        await new Promise(r => setTimeout(r, delay));
      }
    } catch (e) {
      console.error('playPreview failed', e);
    }
    isPlayingRef.current = false;
    setIsPlaying(false);
  };

  const stopPreview = () => {
    isPlayingRef.current = false;
    setIsPlaying(false);
  };
  const [frames, setFrames] = useState<Frame[]>([]);
  const [, setActiveFrameIndex] = useState<number>(0);
  // UI for large frame lists
  // Show clamped (scroll) list already when 3 or more frames to avoid UI overflow on narrow layouts
  const FRAME_SCROLL_THRESHOLD = 3; // above this, clamp list and show "もっと見る"
  const [showFullScreenFrames, setShowFullScreenFrames] = useState<boolean>(false);
  const [exportFormat, setExportFormat] = useState<'webm'|'json'>('webm');
  const [exportFPS, setExportFPS] = useState<15|30>(30);
  const workerRef = useRef<Worker | null>(null);
  // Preview / playback state
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const isPlayingRef = useRef<boolean>(false);

  useEffect(() => {
    try {
      // Vite-compatible worker URL
      const w = new Worker(new URL('./thumbnailWorker.js', import.meta.url), { type: 'module' });
      workerRef.current = w;
    } catch (e) {
      // fallback: worker may not be available
      console.debug('Failed to create thumbnail worker', e);
      workerRef.current = null;
    }
    return () => {
      try { workerRef.current?.terminate(); } catch (e) {}
      workerRef.current = null;
    };
  }, []);

  // コマ追加
  const addFrame = async () => {
    if (!viewerRef.current) return;
    try {
      const pose = viewerRef.current.getPoseState?.();
      const camera = viewerRef.current.getCameraState?.();
      const thumb = await viewerRef.current.takeScreenshot?.();
      const background = { type: backgroundType, preset: backgroundType === 'preset' ? selectedPreset : undefined, customUrl: backgroundType !== 'preset' ? backgroundFileName : undefined };
      const frame: Frame = {
        id: Date.now().toString() + Math.random().toString(36).slice(2),
        pose, camera, background, thumb, createdAt: new Date().toISOString()
      };
      setFrames(prev => [...prev, frame]);
    } catch (e) { setError('コマ追加に失敗しました'); }
  };

  // フレームを更新

  // サムネ生成（各フレームの状態を適用してスクリーンショットを取得）

  // コマ削除
  const removeFrame = (idx: number) => {
    setFrames(prev => prev.filter((_, i) => i !== idx));
  };

  // コマ順序入替
  const moveFrame = (from: number, to: number) => {
    setFrames(prev => {
      if (to < 0 || to >= prev.length) return prev;
      const arr = [...prev];
      const [f] = arr.splice(from, 1);
      arr.splice(to, 0, f);
      return arr;
    });
  };

  // コマエクスポート（json仮）
  const exportFrames = async () => {
    if (frames.length === 0) return;
    if (exportFormat === 'json') {
      const dataStr = JSON.stringify(frames, null, 2);
      const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
      const exportFileDefaultName = `frames_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      const linkElement = document.createElement('a');
      linkElement.setAttribute('href', dataUri);
      linkElement.setAttribute('download', exportFileDefaultName);
      linkElement.click();
      return;
    }

    // WebM export via MediaRecorder by applying frames sequentially and recording the canvas
    try {
      const canvasArea = containerRef.current;
      if (!canvasArea) { setError('キャンバスが見つかりません'); return; }
      const canvas = canvasArea.querySelector('canvas') as HTMLCanvasElement | null;
      if (!canvas) { setError('Canvas要素が見つかりません'); return; }

  const fps = exportFPS || 30;
  const stream = (canvas as any).captureStream ? (canvas as any).captureStream(fps) : null;
      if (!stream) { setError('ブラウザがMediaRecorderをサポートしていません'); return; }

      const options: any = { mimeType: 'video/webm;codecs=vp9' };
      let recordedChunks: BlobPart[] = [];
      const mr = new MediaRecorder(stream, options);
      mr.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordedChunks.push(e.data); };

  const frameDelay = Math.max(50, Math.round(1000 / (exportFPS || 30))); // ms per frame ~ 1000/fps
      mr.start();

      // apply each frame and wait
      for (let i = 0; i < frames.length; i++) {
        const f = frames[i];
        try { if (f.camera) viewerRef.current?.setCameraState?.(f.camera); } catch {}
        try { if (f.pose) viewerRef.current?.setPoseState?.(f.pose); } catch {}
        try {
          if (f.background && f.background.type === 'preset' && f.background.preset) {
            const presetColor = backgroundPresets[f.background.preset as keyof typeof backgroundPresets];
            if (presetColor) viewerRef.current?.setBackgroundColor?.(presetColor.color);
          }
        } catch {}

        // wait for rendering (RAF + frameDelay)
        await new Promise(r => requestAnimationFrame(() => setTimeout(r, frameDelay)));
      }

      // stop recorder after a short buffer
      await new Promise(r => setTimeout(r, 200));
      mr.stop();

      const blob = await new Promise<Blob | null>((resolve) => {
        mr.onstop = () => {
          if (recordedChunks.length === 0) return resolve(null);
          resolve(new Blob(recordedChunks, { type: 'video/webm' }));
        };
      });

      if (!blob) { setError('録画データの生成に失敗しました'); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `minecraft_frames_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('exportFrames failed', e);
      setError('エクスポートに失敗しました');
    }
  };
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
    partVisibility?: Record<string, boolean>;
    createdAt: string;
  }>>(loadPresetsFromStorage);
  const [currentPresetName, setCurrentPresetName] = useState<string>('');
  const bodyParts = ['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'] as const;
  const [partVisibility, setPartVisibility] = useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {};
    bodyParts.forEach(p => map[p] = true);
    return map;
  });

  // detect mobile / touch devices to disable JS-based screenshot (use OS long-press instead)
  const [isMobile, setIsMobile] = useState<boolean>(false);
  useEffect(() => {
    try {
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
      const touch = typeof window !== 'undefined' && ('ontouchstart' in window || (navigator as any).maxTouchPoints > 0);
      const mobileUa = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
      setIsMobile(!!touch || mobileUa);
    } catch (e) { setIsMobile(false); }
  }, []);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [isExportingImage, setIsExportingImage] = useState<boolean>(false);
  const [isExportingGLB, setIsExportingGLB] = useState<boolean>(false);

  const openImageForSaveMobile = async () => {
    try {
      const canvasArea = containerRef.current;
      if (!canvasArea) {
        setError('キャンバスが見つかりません');
        return;
      }
      const srcCanvas = canvasArea.querySelector('canvas') as HTMLCanvasElement | null;
      if (!srcCanvas) {
        setError('キャンバス要素が見つかりません');
        return;
      }

      // scale down to reasonable width to avoid memory issues on mobile
      const MAX_WIDTH = 1200;
      const ratio = Math.min(1, MAX_WIDTH / (srcCanvas.width || srcCanvas.clientWidth || 1));
      const w = Math.max(1, Math.floor((srcCanvas.width || srcCanvas.clientWidth) * ratio));
      const h = Math.max(1, Math.floor((srcCanvas.height || srcCanvas.clientHeight) * ratio));

      const tmp = document.createElement('canvas');
      tmp.width = w;
      tmp.height = h;
      const ctx = tmp.getContext('2d');
      if (!ctx) {
        setError('画像生成に失敗しました');
        return;
      }

      try {
        ctx.drawImage(srcCanvas, 0, 0, w, h);
      } catch (e) {
        // drawImage may fail if canvas is tainted; try using toDataURL on source canvas directly
        try {
          const dataUrl = srcCanvas.toDataURL('image/png');
          setScreenshotPreview(dataUrl);
          return;
        } catch (err) {
          console.error('drawImage/toDataURL failed', err);
          setError('画像生成に失敗しました');
          return;
        }
      }

      try {
        const dataUrl = tmp.toDataURL('image/png');
        setScreenshotPreview(dataUrl);
      } catch (e) {
        console.error('toDataURL failed', e);
        setError('画像生成に失敗しました');
      }
    } catch (e) {
      console.error('openImageForSaveMobile failed', e);
      setError('画像生成に失敗しました');
    }
  };

  const exportImageHighRes = async (scale?: number) => {
    try {
      setIsExportingImage(true);
      if (!viewerRef.current) { setError('ビューアが準備されていません'); return; }
      const blob = await viewerRef.current.exportImage?.(scale);
      if (!blob) { setError('画像のエクスポートに失敗しました'); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `minecraft_skin_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setError(null);
    } catch (e) {
      console.error('exportImageHighRes failed', e);
      setError('画像のエクスポートに失敗しました');
    }
    finally {
      setIsExportingImage(false);
    }
  };

  const exportGLBHandler = async () => {
    try {
      setIsExportingGLB(true);
      if (!viewerRef.current) { setError('ビューアが準備されていません'); return; }
      // Quick check: if viewer does not expose a skinned mesh, warn the user that bones won't be included
      try {
        const internal = viewerRef.current._viewer;
        let foundSkinned = false;
        if (internal && typeof internal.traverse === 'function') {
          internal.traverse((o: any) => { if (!foundSkinned && o && o.isSkinnedMesh) foundSkinned = true; });
        }
        if (!foundSkinned) {
          const ok = confirm('このモデルにはスキンのスケルトン（ボーン）が含まれていない可能性があります。GLB（glTF）にボーンが含まれない場合がありますが続行しますか？');
          if (!ok) { setIsExportingGLB(false); return; }
        }
      } catch (e) { /* non-critical */ }
      // call wrapper export
      // Prefer GLB exporter (glTF binary). Older viewer APIs still exportFBX alias -> GLB.
      const blob = await viewerRef.current.exportGLB?.({ includeBones: true }) ?? await viewerRef.current.exportFBX?.({ includeBones: true });
      if (!blob) { setError('モデルのエクスポートに失敗しました'); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const ext = blob.type === 'model/gltf-binary' ? 'glb' : 'bin';
      a.download = `minecraft_model_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setError(null);
    } catch (e) {
      console.error('exportGLBHandler failed', e);
      setError('モデルのエクスポートに失敗しました');
    }
    finally {
      setIsExportingGLB(false);
    }
  };

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
        // refresh part visibility UI from viewer if possible
        try {
          const vis: Record<string, boolean> = {};
          bodyParts.forEach(p => {
            try {
              const v = handle.isPartVisible?.(p);
              vis[p] = typeof v === 'boolean' ? v : true;
            } catch (e) { vis[p] = true; }
          });
          setPartVisibility(vis);
        } catch (e) { }
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

  // Save presets to localStorage whenever presets change
  useEffect(() => {
    savePresetsToStorage(presets);
  }, [presets]);

  const handleTogglePart = (part: string, visible: boolean) => {
    setPartVisibility(prev => ({ ...prev, [part]: visible }));
    try { viewerRef.current?.setPartVisibility?.(part, visible); } catch (e) { console.debug('setPartVisibility failed', e); }
  };

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
        // refresh part visibility from viewer
        try {
          const vis: Record<string, boolean> = {};
          bodyParts.forEach(p => {
            try { const v = viewerRef.current?.isPartVisible?.(p); vis[p] = typeof v === 'boolean' ? v : true; } catch (e) { vis[p] = true; }
          });
          setPartVisibility(vis);
        } catch (e) {}
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
    transparent: { name: '透過', color: 'transparent' as const },
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
        partVisibility: partVisibility,
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

      // Apply part visibility if present
      try {
        if (preset.partVisibility && typeof preset.partVisibility === 'object') {
          Object.entries(preset.partVisibility).forEach(([part, v]) => {
            try { viewerRef.current?.setPartVisibility?.(part, !!v); } catch (e) { }
          });
          // update UI state
          try { setPartVisibility(preset.partVisibility as Record<string, boolean>); } catch (e) { }
        }
      } catch (e) { }

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
    reader.readAsText(file);
    // Reset input
    event.target.value = '';
  };

  const takeScreenshot = async () => {
    try {
      console.log('takeScreenshot called');

      // canvas-area内のcanvas要素を取得
      const canvasArea = containerRef.current;
      if (!canvasArea) {
        console.error('Canvas area not found');
        setError('キャンバスが見つかりません');
        return;
      }

      const canvas = canvasArea.querySelector('canvas') as HTMLCanvasElement;
      if (!canvas) {
        console.error('Canvas element not found');
        setError('キャンバス要素が見つかりません');
        return;
      }

      console.log('Canvas info:', {
        width: canvas.width,
        height: canvas.height,
        clientWidth: canvas.clientWidth,
        clientHeight: canvas.clientHeight
      });

      // skin3d viewerインスタンスからスクリーンショットを取得
      if (viewerRef.current && viewerRef.current.takeScreenshot) {
        console.log('Using skin3d wrapper takeScreenshot');
        try {
          const dataUrl = await viewerRef.current.takeScreenshot();
          console.log('Screenshot taken via skin3d wrapper, length=', dataUrl?.length);

          // Basic sanity checks
          if (!dataUrl || typeof dataUrl !== 'string' || dataUrl.length < 100) {
            console.warn('takeScreenshot returned an unexpected data URL; falling back to canvas.toBlob if possible', dataUrl);
            // fallthrough to canvas.toBlob below
          } else {
            // Convert data URL -> Blob without using fetch (more reliable across browsers)
            try {
              const dataToBlob = (dUrl: string) => {
                const parts = dUrl.split(',');
                const meta = parts[0] || '';
                const b64 = parts[1] || '';
                const m = meta.match(/:(.*?);/);
                const mime = m ? m[1] : 'image/png';
                const binary = atob(b64);
                const len = binary.length;
                const u8 = new Uint8Array(len);
                for (let i = 0; i < len; i++) u8[i] = binary.charCodeAt(i);
                return new Blob([u8], { type: mime });
              };

              const blob = dataToBlob(dataUrl);
              console.log('Converted dataURL to blob, size=', blob.size);

              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = `minecraft_skin_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.png`;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              URL.revokeObjectURL(url);

              console.log('Download initiated via skin3d wrapper');
              setError(null);
              return;
            } catch (err) {
              console.error('skin3d wrapper screenshot conversion failed:', err);
              // fallthrough to canvas.toBlob fallback below
            }
          }
        } catch (error) {
          console.error('skin3d wrapper screenshot failed:', error);
          setError('スクリーンショットの取得に失敗しました');
          return;
        }
      }

      // フォールバック: 直接canvas.toBlob()を使用
      console.log('No skin3d wrapper available, using direct canvas.toBlob');
      canvas.toBlob((blob) => {
        if (!blob) {
          setError('スクリーンショットの作成に失敗しました');
          return;
        }

        console.log('Blob created via direct toBlob:', { size: blob.size, type: blob.type });

        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `minecraft_skin_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        console.log('Download initiated via direct toBlob');
        setError(null);
      }, 'image/png');

    } catch (err) {
      console.error('Screenshot failed:', err);
      setError('スクリーンショットの撮影に失敗しました');
    }
  };

  const closeScreenshotPreview = () => setScreenshotPreview(null);

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
            <button className={`tab ${activeTab === 'frames' ? 'active' : ''}`} onClick={() => setActiveTab('frames')}>コマドリ</button>
            <button className={`tab ${activeTab === 'presets' ? 'active' : ''}`} onClick={() => setActiveTab('presets')}>Presets</button>
          </div>
          {activeTab === 'frames' && (
            <div className="tab-panel">
              <div style={{ padding: '12px 0' }}>
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>
                  🎬 <strong>コマドリ（アニメーション用フレーム）</strong><br />
                  ポーズ・カメラ・背景を「コマ」として保存し、後でmp4/gif化できます（エクスポートはjson仮）
                </p>
              </div>
              <div style={{ marginBottom: 16 }}>
                <button className="btn btn-primary" style={{ width: '100%' }} onClick={addFrame}>
                  ＋ 現在の状態をコマとして追加
                </button>
              </div>
              <div style={{ marginBottom: 16 }}>
                <h4 style={{ margin: '0 0 8px 0', color: 'var(--text)', fontSize: '14px' }}>
                  コマリスト（{frames.length}）
                </h4>
                {frames.length === 0 ? (
                  <p style={{ margin: 0, color: 'var(--muted)', fontSize: '13px' }}>
                    まだコマが追加されていません
                  </p>
                ) : (
                  <>
                    {/* Clamp list into a scrollable area when many frames */}
                    <div className={`frame-list ${frames.length > FRAME_SCROLL_THRESHOLD ? 'clamped' : ''}`}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {frames.map((frame, idx) => (
                          <div key={frame.id} className="frame-list-item">
                            <div className="frame-thumb">
                              {frame.thumb ? <img src={frame.thumb} alt="thumb" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ color: '#bbb', fontSize: 12 }}>No Image</span>}
                            </div>
                            <div className="frame-meta">
                              <div className="frame-meta-title">Frame {idx + 1}</div>
                              <div className="frame-meta-date">{new Date(frame.createdAt).toLocaleString()}</div>
                            </div>
                            <div className="frame-actions">
                              <button className="btn btn-secondary btn-small" style={{ fontSize: 13 }} onClick={() => moveFrame(idx, idx-1)} disabled={idx===0}>↑</button>
                              <button className="btn btn-secondary btn-small" style={{ fontSize: 13 }} onClick={() => moveFrame(idx, idx+1)} disabled={idx===frames.length-1}>↓</button>
                              <button className="btn btn-danger btn-small" style={{ fontSize: 13 }} onClick={() => removeFrame(idx)}>🗑️</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Show 'もっと見る' when list is long */}
                    {frames.length > FRAME_SCROLL_THRESHOLD && (
                      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                        <button className="btn btn-secondary" onClick={() => setShowFullScreenFrames(true)} style={{ flex: 1 }}>もっと見る</button>
                      </div>
                    )}

                    {/* Fullscreen modal for frame management */}
                    {showFullScreenFrames && (
                      <div className="frame-modal">
                        <div className="frame-modal-content">
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                            <h3 style={{ margin: 0 }}>コマ一覧（全画面プレビュー）</h3>
                            <div style={{ display: 'flex', gap: 8 }}>
                              <button className="btn btn-secondary" onClick={() => setShowFullScreenFrames(false)}>閉じる</button>
                            </div>
                          </div>
                          <div className="frame-modal-grid">
                            {frames.map((frame, idx) => (
                              <div key={frame.id} className="frame-list-item">
                                <div className="frame-thumb" style={{ width: 96, height: 96 }}>
                                  {frame.thumb ? <img src={frame.thumb} alt="thumb" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ color: '#bbb', fontSize: 12 }}>No Image</span>}
                                </div>
                                <div className="frame-meta">
                                  <div className="frame-meta-title">Frame {idx + 1}</div>
                                  <div className="frame-meta-date">{new Date(frame.createdAt).toLocaleString()}</div>
                                </div>
                                <div className="frame-actions">
                                  <button className="btn btn-secondary btn-small" onClick={() => { moveFrame(idx, idx-1); }} disabled={idx===0}>↑</button>
                                  <button className="btn btn-secondary btn-small" onClick={() => { moveFrame(idx, idx+1); }} disabled={idx===frames.length-1}>↓</button>
                                  <button className="btn btn-danger btn-small" onClick={() => { removeFrame(idx); }} >🗑️</button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
              <div style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <select value={exportFormat} onChange={(e) => setExportFormat(e.target.value as any)} style={{ flex: 1, padding: '8px', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <option value="webm">WebM (動画)</option>
                      <option value="json">JSON (フレーム単位のデータ)</option>
                    </select>
                    <select value={exportFPS} onChange={(e) => setExportFPS(Number(e.target.value) as 15|30)} style={{ width: 100, padding: '8px', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <option value={30}>30 FPS</option>
                      <option value={15}>15 FPS</option>
                    </select>
                  </div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <input type="file" accept=".json" onChange={importFrames} style={{ flex: 1 }} />
                  <button className="btn btn-danger" onClick={clearAllFrames} disabled={frames.length===0}>一括クリア</button>
                </div>

                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  {isPlaying ? (
                    <button className="btn btn-secondary" style={{ flex: 1 }} onClick={stopPreview}>停止</button>
                  ) : (
                    <button className="btn btn-primary" style={{ flex: 1 }} onClick={playPreview} disabled={frames.length===0}>プレビュー再生</button>
                  )}
                </div>

                <button className="btn btn-primary" style={{ width: '100%' }} onClick={exportFrames} disabled={frames.length===0}>
                  エクスポート
                </button>
              </div>
            </div>
          )}

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
                <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                  <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => exportImageHighRes(2)} disabled={isExportingImage}>{isExportingImage ? '書き出し中...' : 'PNG 2x'}</button>
                  <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => exportGLBHandler()} disabled={isExportingGLB}>{isExportingGLB ? '書き出し中...' : '📦 GLB'}</button>
                </div>
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
                {!isMobile ? (
                  <button className="btn btn-primary" onClick={takeScreenshot} style={{ width: '100%' }}>
                    📸 スクリーンショット撮影
                  </button>
                ) : (
                  <div style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
                    <div style={{ padding: '10px', background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 8 }}>
                      <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
                        モバイルではブラウザ/OS のスクリーンショット機能または画像の長押しで保存してください。
                      </p>
                    </div>
                    <button className="btn btn-secondary" onClick={openImageForSaveMobile} style={{ width: '100%' }}>
                      画像を表示（長押しで保存）
                    </button>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button className="btn btn-secondary" onClick={() => exportImageHighRes(1)} style={{ flex: 1 }} disabled={isExportingImage}>{isExportingImage ? '書き出し中...' : 'PNG 1x'}</button>
                  <button className="btn btn-secondary" onClick={() => exportImageHighRes(2)} style={{ flex: 1 }} disabled={isExportingImage}>{isExportingImage ? '書き出し中...' : 'PNG 2x'}</button>
                  <button className="btn btn-secondary" onClick={() => exportImageHighRes(4)} style={{ flex: 1 }} disabled={isExportingImage}>{isExportingImage ? '書き出し中...' : 'PNG 4x'}</button>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button className="btn btn-secondary" onClick={() => exportGLBHandler()} style={{ width: '100%' }} disabled={isExportingGLB}>{isExportingGLB ? '書き出し中...' : '📦 GLBでダウンロード (.glb)'}</button>
                </div>
                <div style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)' }}>※ 注意: ボーン(スケルトン)は viewer が SkinnedMesh として提供している場合に含まれます。含まれていない場合はボーンなしのメッシュ単体で出力されます。</div>
              </div>

              {/* Save Current Preset */}
                {/* Part visibility toggles */}
                <div style={{ marginBottom: 12, padding: '8px', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--surface)' }}>
                  <h4 style={{ margin: '0 0 8px 0', color: 'var(--text)', fontSize: '13px' }}>部位の表示/非表示</h4>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {bodyParts.map((p) => (
                      <label key={p} className="part-toggle-label">
                        <input
                          className="part-toggle-checkbox"
                          type="checkbox"
                          checked={!!partVisibility[p]}
                          onChange={(e) => handleTogglePart(p, e.target.checked)}
                        />
                        <span className="part-toggle-name">{p}</span>
                      </label>
                    ))}
                  </div>
                </div>
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

      {screenshotPreview && (
        <div className="dialog-overlay" onClick={closeScreenshotPreview}>
          <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
            <h4>画像プレビュー</h4>
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>画像を長押しして保存してください。</p>
            <div style={{ marginTop: 12, textAlign: 'center' }}>
              <img src={screenshotPreview} alt="preview" style={{ maxWidth: '100%', borderRadius: 8 }} />
            </div>
            <div className="dialog-actions" style={{ marginTop: 12 }}>
              <button className="btn btn-secondary" onClick={closeScreenshotPreview}>閉じる</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MinecraftViewerEnhanced;

