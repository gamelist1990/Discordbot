// thumbnailWorker.js
// Worker that receives an ImageBitmap, draws it to an OffscreenCanvas and returns a Blob
self.onmessage = async (ev) => {
  try {
    const { bitmap, width, height, quality } = ev.data || {};
    if (!bitmap) {
      postMessage({ error: 'no bitmap' });
      return;
    }

    const w = width || bitmap.width || 128;
    const h = height || bitmap.height || 128;
    const off = new OffscreenCanvas(w, h);
    const ctx = off.getContext('2d');
    if (!ctx) {
      postMessage({ error: 'offscreen context unavailable' });
      return;
    }

    // draw scaled to fit
    ctx.clearRect(0,0,w,h);
    try {
      ctx.drawImage(bitmap, 0, 0, w, h);
    } catch (e) {
      // fallback: draw with createImageBitmap result properties
      ctx.drawImage(bitmap, 0, 0);
    }

    // convert to blob (png)
    const blob = await off.convertToBlob({ type: 'image/png', quality: quality || 0.92 });

    // close bitmap to free resources
    try { bitmap.close && bitmap.close(); } catch (e) {}

    // Post the blob back to main thread
    postMessage({ blob }, [blob]);
  } catch (err) {
    postMessage({ error: String(err || 'unknown') });
  }
};
