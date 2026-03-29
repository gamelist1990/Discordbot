import path from 'path';

export const TARGET_GUILD_ID = '890315487962095637';
export const TARGET_CHANNEL_ID = '1482433976504160500';
export const STATUS_IMAGE_URL = 'http://132.145.123.39:8080/status?image';
export const POLL_INTERVAL_MS = 60_000;
export const REQUEST_TIMEOUT_MS = 15_000;
export const TIME_ZONE = 'Asia/Tokyo';
export const EMBED_IMAGE_NAME = 'guild890315487962095637-server-status.png';
export const EMBED_TITLE = 'Server Status';
export const ONLINE_COLOR = 0x2ecc71;
export const OFFLINE_COLOR = 0xe74c3c;
export const DATA_DIR = path.join(process.cwd(), 'Database', 'integrations', 'guild890315487962095637');
export const STATE_FILE = path.join(DATA_DIR, 'server-status-state.json');
export const OFFLINE_IMAGE_FONT_FAMILY = 'Guild890315487962095637StatusJP';
export const OFFLINE_IMAGE_FONT_FILE = path.join(process.cwd(), 'assets', 'fonts', 'NotoSansJP[wght].ttf');
