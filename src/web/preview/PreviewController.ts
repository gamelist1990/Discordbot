import { Request, Response } from 'express';
import { globalPreviewRegistry } from './PreviewRegistry.js';
import { Logger } from '../../utils/Logger.js';

const escapeHtml = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function previewHandler(req: Request, res: Response) {
    try {
        const fullPath = req.originalUrl.split('?')[0];
        const preview = await globalPreviewRegistry.getPreview(fullPath);

        if (!preview) {
            // fallback generic preview
            const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
            const html = `<!doctype html><html><head>\n<meta property="og:type" content="website" />\n<meta property="og:title" content="${escapeHtml('Site')}" />\n<meta property="og:description" content="${escapeHtml('Open preview')}" />\n<meta property="og:url" content="${escapeHtml(url)}" />\n<meta name="twitter:card" content="summary" />\n<title>${escapeHtml('Preview')}</title>\n</head><body>\n<script>location.replace('/')</script>\n</body></html>`;
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(html);
            return;
        }

        const url = preview.url || `${req.protocol}://${req.get('host')}${req.originalUrl}`;
        const html = `<!doctype html><html><head>\n<meta property="og:type" content="${escapeHtml(preview.type || 'article')}" />\n<meta property="og:title" content="${escapeHtml(preview.title)}" />\n<meta property="og:description" content="${escapeHtml(preview.description || '')}" />\n<meta property="og:url" content="${escapeHtml(url)}" />\n${preview.image ? `<meta property="og:image" content="${escapeHtml(preview.image)}" />` : ''}\n<meta name="twitter:card" content="${preview.image ? 'summary_large_image' : 'summary'}" />\n<title>${escapeHtml(preview.title)}</title>\n</head><body>\n<script>location.replace('/')</script>\n</body></html>`;

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (e) {
        Logger.error('Preview handler failed:', e);
        res.status(500).send('Server error');
    }
}
