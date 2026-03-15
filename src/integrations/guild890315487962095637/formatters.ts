import { TIME_ZONE } from './constants.js';

const NO_RECORD_LABEL = '\u8a18\u9332\u306a\u3057';

const timestampFormatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
});

export function formatTimestamp(timestamp: number | null): string {
    if (!timestamp) {
        return NO_RECORD_LABEL;
    }

    return `${timestampFormatter.format(new Date(timestamp))} JST`;
}
