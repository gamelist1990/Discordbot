/**
 * First-party SVG text presets. Fontconfig supplies Japanese glyphs (Noto Sans CJK JP).
 * No font files or external resources are required inside user-generated SVG.
 */
export const SVG_FONT_PRESETS = [
    'none', 'bold', 'jagged', 'neon', 'comic', 'retro', 'metal', 'pixel', 'horror', 'custom',
] as const;
export type SvgFontPreset = typeof SVG_FONT_PRESETS[number];

export function isSvgFontPreset(value: unknown): value is SvgFontPreset {
    return typeof value === 'string' && (SVG_FONT_PRESETS as readonly string[]).includes(value);
}

const PRESET_DEFAULTS: Record<SvgFontPreset, Record<string, string>> = {
    none: {},
    bold: { 'font-family': 'Noto Sans CJK JP, DejaVu Sans, sans-serif', 'font-weight': '900',
        'paint-order': 'stroke fill', 'stroke-linejoin': 'round', stroke: '#121a2d', 'stroke-width': '4' },
    jagged: { 'font-family': 'Noto Sans CJK JP, DejaVu Sans, sans-serif', 'font-weight': '900',
        'paint-order': 'stroke fill', 'stroke-linejoin': 'miter', 'stroke-miterlimit': '8',
        stroke: '#1b0d27', 'stroke-width': '6', filter: 'url(#pex-text-jagged)' },
    neon: { 'font-family': 'Noto Sans CJK JP, DejaVu Sans, sans-serif', 'font-weight': '800',
        fill: '#b9ffff', stroke: '#256ad3', 'stroke-width': '2',
        'paint-order': 'stroke fill', filter: 'url(#pex-text-neon)' },
    comic: { 'font-family': 'Noto Sans CJK JP, DejaVu Sans, sans-serif', 'font-weight': '900',
        fill: '#ffdb4d', stroke: '#23154d', 'stroke-width': '7',
        'stroke-linejoin': 'round', 'paint-order': 'stroke fill', filter: 'url(#pex-text-comic)' },
    retro: { 'font-family': 'Noto Sans CJK JP, DejaVu Sans, sans-serif', 'font-weight': '800',
        fill: '#ffefaf', stroke: '#794b93', 'stroke-width': '4',
        'paint-order': 'stroke fill', filter: 'url(#pex-text-retro)' },
    metal: { 'font-family': 'Noto Sans CJK JP, DejaVu Sans, sans-serif', 'font-weight': '900',
        fill: 'url(#pex-text-metal-gradient)', stroke: '#283241',
        'stroke-width': '4', 'paint-order': 'stroke fill' },
    pixel: { 'font-family': 'DejaVu Sans Mono, Noto Sans CJK JP, monospace', 'font-weight': '900',
        'paint-order': 'stroke fill', stroke: '#101e39',
        'stroke-linejoin': 'bevel', 'stroke-width': '3' },
    horror: { 'font-family': 'Noto Sans CJK JP, DejaVu Sans, sans-serif', 'font-weight': '900',
        fill: '#ff3139', stroke: '#170607', 'stroke-width': '6',
        'paint-order': 'stroke fill', filter: 'url(#pex-text-jagged)' },
    custom: {}, // AI authors custom text styling or vector letter-shape paths.
};

const DEFINITIONS = [
    '<defs>',
    '<filter id="pex-text-jagged" x="-20%" y="-30%" width="140%" height="160%">',
    '<feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="2" seed="9" result="texture"/>',
    '<feDisplacementMap in="SourceGraphic" in2="texture" scale="9" xChannelSelector="R" yChannelSelector="G"/>',
    '</filter>',
    '<filter id="pex-text-neon" x="-60%" y="-80%" width="220%" height="260%">',
    '<feGaussianBlur in="SourceGraphic" stdDeviation="4.5" result="glow"/>',
    '<feMerge><feMergeNode in="glow"/><feMergeNode in="SourceGraphic"/></feMerge>',
    '</filter>',
    '<filter id="pex-text-comic" x="-40%" y="-40%" width="180%" height="200%">',
    '<feOffset in="SourceAlpha" dx="5" dy="6" result="shadow"/>',
    '<feFlood flood-color="#130f2c" flood-opacity=".85" result="ink"/>',
    '<feComposite in="ink" in2="shadow" operator="in" result="outline"/>',
    '<feMerge><feMergeNode in="outline"/><feMergeNode in="SourceGraphic"/></feMerge>',
    '</filter>',
    '<filter id="pex-text-retro" x="-50%" y="-50%" width="200%" height="220%">',
    '<feOffset in="SourceAlpha" dx="7" dy="9" result="shadow"/>',
    '<feFlood flood-color="#16d6c5" result="teal"/>',
    '<feComposite in="teal" in2="shadow" operator="in" result="coloredShadow"/>',
    '<feMerge><feMergeNode in="coloredShadow"/><feMergeNode in="SourceGraphic"/></feMerge>',
    '</filter>',
    '<linearGradient id="pex-text-metal-gradient" x1="0" x2="0" y1="0" y2="1">',
    '<stop offset="0%" stop-color="#fffef4"/><stop offset="40%" stop-color="#cbd9e5"/>',
    '<stop offset="52%" stop-color="#657c95"/><stop offset="75%" stop-color="#e2e9f5"/>',
    '<stop offset="100%" stop-color="#8898ad"/>',
    '</linearGradient>',
    '</defs>',
].join('');

/** Allow several presets in one image using data-font-preset on individual text tags. */
export function applySvgFontPresets(svg: string, requested: unknown = 'none'): string {
    const globalPreset: SvgFontPreset = isSvgFontPreset(requested) ? requested : 'none';
    let needsDefs = false;
    let changed = false;
    const decorated = svg.replace(/<text\b[^>]*>/gi, tag => {
        const chosen = /\bdata-font-preset\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ?? globalPreset;
        const preset = isSvgFontPreset(chosen) ? chosen : globalPreset;
        if (preset === 'none' || preset === 'custom') return tag;
        changed = true;
        const attributes = PRESET_DEFAULTS[preset];
        let result = tag;
        for (const [key, value] of Object.entries(attributes)) {
            if (new RegExp('\\b' + key + '\\s*=', 'i').test(tag)) continue;
            result = result.replace(/>$/, ' ' + key + '="' + value + '">');
        }
        if (['jagged', 'neon', 'comic', 'retro', 'horror', 'metal'].includes(preset)) needsDefs = true;
        return result;
    });
    if (!changed || !needsDefs) return decorated;
    return decorated.replace(/<svg\b[^>]*>/i, root => root + DEFINITIONS);
}
