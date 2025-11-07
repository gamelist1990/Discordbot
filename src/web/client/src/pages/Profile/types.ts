// Card type definition for the profile editor
export type Card = {
  id: string;
  type: 'text' | 'image' | 'sticker';
  content: string; // text or URL
  x: number; // px
  y: number; // px
  pxW: number; // px width
  pxH: number; // px height
  rotation?: number; // degrees
  zIndex?: number;
  opacity?: number;
  meta?: {
    fontSize?: number;
    color?: string;
    align?: 'left' | 'center' | 'right';
    fontWeight?: string;
    [key: string]: any;
  };
};

// Migration function to convert grid-based cards to pixel-based
export function migrateGridToPx(
  cards: any[],
  canvasWidth: number,
  cols: number = 12
): Card[] {
  return cards.map((c) => ({
    ...c,
    pxW: c.w ? Math.round((c.w / cols) * canvasWidth) : (c.pxW || 160),
    pxH: c.h ? Math.round((c.h / cols) * canvasWidth * 0.5) : (c.pxH || 80),
    x: (c.x != null) ? Math.round((c.x / cols) * canvasWidth) : (c.x || 16),
    y: (c.y != null) ? Math.round(c.y * 80) : (c.y || 16),
  }));
}
