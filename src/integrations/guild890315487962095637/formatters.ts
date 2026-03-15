import { TIME_ZONE } from './constants.js';

const DEFAULT_NO_RECORD_LABEL = 'No record';

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

export function formatTimestamp(timestamp: number | null, noRecordLabel = DEFAULT_NO_RECORD_LABEL): string {
    if (!timestamp) {
        return noRecordLabel;
    }

    return `${timestampFormatter.format(new Date(timestamp))} JST`;
}
