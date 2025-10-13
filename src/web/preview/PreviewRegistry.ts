export type PreviewData = {
    title: string;
    description?: string;
    image?: string;
    url?: string;
    type?: string;
};

export type PreviewHandler = (path: string, params?: Record<string, string>) => Promise<PreviewData | null>;

type Entry = {
    matcher: RegExp;
    handler: PreviewHandler;
};

export class PreviewRegistry {
    private entries: Entry[] = [];

    register(matcher: RegExp, handler: PreviewHandler) {
        this.entries.push({ matcher, handler });
    }

    find(path: string): Entry | undefined {
        return this.entries.find(e => e.matcher.test(path));
    }

    async getPreview(path: string): Promise<PreviewData | null> {
        const entry = this.find(path);
        if (!entry) return null;
        try {
            return await entry.handler(path);
        } catch (e) {
            // swallow errors from handlers to avoid breaking preview flow
            console.error('[PreviewRegistry] handler error', e);
            return null;
        }
    }
}

export const globalPreviewRegistry = new PreviewRegistry();
