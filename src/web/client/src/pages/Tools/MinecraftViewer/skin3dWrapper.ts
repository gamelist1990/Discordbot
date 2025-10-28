// Lightweight wrapper around the `skin3d` library.
// Provides createSkin3dViewer(container) -> { loadSkin(url), destroy(), el }
export type SkinViewerHandle = {
  loadSkin: (url: string) => Promise<void>;
  destroy: () => void;
  el: HTMLElement | null;
  // force the viewer into a front-facing pose (best-effort)
  setFrontView: () => void;
  // Controls
  setZoom?: (z: number) => void;
  setRotation?: (x: number, y: number, z: number) => void;
  setAutoRotate?: (v: boolean) => void;
  enableControls?: (enabled: boolean) => void;
  setFov?: (fov: number) => void;
  // per-part pose control (best-effort)
  setPartRotation?: (part: string, x: number, y: number, z: number) => void;
  // part-picking (click to select parts)
  enablePartPicking?: (enabled: boolean) => void;
  setOnPartSelected?: (cb: (part: string | null) => void) => void;
  // part-picking (get current rotation values for sliders)
  getCurrentPartRotation?: (part: string) => { x: number; y: number; z: number } | null;
  // Pose mode: disable model rotation/zoom, enable part picking
  setPoseMode?: (enabled: boolean) => void;
  // Background settings
  setBackgroundColor?: (color: number) => void;
  loadBackground?: (url: string) => Promise<void>;
  loadPanorama?: (url: string) => Promise<void>;
  // Screenshot functionality
  takeScreenshot?: () => Promise<string>;
  // Camera state management
  getCameraState?: () => { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number }; zoom: number; fov: number } | null;
  setCameraState?: (state: { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number }; zoom: number; fov: number }) => void;
  // Pose state management
  getPoseState?: () => { [part: string]: { x: number; y: number; z: number } };
  setPoseState?: (pose: { [part: string]: { x: number; y: number; z: number } }) => void;
  // Internal access for advanced operations
  _viewer?: View | null;
  // Visibility controls for individual body parts
  setPartVisibility?: (part: string, visible: boolean) => void;
  togglePartVisibility?: (part: string) => void;
  isPartVisible?: (part: string) => boolean;
};

import { View, SkinObject, BodyPart } from 'skin3d';
import { Raycaster, Vector2, Object3D } from 'three';

export async function createSkin3dViewer(container: HTMLElement, opts?: { skin?: string }): Promise<SkinViewerHandle> {
  container.innerHTML = '';
  const el = document.createElement('div');
  el.style.width = '100%';
  el.style.height = '100%';
  el.style.display = 'flex';
  el.style.alignItems = 'center';
  el.style.justifyContent = 'center';
  el.style.position = 'relative'; // for status overlay
  container.appendChild(el);

  // NOTE: Removed DOM status overlay. Use console logging only so the canvas
  // doesn't show transient status messages. This keeps the UI clean while
  // still preserving developer visibility via console.
  function setStatus(msg: string, level: 'info' | 'warn' | 'error' = 'info') {
    if (level === 'error') console.error(msg);
    else if (level === 'warn') console.warn(msg);
    else console.log(msg);
  }

  let viewer: View | null = null;
  // resize observer and sizing function need to be visible to destroy()
  let resizeObserver: ResizeObserver | null = null;
  let applyCanvasSizing: (() => void) | null = null;
  // whether pose mode (part-picking) is active; gesture handlers should back off when true
  let _poseModeEnabled = false;

  try {
  // create a canvas element and pass it to View for proper typing
  const canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  // Prevent the browser from intercepting touch gestures so the viewer can
  // handle rotate/pan/zoom on mobile (important for iOS Safari)
  canvas.style.touchAction = 'none';
  (canvas.style as any)['-webkit-user-select'] = 'none';
  (canvas.style as any)['-webkit-tap-highlight-color'] = 'transparent';
  el.appendChild(canvas);

    // Ensure the internal pixel buffer matches the display size * devicePixelRatio
    applyCanvasSizing = () => {
      try {
        const ratio = (window && window.devicePixelRatio) || 1;
        const rect = el.getBoundingClientRect();
        const w = Math.max(1, Math.floor(rect.width * ratio));
        const h = Math.max(1, Math.floor(rect.height * ratio));
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
      } catch (e) { /* ignore sizing errors */ }
    };
    // initial size
    applyCanvasSizing();
    // keep size in sync on resize
    try {
      resizeObserver = new ResizeObserver(() => applyCanvasSizing && applyCanvasSizing());
      resizeObserver.observe(el);
    } catch (e) {
      // fallback to window resize
      window.addEventListener('resize', () => applyCanvasSizing && applyCanvasSizing());
    }

    // --- touch gesture handling for mobile (one finger = rotate, two fingers = pan/zoom) ---
    // gesture state
    const gestureState: any = {
      mode: 'none', // 'none'|'rotate'|'pinch'
      startX: 0,
      startY: 0,
      startRotX: 0,
      startRotY: 0,
      startDist: 0,
      startZoom: 1,
      startMidX: 0,
      startMidY: 0,
      startTarget: { x: 0, y: 0, z: 0 }
    };

    function getViewerAny(): any { return viewer as any; }

    function getModelRotation() {
      const anyViewer = getViewerAny();
      try {
        if (anyViewer.model && anyViewer.model.rotation) return { x: anyViewer.model.rotation.x || 0, y: anyViewer.model.rotation.y || 0, z: anyViewer.model.rotation.z || 0 };
        if (anyViewer.playerWrapper && anyViewer.playerWrapper.rotation) return { x: anyViewer.playerWrapper.rotation.x || 0, y: anyViewer.playerWrapper.rotation.y || 0, z: anyViewer.playerWrapper.rotation.z || 0 };
      } catch (e) { }
      return { x: 0, y: 0, z: 0 };
    }

    function onTouchStart(ev: TouchEvent) {
      try {
        if (_poseModeEnabled) return; // let pose/part-picking handlers run instead
        if (!viewer) return;
        if (!ev.touches || ev.touches.length === 0) return;
        if (ev.touches.length === 1) {
          // rotate
          const t = ev.touches[0];
          gestureState.mode = 'rotate';
          gestureState.startX = t.clientX;
          gestureState.startY = t.clientY;
          const mr = getModelRotation();
          gestureState.startRotX = mr.x;
          gestureState.startRotY = mr.y;
          ev.preventDefault();
        } else if (ev.touches.length >= 2) {
          // pinch/zoom + pan
          const t0 = ev.touches[0];
          const t1 = ev.touches[1];
          const dx = t1.clientX - t0.clientX;
          const dy = t1.clientY - t0.clientY;
          gestureState.startDist = Math.hypot(dx, dy);
          gestureState.startMidX = (t0.clientX + t1.clientX) / 2;
          gestureState.startMidY = (t0.clientY + t1.clientY) / 2;
          gestureState.mode = 'pinch';
          const anyViewer = getViewerAny();
          gestureState.startZoom = (anyViewer && typeof anyViewer.zoom === 'number') ? anyViewer.zoom : ((anyViewer && anyViewer.camera && anyViewer.camera.position) ? anyViewer.camera.position.z : 1);
          // store initial controls target if available
          try { if (anyViewer && anyViewer.controls && anyViewer.controls.target) gestureState.startTarget = { x: anyViewer.controls.target.x, y: anyViewer.controls.target.y, z: anyViewer.controls.target.z }; } catch (e) {}
          ev.preventDefault();
        }
      } catch (e) { }
    }

    function onTouchMove(ev: TouchEvent) {
      try {
        if (_poseModeEnabled) return;
        if (!viewer) return;
        const anyViewer = getViewerAny();
        if (gestureState.mode === 'rotate' && ev.touches && ev.touches.length === 1) {
          const t = ev.touches[0];
          const dx = t.clientX - gestureState.startX;
          const dy = t.clientY - gestureState.startY;
          // sensitivity tuned for UX; adjust if needed
          const sens = 0.01;
          const newRotX = gestureState.startRotX + (dy * sens);
          const newRotY = gestureState.startRotY + (dx * sens);
          try {
            // try viewer-level API
            anyViewer.setRotation ? anyViewer.setRotation(newRotX, newRotY, 0) : (anyViewer.playerWrapper && (anyViewer.playerWrapper.rotation.x = newRotX, anyViewer.playerWrapper.rotation.y = newRotY));
          } catch (e) { }
          ev.preventDefault();
        } else if (gestureState.mode === 'pinch' && ev.touches && ev.touches.length >= 2) {
          const t0 = ev.touches[0];
          const t1 = ev.touches[1];
          const dx = t1.clientX - t0.clientX;
          const dy = t1.clientY - t0.clientY;
          const dist = Math.hypot(dx, dy);
          const scale = gestureState.startDist > 0 ? (dist / gestureState.startDist) : 1;
          const newZoom = (gestureState.startZoom || 1) * scale;
          try { if (typeof anyViewer.setZoom === 'function') anyViewer.setZoom(newZoom); else if (anyViewer.setZoom) anyViewer.setZoom = newZoom; } catch (e) { }

          // two-finger pan: compute midpoint movement
          const midX = (t0.clientX + t1.clientX) / 2;
          const midY = (t0.clientY + t1.clientY) / 2;
          const ddx = midX - gestureState.startMidX;
          const ddy = midY - gestureState.startMidY;
          // translate screen movement to world offset using camera distance heuristic
          try {
            const camDist = (anyViewer.camera && anyViewer.camera.position && anyViewer.camera.position.z) ? anyViewer.camera.position.z : 1000;
            const factor = (camDist / 1000) * 0.002; // tuned factor
            if (anyViewer.controls && anyViewer.controls.target) {
              anyViewer.controls.target.x = gestureState.startTarget.x - ddx * factor;
              anyViewer.controls.target.y = gestureState.startTarget.y + ddy * factor;
              anyViewer.controls.update && anyViewer.controls.update();
            }
          } catch (e) { }
          ev.preventDefault();
        }
      } catch (e) { }
    }

    function onTouchEnd(_ev: TouchEvent) {
      try {
        if (_poseModeEnabled) return;
        if (!viewer) return;
        if (!(_poseModeEnabled)) {
          if ((_ev as any).touches && (_ev as any).touches.length > 0) {
            // still have touches; keep state
          } else {
            gestureState.mode = 'none';
          }
        }
      } catch (e) { }
    }

    try {
      el.addEventListener('touchstart', onTouchStart as any, { passive: false } as any);
      el.addEventListener('touchmove', onTouchMove as any, { passive: false } as any);
      el.addEventListener('touchend', onTouchEnd as any, { passive: false } as any);
      // store refs for cleanup
      (el as any).__skin3d_touch_handlers = { onTouchStart, onTouchMove, onTouchEnd };
    } catch (e) { }

    try {
      if (!canvas.width || !canvas.height) {
        setStatus('注意: canvas サイズが 0 です。親要素のサイズを確認してください', 'warn');
      }
      // Try to request a drawing buffer that preserves content after present so
      // readPixels/toDataURL are more reliable. Different versions of View/skin3d
      // accept different option shapes; cast to any to avoid TypeScript type errors
      // while still attempting to enable preserveDrawingBuffer.
      const viewOptions: any = {
        canvas,
        width: canvas.width,
        height: canvas.height,
        skin: opts?.skin,
        // common three.js/WebGL option
        preserveDrawingBuffer: true,
        // some wrappers accept nested attributes
        contextAttributes: { preserveDrawingBuffer: true },
        rendererOptions: { preserveDrawingBuffer: true }
      };
      viewer = new View(viewOptions as any);
      setStatus('viewer 初期化 OK', 'info');

      // Attempt to set renderer pixel ratio / size if available to match our canvas
      try {
        const anyViewer: any = viewer;
        const ratio = (window && window.devicePixelRatio) || 1;
        // try multiple common APIs
        if (anyViewer.setPixelRatio) {
          try { anyViewer.setPixelRatio(ratio); } catch {}
        }
        const renderer = anyViewer.renderer || anyViewer._renderer || (anyViewer.view && anyViewer.view.renderer) || null;
        if (renderer) {
          try { renderer.setPixelRatio && renderer.setPixelRatio(ratio); } catch {}
          try {
            const rect = el.getBoundingClientRect();
            const w = Math.max(1, Math.floor(rect.width * ratio));
            const h = Math.max(1, Math.floor(rect.height * ratio));
            renderer.setSize && renderer.setSize(w, h, false);
          } catch (e) { }
        }
      } catch (e) { /* non-critical */ }
    } catch (err) {
      setStatus('viewer の初期化に失敗しました。コンソールを確認してください', 'error');
      console.error('skin3d: failed to create viewer', err);
      viewer = null;
    }
  } catch (e) {
    console.warn('skin3d not available or failed to init:', e);
    viewer = null;
  }

  async function loadSkin(url: string) {
    if (!viewer) {
      setStatus('viewer が初期化されていません', 'error');
      throw new Error('viewer not initialized');
    }

    setStatus('スキン読み込み中...', 'info');
    // Load image first to avoid CORS/format surprises and to ensure a decoded HTMLImageElement
    return new Promise<void>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = async () => {
        try {
          if (typeof viewer!.loadSkin === 'function') {
            // View.loadSkin accepts HTMLImageElement (RemoteImage) and returns a Promise<void>
            await viewer!.loadSkin(img as any);
            setStatus('スキン読み込み完了', 'info');
            // after load, attempt to force a front-facing pose
            try {
              // best-effort: different versions expose different internals
              // try common hooks without hard failure
              // 1) model rotation
              const anyViewer: any = viewer;
              if (anyViewer.model && anyViewer.model.rotation) {
                // reset rotations to show front
                anyViewer.model.rotation.x = 0;
                anyViewer.model.rotation.y = 0;
                anyViewer.model.rotation.z = 0;
              }
              // 2) convenience API
              if (typeof anyViewer.setRotation === 'function') {
                try { anyViewer.setRotation(0, 0, 0); } catch { }
              }
                // 3) camera position (move camera to front if available)
                if (anyViewer.camera && anyViewer.camera.position) {
                  try { anyViewer.camera.position.set(0, 0, Math.max(anyViewer.camera.position.z || 0, 200)); } catch { }
                }
              // 4) ensure orbit/controls are enabled so users can interact
              if (anyViewer.controls && typeof anyViewer.controls.enabled === 'boolean') {
                try { anyViewer.controls.enabled = true; } catch { }
              }
            } catch (e) {
              // ignore; not critical
              console.debug('setFrontView best-effort failed', e);
            }
            // After loading the skin, re-apply canvas sizing and attempt to fit the
            // camera/view so the model is centered and visible on various devices
            try {
              applyCanvasSizing && applyCanvasSizing();
              const anyViewer2: any = viewer;
              const ratio = (window && window.devicePixelRatio) || 1;
              const renderer = anyViewer2.renderer || anyViewer2._renderer || (anyViewer2.view && anyViewer2.view.renderer) || null;
              if (renderer && typeof renderer.setSize === 'function') {
                try {
                  const rect = el.getBoundingClientRect();
                  const w = Math.max(1, Math.floor(rect.width * ratio));
                  const h = Math.max(1, Math.floor(rect.height * ratio));
                  renderer.setSize(w, h, false);
                } catch (e) { }
              }
              try { if (typeof anyViewer2.adjustCameraDistance === 'function') anyViewer2.adjustCameraDistance(); } catch (e) { }
              try { if (typeof anyViewer2.fitToModel === 'function') anyViewer2.fitToModel(); } catch (e) { }
              try { if (anyViewer2.controls && anyViewer2.controls.target) { anyViewer2.controls.target.set(0,0,0); anyViewer2.controls.update && anyViewer2.controls.update(); } } catch (e) { }
              try { if (anyViewer2.camera && anyViewer2.camera.updateProjectionMatrix) anyViewer2.camera.updateProjectionMatrix(); } catch (e) { }
            } catch (e) { console.debug('post-load sizing/fit failed', e); }
            return resolve();
          }
          setStatus('viewer が loadSkin をサポートしていません', 'error');
          return reject(new Error('skin3d viewer does not support loadSkin'));
        } catch (e) {
          setStatus('スキン読み込みで例外が発生しました。コンソールを確認してください', 'error');
          return reject(e);
        }
      };
      img.onerror = () => {
        setStatus('スキン画像の読み込みに失敗しました（CORS またはファイル形式）', 'error');
        return reject(new Error('failed to load image for skin'));
      };
      img.src = url;
    });
  }

  // best-effort control helpers
  function setZoom(z: number) {
    try {
      const v = viewer as View | null;
      if (!v) return;
      // use typed API
      try { v.zoom = z; } catch { }
      // ensure camera distance adjusted
      try { v.adjustCameraDistance(); } catch { }
    } catch (e) {
      console.debug('setZoom failed', e);
    }
  }

  function setRotation(x: number, y: number, zrot: number) {
    try {
      const v = viewer as View | null;
      if (!v) return;
      // reset model rotation via provided API if available
      try { v.resetModelRotation(); } catch { }
      // best-effort: rotate wrapper group
      try {
        (v.playerWrapper as any).rotation.x = x;
        (v.playerWrapper as any).rotation.y = y;
        (v.playerWrapper as any).rotation.z = zrot;
      } catch { }
    } catch (e) {
      console.debug('setRotation failed', e);
    }
  }

  function setAutoRotate(v: boolean) {
    try {
      const vv = viewer as View | null;
      if (!vv) return;
      vv.autoRotate = v;
      try { if (vv.animation) vv.animation.paused = !v; } catch { }
    } catch (e) {
      console.debug('setAutoRotate failed', e);
    }
  }

  function enableControls(enabled: boolean) {
    try {
      const vv = viewer as View | null;
      if (!vv) return;
      try { vv.controls.enabled = enabled; } catch { }
      try { (vv.controls as any).enableRotate = enabled; } catch { }
      try { (vv.controls as any).enableZoom = enabled; } catch { }
      try { (vv.controls as any).enablePan = enabled; } catch { }
    } catch (e) {
      console.debug('enableControls failed', e);
    }
  }

  // Pose mode: disable model rotation/zoom, keep part picking active
  // Remember and toggle viewer animation/autoRotate so animations do not override manual pose edits
  let _priorAutoRotate: boolean | null = null;
  let _priorAnimationPaused: boolean | null = null;
  function setPoseMode(enabled: boolean) {
    try {
      _poseModeEnabled = !!enabled;
      const vv = viewer as View | null;
      if (!vv) return;
      if (enabled) {
        // Save previous auto-rotate and animation paused states
        try { _priorAutoRotate = typeof vv.autoRotate === 'boolean' ? vv.autoRotate : null; } catch { _priorAutoRotate = null; }
        try { _priorAnimationPaused = vv.animation ? !!(vv.animation.paused) : null; } catch { _priorAnimationPaused = null; }

        // Disable auto-rotation and pause animations while in pose mode
        try { vv.autoRotate = false; } catch { }
        try { if (vv.animation) vv.animation.paused = true; } catch { }
      } else {
        // Restore autoRotate and animation paused state
        try { if (_priorAutoRotate !== null && typeof vv.autoRotate === 'boolean') vv.autoRotate = _priorAutoRotate; } catch { }
        try { if (vv.animation && _priorAnimationPaused !== null) vv.animation.paused = !!_priorAnimationPaused; } catch { }

        // reset saved states
        _priorAutoRotate = null;
        _priorAnimationPaused = null;
      }
    } catch (e) {
      console.debug('setPoseMode failed', e);
    }
  }

  function setFov(fov: number) {
    try {
      const vv = viewer as View | null;
      if (!vv) return;
      try { vv.fov = fov; vv.adjustCameraDistance(); } catch { }
      try { vv.camera.fov = fov; vv.camera.updateProjectionMatrix && vv.camera.updateProjectionMatrix(); } catch { }
    } catch (e) {
      console.debug('setFov failed', e);
    }
  }

  // best-effort: rotate a specific part/bone of the model
  function setPartRotation(part: string, x: number, y: number, zrot: number) {
    try {
      const vv = viewer as View | null;
      if (!vv) return;
      // use typed playerObject.skin if available
      try {
        const skin = vv.playerObject?.skin as SkinObject | undefined;
        if (skin && (part in skin)) {
          const bp = (skin as any)[part] as BodyPart | undefined;
          if (bp) {
            bp.rotation.x = x;
            bp.rotation.y = y;
            bp.rotation.z = zrot;
            try { console.log('[gizmo] setPartRotation', part, { x, y, z: zrot }); } catch (e) { }
            return;
          }
          // If BodyPart didn't accept rotation on the group itself, try inner/outer layers
          try {
            const inner = (bp as any).innerLayer as Object3D | undefined;
            const outer = (bp as any).outerLayer as Object3D | undefined;
            if (inner && inner.rotation) {
              inner.rotation.x = x; inner.rotation.y = y; inner.rotation.z = zrot;
              try { console.log('[gizmo] setPartRotation applied to innerLayer', part); } catch (e) { }
            }
            if (outer && outer.rotation) {
              outer.rotation.x = x; outer.rotation.y = y; outer.rotation.z = zrot;
              try { console.log('[gizmo] setPartRotation applied to outerLayer', part); } catch (e) { }
            }
          } catch (e) { }
        }
      } catch (e) {
        // continue to fallback
      }
      // fallback: if user wants head rotation, try viewer.setRotation
      try {
        if (part === 'head') {
          // setRotation expects model-level rotation; use it as fallback
          try { (vv as any).setRotation(x, y, zrot); return; } catch { }
        }
      } catch (e) { }
    } catch (e) {
      console.debug('setPartRotation failed', e);
    }
  }

  // best-effort: expose a function that forces front-facing view
  function setFrontView() {
    try {
      const anyViewer: any = viewer;
      if (!anyViewer) return;
      if (anyViewer.model && anyViewer.model.rotation) {
        anyViewer.model.rotation.x = 0;
        anyViewer.model.rotation.y = 0;
        anyViewer.model.rotation.z = 0;
      }
      if (typeof anyViewer.setRotation === 'function') {
        try { anyViewer.setRotation(0, 0, 0); } catch { }
      }
      if (anyViewer.camera && anyViewer.camera.position) {
        try { anyViewer.camera.position.set(0, 0, Math.max(anyViewer.camera.position.z || 0, 200)); } catch { }
      }
      // leave controls enabled after forcing front view so user interaction remains available
    } catch (e) {
      console.debug('setFrontView failed', e);
    }
  }

  function destroy() {
    try {
      if (viewer) viewer.dispose();
    } catch (e) {
      console.warn('skin3d destroy failed', e);
    }
    try { container.removeChild(el); } catch { }
    try {
      // remove touch handlers attached to the wrapper element
      try {
        const th = (el as any).__skin3d_touch_handlers;
        if (th) {
          try { el.removeEventListener('touchstart', th.onTouchStart); } catch (e) {}
          try { el.removeEventListener('touchmove', th.onTouchMove); } catch (e) {}
          try { el.removeEventListener('touchend', th.onTouchEnd); } catch (e) {}
        }
      } catch (e) {}
      // remove any touch handlers attached to the canvas for part picking fallback
      try {
        const anyViewer = viewer as any;
        const c = (anyViewer && (anyViewer.canvas || anyViewer.domElement)) || null;
        if (c) {
          const tm = (c as any).__skin3d_touchMove;
          const ts = (c as any).__skin3d_touchStart;
          if (tm) try { c.removeEventListener('touchmove', tm as any); } catch (e) { }
          if (ts) try { c.removeEventListener('touchstart', ts as any); } catch (e) { }
          try { delete (c as any).__skin3d_touchMove; } catch (e) {}
          try { delete (c as any).__skin3d_touchStart; } catch (e) {}
        }
      } catch (e) {}
    } catch (e) {}
    try { window.removeEventListener('keydown', onKeyDown); } catch (e) { }
    try {
      if (resizeObserver) {
        try { resizeObserver.disconnect(); } catch {}
        resizeObserver = null;
      } else {
        try { window.removeEventListener('resize', applyCanvasSizing as any); } catch {}
      }
    } catch (e) { }
  }

  // Background settings
  function setBackgroundColor(color: number) {
    try {
      if (viewer) viewer.background = color;
    } catch (e) {
      console.debug('setBackgroundColor failed', e);
    }
  }

  async function loadBackground(url: string) {
    try {
      if (viewer) await viewer.loadBackground(url);
    } catch (e) {
      console.debug('loadBackground failed', e);
      throw e;
    }
  }

  async function loadPanorama(url: string) {
    try {
      if (viewer) await viewer.loadPanorama(url);
    } catch (e) {
      console.debug('loadPanorama failed', e);
      throw e;
    }
  }

  // --- Part picking implementation (click to select parts) ---




















  // Keyboard handler: space to clear selection/gizmo
  function onKeyDown(ev: KeyboardEvent) {
    try {
      // Accept Space or Spacebar (older browsers)
      if (ev.code === 'Space' || ev.key === ' ' || ev.key === 'Spacebar') {
        // Clear selection
        try { enableControls(true); } catch (e) { }
        try { onPartSelectedCb && onPartSelectedCb(null); } catch (e) { }
        ev.preventDefault();
      }
    } catch (e) { }
  }



  function getCurrentPartRotation(part: string) {
    try {
      const skin = viewer?.playerObject?.skin as SkinObject | undefined;
      if (!skin) return null;
      const bp = (skin as any)[part] as BodyPart | undefined;
      if (!bp || !bp.rotation) return null;
      return {
        x: bp.rotation.x || 0,
        y: bp.rotation.y || 0,
        z: bp.rotation.z || 0
      };
    } catch (e) {
      return null;
    }
  }

  // --- Part picking implementation (click to select parts) ---
  let pickingEnabled = false;
  let onPartSelectedCb: ((part: string | null) => void) | null = null;
  const raycaster = new Raycaster();
  const mouse = new Vector2();
  try { window.removeEventListener('keydown', onKeyDown); } catch (e) { }

  function getSkinParts(): Array<{ name: string; obj: Object3D }> {
    const parts: Array<{ name: string; obj: Object3D }> = [];
    try {
      const skin = viewer?.playerObject?.skin as SkinObject | undefined;
      if (!skin) return parts;
      (['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'] as const).forEach((p) => {
        try {
          const obj = (skin as any)[p] as Object3D | undefined;
          if (obj) parts.push({ name: p, obj });
        } catch (e) { }
      });
    } catch (e) { }
    return parts;
  }

  // 部位の表示/非表示を切り替えるユーティリティ
  function setPartVisibility(partName: string, visible: boolean) {
    try {
      const parts = getSkinParts();
      const hit = parts.find(p => p.name === partName);
      if (hit && hit.obj) {
        try { (hit.obj as any).visible = !!visible; } catch {}
        // try inner/outer layers if present
        try {
          const il = (hit.obj as any).innerLayer as any | undefined;
          if (il && typeof il.visible !== 'undefined') il.visible = !!visible;
        } catch {}
        try {
          const ol = (hit.obj as any).outerLayer as any | undefined;
          if (ol && typeof ol.visible !== 'undefined') ol.visible = !!visible;
        } catch {}
        return;
      }

      // Fallback: try to access via viewer.playerObject.skin
      const skin = viewer?.playerObject?.skin as any;
      if (!skin) return;
      const bp = skin[partName];
      if (!bp) return;
      try { bp.visible = !!visible; } catch {}
      try { if (bp.innerLayer && typeof bp.innerLayer.visible !== 'undefined') bp.innerLayer.visible = !!visible; } catch {}
      try { if (bp.outerLayer && typeof bp.outerLayer.visible !== 'undefined') bp.outerLayer.visible = !!visible; } catch {}
    } catch (e) { console.debug('setPartVisibility failed', e); }
  }

  function togglePartVisibility(partName: string) {
    try {
      const current = isPartVisible(partName);
      setPartVisibility(partName, !current);
    } catch (e) { console.debug('togglePartVisibility failed', e); }
  }

  function isPartVisible(partName: string) {
    try {
      const parts = getSkinParts();
      const hit = parts.find(p => p.name === partName);
      if (hit && hit.obj) {
        try { return !!((hit.obj as any).visible); } catch {}
      }
      const skin = viewer?.playerObject?.skin as any;
      if (!skin) return false;
      const bp = skin[partName];
      if (!bp) return false;
      try {
        if (typeof bp.visible === 'boolean') return !!bp.visible;
        if (bp.innerLayer && typeof bp.innerLayer.visible === 'boolean') return !!bp.innerLayer.visible;
        if (bp.outerLayer && typeof bp.outerLayer.visible === 'boolean') return !!bp.outerLayer.visible;
      } catch (e) { }
      return false;
    } catch (e) { return false; }
  }

  function pickPartFromEvent(ev: PointerEvent) {
    if (!viewer || !viewer.camera) return null;
    const rect = viewer.canvas.getBoundingClientRect();
    mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    // cast camera to any to avoid cross-version type mismatches
    raycaster.setFromCamera(mouse, (viewer.camera as unknown) as any);
    const parts = getSkinParts();
    const targets: Object3D[] = [];
    parts.forEach(p => targets.push(p.obj));
    const intersects = raycaster.intersectObjects(targets, true);
    if (intersects.length === 0) return null;
    const hit = intersects[0].object;
    for (const p of parts) {
      let cur: Object3D | null = hit as Object3D;
      while (cur) {
        if (cur === p.obj) return p.name;
        cur = cur.parent as Object3D | null;
      }
    }
    return null;
  }

  function onPointerMove(_ev: PointerEvent) {
    if (!pickingEnabled) return;
    // Removed cursor change for highlight
  }

  function onPointerDown(ev: PointerEvent) {
    if (!pickingEnabled) return;

    const part = pickPartFromEvent(ev);
    // Always keep camera controls enabled for better usability
    try { onPartSelectedCb && onPartSelectedCb(part); } catch (e) { }
  }

  function enablePartPicking(enabled: boolean) {
    if (!viewer) { pickingEnabled = enabled; return; }
    if (enabled && !pickingEnabled) {
      viewer.canvas.addEventListener('pointermove', onPointerMove);
      viewer.canvas.addEventListener('pointerdown', onPointerDown);
      // Fallback for environments without PointerEvent (some older iOS versions)
      try {
        if (!(window as any).PointerEvent) {
          const touchMove = function (te: TouchEvent) {
            if (!pickingEnabled) return;
            if (!te.touches || te.touches.length === 0) return;
            const t = te.touches[0];
            // synthesize a small event object with clientX/clientY
            try { onPointerMove({ clientX: t.clientX, clientY: t.clientY } as unknown as PointerEvent); } catch (e) { }
            // prevent scrolling while interacting with canvas
            try { te.preventDefault(); } catch (e) { }
          };
          const touchStart = function (te: TouchEvent) {
            if (!pickingEnabled) return;
            if (!te.touches || te.touches.length === 0) return;
            const t = te.touches[0];
            try { onPointerDown({ clientX: t.clientX, clientY: t.clientY } as unknown as PointerEvent); } catch (e) { }
            try { te.preventDefault(); } catch (e) { }
          };
          viewer.canvas.addEventListener('touchmove', touchMove as any, { passive: false } as any);
          viewer.canvas.addEventListener('touchstart', touchStart as any, { passive: false } as any);
          // store for removal
          (viewer.canvas as any).__skin3d_touchMove = touchMove;
          (viewer.canvas as any).__skin3d_touchStart = touchStart;
        }
      } catch (e) { /* ignore */ }
      pickingEnabled = true;
    } else if (!enabled && pickingEnabled) {
      try { viewer.canvas.removeEventListener('pointermove', onPointerMove); } catch (e) { }
      try { viewer.canvas.removeEventListener('pointerdown', onPointerDown); } catch (e) { }
      try {
        const tm = (viewer.canvas as any).__skin3d_touchMove;
        const ts = (viewer.canvas as any).__skin3d_touchStart;
        if (tm) try { viewer.canvas.removeEventListener('touchmove', tm as any); } catch (e) { }
        if (ts) try { viewer.canvas.removeEventListener('touchstart', ts as any); } catch (e) { }
        delete (viewer.canvas as any).__skin3d_touchMove;
        delete (viewer.canvas as any).__skin3d_touchStart;
      } catch (e) { }
      pickingEnabled = false;
    }
  }

  function setOnPartSelected(cb: (part: string | null) => void) {
    onPartSelectedCb = cb;
  }

  // Camera state management
  function getCameraState() {
    try {
      if (!viewer?.camera) return null;
      const camera = viewer.camera;
      const controls = (viewer as any).controls;

      return {
        position: {
          x: camera.position.x,
          y: camera.position.y,
          z: camera.position.z
        },
        target: controls?.target ? {
          x: controls.target.x,
          y: controls.target.y,
          z: controls.target.z
        } : { x: 0, y: 0, z: 0 },
        zoom: (viewer as any).zoom || 1,
        fov: camera.fov || 70
      };
    } catch (e) {
      console.debug('getCameraState failed:', e);
      return null;
    }
  }

  function setCameraState(state: { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number }; zoom: number; fov: number }) {
    try {
      if (!viewer?.camera) return;
      const camera = viewer.camera;
      const controls = (viewer as any).controls;

      camera.position.set(state.position.x, state.position.y, state.position.z);
      if (controls && state.target) {
        controls.target.set(state.target.x, state.target.y, state.target.z);
        controls.update();
      }
      if (state.zoom && (viewer as any).setZoom) {
        (viewer as any).setZoom(state.zoom);
      }
      if (state.fov) {
        camera.fov = state.fov;
        camera.updateProjectionMatrix();
      }
    } catch (e) {
      console.debug('setCameraState failed:', e);
    }
  }

  // Pose state management
  function getPoseState() {
    const pose: { [part: string]: { x: number; y: number; z: number } } = {};
    try {
      const skin = viewer?.playerObject?.skin as SkinObject | undefined;
      if (!skin) return pose;

      (['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'] as const).forEach((partName) => {
        try {
          const part = (skin as any)[partName] as BodyPart | undefined;
          if (part?.rotation) {
            pose[partName] = {
              x: part.rotation.x || 0,
              y: part.rotation.y || 0,
              z: part.rotation.z || 0
            };
          }
        } catch (e) {
          // ignore individual part errors
        }
      });
    } catch (e) {
      console.debug('getPoseState failed:', e);
    }
    return pose;
  }

  function setPoseState(pose: { [part: string]: { x: number; y: number; z: number } }) {
    try {
      Object.entries(pose).forEach(([partName, rotation]) => {
        try {
          setPartRotation(partName, rotation.x, rotation.y, rotation.z);
        } catch (e) {
          console.debug(`Failed to set rotation for ${partName}:`, e);
        }
      });
    } catch (e) {
      console.debug('setPoseState failed:', e);
    }
  }

  // Screenshot functionality
  async function takeScreenshot(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!viewer) return reject(new Error('viewer not initialized'));

      // Wait one frame to ensure rendering has settled (helps avoid partial frames)
      try {
        requestAnimationFrame(() => {
          try {
            const anyViewer = viewer as any;
        let renderer: any = null;

        // Try common properties first
        if (anyViewer.renderer) renderer = anyViewer.renderer;
        else if (anyViewer._renderer) renderer = anyViewer._renderer;
        else if (anyViewer.view && anyViewer.view.renderer) renderer = anyViewer.view.renderer;
        else if (anyViewer.scene && anyViewer.scene.renderer) renderer = anyViewer.scene.renderer;
        else if (anyViewer.camera && anyViewer.camera.renderer) renderer = anyViewer.camera.renderer;

        // Deep search as fallback
        const visited = new Set();
        const findRenderer = (obj: any): any => {
          if (!obj || typeof obj !== 'object' || visited.has(obj)) return null;
          visited.add(obj);
          try {
            if (obj.isWebGLRenderer || (obj.domElement && obj.getContext)) return obj;
          } catch (e) {}
          for (const key in obj) {
            if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
            if (key === 'parent' || key === '__proto__') continue;
            try {
              const res = findRenderer(obj[key]);
              if (res) return res;
            } catch (e) {}
          }
          return null;
        };

        if (!renderer) renderer = findRenderer(anyViewer);

        if (!renderer || !renderer.domElement) return reject(new Error('WebGL renderer not found in viewer'));

            // Ensure renderer pixel ratio/size are set to match canvas drawing buffer
            try {
              const ratio = (window && window.devicePixelRatio) || 1;
              if (renderer.setPixelRatio) {
                try { renderer.setPixelRatio(ratio); } catch {}
              }
              try {
                const rect = (renderer.domElement && renderer.domElement.getBoundingClientRect && renderer.domElement.getBoundingClientRect()) || (el.getBoundingClientRect && el.getBoundingClientRect());
                const w = Math.max(1, Math.floor(((renderer.domElement && renderer.domElement.width) || (rect && rect.width) || 1) * ratio));
                const h = Math.max(1, Math.floor(((renderer.domElement && renderer.domElement.height) || (rect && rect.height) || 1) * ratio));
                renderer.setSize && renderer.setSize(w, h, false);
              } catch (e) { }
            } catch (e) { }

        const canvas: HTMLCanvasElement = renderer.domElement as HTMLCanvasElement;

        // Helper to compute drawing buffer size (respect devicePixelRatio)
        const devicePixelRatio = (window && window.devicePixelRatio) || 1;
        const drawingWidth = canvas.width || Math.max(1, Math.floor((canvas.clientWidth || canvas.getBoundingClientRect().width) * devicePixelRatio));
        const drawingHeight = canvas.height || Math.max(1, Math.floor((canvas.clientHeight || canvas.getBoundingClientRect().height) * devicePixelRatio));

        // 1) Try simple toDataURL on the canvas first (fast and often works)
        try {
          const dataUrl = canvas.toDataURL('image/png');
          // If string looks valid and reasonably large, return it
          if (typeof dataUrl === 'string' && dataUrl.length > 200) {
            return resolve(dataUrl);
          }
        } catch (e) {
          // toDataURL may throw if canvas is tainted; ignore and fall through to readPixels
          console.debug('canvas.toDataURL failed or was tainted, falling back to readPixels', e);
        }

        // 2) Try to readPixels from WebGL context
        const gl = renderer.getContext ? renderer.getContext() : renderer.context;
        if (!gl) return reject(new Error('WebGL context not found in renderer'));

        // Create temp canvas with the correct drawing buffer size
        const tempCanvas = document.createElement('canvas');
        // Protect against extremely large drawing buffers on high-DPR mobile devices
        // which can trigger RangeError during Uint8Array allocation (OOM).
        const MAX_PIXELS = 2048 * 2048; // ~4M pixels
        let targetWidth = drawingWidth;
        let targetHeight = drawingHeight;
        if (drawingWidth * drawingHeight > MAX_PIXELS) {
          const scale = Math.sqrt(MAX_PIXELS / (drawingWidth * drawingHeight));
          targetWidth = Math.max(1, Math.floor(drawingWidth * scale));
          targetHeight = Math.max(1, Math.floor(drawingHeight * scale));
        }
        const tempCtx = ((): CanvasRenderingContext2D | null => {
          try {
            tempCanvas.width = targetWidth;
            tempCanvas.height = targetHeight;
            return tempCanvas.getContext('2d');
          } catch (e) {
            return null;
          }
        })();
        if (!tempCtx) return reject(new Error('Failed to create temporary canvas context'));

        // Fast path: try to draw the renderer canvas directly into a smaller temp canvas
        // (works when canvas is not tainted). This avoids allocating a huge pixel buffer.
        try {
          // renderer.domElement is the source canvas
          tempCtx.drawImage(canvas, 0, 0, targetWidth, targetHeight);
          try {
            const dataUrl = tempCanvas.toDataURL('image/png');
            if (typeof dataUrl === 'string' && dataUrl.length > 200) return resolve(dataUrl);
          } catch (e) {
            // fallthrough to readPixels fallback
            console.debug('temp canvas toDataURL failed after drawImage, falling back to readPixels', e);
          }
        } catch (e) {
          // drawImage may fail if the canvas is tainted; fall back to readPixels
          console.debug('drawImage to temp canvas failed, falling back to readPixels', e);
        }

        // Read pixels from GL. Use Uint8Array and flip vertically
        // If target size is smaller than drawing buffer, try to read a reduced region to limit memory.
        const readWidth = targetWidth;
        const readHeight = targetHeight;
        let pixels: Uint8Array;
        try {
          pixels = new Uint8Array(readWidth * readHeight * 4);
        } catch (err) {
          return reject(new Error('Failed to allocate pixel buffer for screenshot: ' + String(err)));
        }
        try {
          // If we are reading at reduced size, attempt to use gl.readPixels on the lower-left portion
          // Note: this reads the lower-left region; for a scaled full-frame capture a proper solution
          // would re-render at lower resolution which is more involved. This is a pragmatic fallback.
          gl.readPixels(0, 0, readWidth, readHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        } catch (e) {
          return reject(new Error('gl.readPixels failed: ' + String(e)));
        }

        const imageData = tempCtx.createImageData(readWidth, readHeight);
        // copy and vertically flip
        for (let y = 0; y < readHeight; y++) {
          for (let x = 0; x < readWidth; x++) {
            const srcIndex = (y * readWidth + x) * 4;
            const dstIndex = ((readHeight - 1 - y) * readWidth + x) * 4;
            imageData.data[dstIndex] = pixels[srcIndex];
            imageData.data[dstIndex + 1] = pixels[srcIndex + 1];
            imageData.data[dstIndex + 2] = pixels[srcIndex + 2];
            imageData.data[dstIndex + 3] = pixels[srcIndex + 3];
          }
        }
        tempCtx.putImageData(imageData, 0, 0);

        try {
          const dataUrl = tempCanvas.toDataURL('image/png');
          return resolve(dataUrl);
        } catch (e) {
          return reject(new Error('Failed to convert temp canvas to dataURL: ' + String(e)));
        }
          } catch (error) {
            return reject(error);
          }
        });
      } catch (error) {
        return reject(error);
      }
    });
  }

  return { loadSkin, destroy, el, setFrontView, setZoom, setRotation, setAutoRotate, enableControls, setPoseMode, setFov, setPartRotation, enablePartPicking, setOnPartSelected, getCurrentPartRotation, setBackgroundColor, loadBackground, loadPanorama, takeScreenshot, getCameraState, setCameraState, getPoseState, setPoseState, setPartVisibility, togglePartVisibility, isPartVisible, _viewer: viewer };
}
