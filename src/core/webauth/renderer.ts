/**
 * Software-renderer (virtual GPU) classification (brief 9).
 *
 * The WebGL renderer string is the *only* input. A match means the browser is
 * drawing through a CPU rasterizer or a generic virtual display adapter, which
 * is typical for headless Chrome, containerized browsers, VMs and some remote
 * desktops. It is a signal, not a solo block: real members use VMs and remote
 * desktops too.
 *
 * Documented pattern list:
 *   - SwiftShader / "Google SwiftShader" — Chrome's CPU fallback (also the
 *     default headless Chrome renderer, usually through ANGLE/Vulkan).
 *   - llvmpipe — Mesa's LLVM CPU rasterizer (Linux VMs, containers, WSL).
 *   - softpipe — Mesa's plain CPU rasterizer.
 *   - swrast — Mesa's legacy software rasterizer.
 *   - "software rasterizer" / "software renderer" / "software adapter" /
 *     bare "software" — vendor strings that say so directly (also covers
 *     ANGLE software variants such as "ANGLE (Google, Vulkan (SwiftShader))"
 *     even if the vendor prefix differs).
 *   - "Microsoft Basic Render Driver" — Windows WARP (D3D software device),
 *     used when no GPU driver is available.
 *   - "Apple Software Renderer" — macOS/iOS CPU fallback.
 *   - "Mesa OffScreen" — Mesa offscreen platform.
 *   - "virgl" — virtio-gpu 3D (paravirtualized GL used by QEMU/KVM guests).
 *
 * Deliberately NOT matched: a bare "Mesa" (real Linux GPUs report things like
 * "Mesa Intel(R) UHD Graphics 620") and virtualization brand names such as
 * VMware SVGA3D or Parallels, which can be hardware-accelerated and would
 * produce too many false positives for a signal-only field.
 */
export const SOFTWARE_RENDERER_PATTERNS: readonly RegExp[] = [
    /swiftshader/i,
    /llvmpipe/i,
    /softpipe/i,
    /\bswrast\b/i,
    /software\s*(rasterizer|renderer|adapter|implementation)/i,
    /\bsoftware\b/i,
    /microsoft basic render driver/i,
    /apple software/i,
    /mesa\s*offscreen/i,
    /\bvirgl\b/i
];

/** True when the WebGL vendor/renderer strings denote software rendering. */
export function isSoftwareRenderer(...values: Array<string | null | undefined>): boolean {
    for (const value of values) {
        const text = typeof value === 'string' ? value : '';
        if (!text) continue;
        if (SOFTWARE_RENDERER_PATTERNS.some((pattern) => pattern.test(text))) return true;
    }
    return false;
}
