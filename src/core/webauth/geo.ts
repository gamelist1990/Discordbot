import type { GeoMismatch } from './types.js';

/**
 * Coarse geo-consistency (brief 9).
 *
 * ip-api already reports the IP country. Comparing it with the browser's
 * timezone and primary language is a weak corroboration signal: travellers,
 * expatriates, VPN users and dual-language households all produce mismatches,
 * so this never blocks on its own. Unknown input (no country, no mapped
 * timezone, no unambiguous language) always yields `none` — i.e. no judgement.
 */

/** ISO 3166-1 alpha-2 normalization; null for anything unusable. */
export function normalizeCountryCode(value: unknown): string | null {
    const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
    return /^[A-Z]{2}$/.test(code) ? code : null;
}

/**
 * IANA timezone -> primary country. Coarse on purpose ("JP and the major
 * regions"); zones that span several countries (e.g. `Europe/Busingen`) are
 * simply absent, which means "no judgement" rather than a guess.
 */
export const TIMEZONE_COUNTRY: Readonly<Record<string, string>> = {
    'Asia/Tokyo': 'JP',
    'Asia/Seoul': 'KR',
    'Asia/Pyongyang': 'KP',
    'Asia/Shanghai': 'CN',
    'Asia/Chongqing': 'CN',
    'Asia/Harbin': 'CN',
    'Asia/Urumqi': 'CN',
    'Asia/Kashgar': 'CN',
    'Asia/Taipei': 'TW',
    'Asia/Hong_Kong': 'HK',
    Hongkong: 'HK',
    'Asia/Macau': 'MO',
    'Asia/Macao': 'MO',
    'Asia/Singapore': 'SG',
    'Asia/Bangkok': 'TH',
    'Asia/Jakarta': 'ID',
    'Asia/Pontianak': 'ID',
    'Asia/Makassar': 'ID',
    'Asia/Jayapura': 'ID',
    'Asia/Manila': 'PH',
    'Asia/Kuala_Lumpur': 'MY',
    'Asia/Kuching': 'MY',
    'Asia/Ho_Chi_Minh': 'VN',
    'Asia/Saigon': 'VN',
    'Asia/Yangon': 'MM',
    'Asia/Rangoon': 'MM',
    'Asia/Phnom_Penh': 'KH',
    'Asia/Vientiane': 'LA',
    'Asia/Ulaanbaatar': 'MN',
    'Asia/Hovd': 'MN',
    'Asia/Kolkata': 'IN',
    'Asia/Calcutta': 'IN',
    'Asia/Dhaka': 'BD',
    'Asia/Karachi': 'PK',
    'Asia/Kathmandu': 'NP',
    'Asia/Colombo': 'LK',
    'Asia/Dubai': 'AE',
    'Asia/Muscat': 'OM',
    'Asia/Riyadh': 'SA',
    'Asia/Qatar': 'QA',
    'Asia/Kuwait': 'KW',
    'Asia/Bahrain': 'BH',
    'Asia/Jerusalem': 'IL',
    'Asia/Tel_Aviv': 'IL',
    'Asia/Beirut': 'LB',
    'Asia/Amman': 'JO',
    'Asia/Damascus': 'SY',
    'Asia/Baghdad': 'IQ',
    'Asia/Tehran': 'IR',
    'Asia/Istanbul': 'TR',
    'Europe/Istanbul': 'TR',
    'Asia/Almaty': 'KZ',
    'Asia/Tashkent': 'UZ',
    'Asia/Baku': 'AZ',
    'Asia/Tbilisi': 'GE',
    'Asia/Yerevan': 'AM',
    'Europe/London': 'GB',
    'Europe/Dublin': 'IE',
    'Europe/Paris': 'FR',
    'Europe/Berlin': 'DE',
    'Europe/Madrid': 'ES',
    'Europe/Rome': 'IT',
    'Europe/Amsterdam': 'NL',
    'Europe/Brussels': 'BE',
    'Europe/Vienna': 'AT',
    'Europe/Zurich': 'CH',
    'Europe/Stockholm': 'SE',
    'Europe/Oslo': 'NO',
    'Europe/Copenhagen': 'DK',
    'Europe/Helsinki': 'FI',
    'Europe/Warsaw': 'PL',
    'Europe/Prague': 'CZ',
    'Europe/Budapest': 'HU',
    'Europe/Bucharest': 'RO',
    'Europe/Sofia': 'BG',
    'Europe/Athens': 'GR',
    'Europe/Lisbon': 'PT',
    'Europe/Moscow': 'RU',
    'Europe/Kiev': 'UA',
    'Europe/Kyiv': 'UA',
    'Europe/Minsk': 'BY',
    'America/New_York': 'US',
    'America/Chicago': 'US',
    'America/Denver': 'US',
    'America/Los_Angeles': 'US',
    'America/Phoenix': 'US',
    'America/Anchorage': 'US',
    'America/Honolulu': 'US',
    'America/Detroit': 'US',
    'America/Indiana/Indianapolis': 'US',
    'America/Toronto': 'CA',
    'America/Vancouver': 'CA',
    'America/Edmonton': 'CA',
    'America/Winnipeg': 'CA',
    'America/Halifax': 'CA',
    'America/Mexico_City': 'MX',
    'America/Monterrey': 'MX',
    'America/Tijuana': 'MX',
    'America/Sao_Paulo': 'BR',
    'America/Bahia': 'BR',
    'America/Manaus': 'BR',
    'America/Argentina/Buenos_Aires': 'AR',
    'America/Santiago': 'CL',
    'America/Bogota': 'CO',
    'America/Lima': 'PE',
    'America/Caracas': 'VE',
    'Australia/Sydney': 'AU',
    'Australia/Melbourne': 'AU',
    'Australia/Brisbane': 'AU',
    'Australia/Perth': 'AU',
    'Australia/Adelaide': 'AU',
    'Australia/Hobart': 'AU',
    'Australia/Darwin': 'AU',
    'Pacific/Auckland': 'NZ',
    'Pacific/Fiji': 'FJ',
    'Africa/Johannesburg': 'ZA',
    'Africa/Lagos': 'NG',
    'Africa/Cairo': 'EG',
    'Africa/Nairobi': 'KE',
    'Africa/Casablanca': 'MA',
    'Africa/Accra': 'GH',
    'Africa/Algiers': 'DZ',
    'Africa/Tunis': 'TN'
};

/**
 * Language subtags that are overwhelmingly tied to one country. Languages
 * shared across many countries (en, es, pt, fr, de, it, ar, ru…) are absent
 * on purpose; for those only the region subtag is used.
 */
export const LANGUAGE_ONLY_COUNTRY: Readonly<Record<string, string>> = {
    ja: 'JP',
    ko: 'KR',
    th: 'TH',
    vi: 'VN',
    id: 'ID',
    ms: 'MY',
    fil: 'PH',
    tl: 'PH',
    my: 'MM',
    km: 'KH',
    lo: 'LA',
    mn: 'MN',
    he: 'IL',
    iw: 'IL',
    el: 'GR',
    uk: 'UA',
    be: 'BY',
    bg: 'BG',
    ro: 'RO',
    hu: 'HU',
    cs: 'CZ',
    sk: 'SK',
    fi: 'FI',
    sv: 'SE',
    no: 'NO',
    nb: 'NO',
    da: 'DK',
    nl: 'NL',
    fa: 'IR',
    hi: 'IN'
};

const REGION_ALIASES: Readonly<Record<string, string>> = { UK: 'GB' };

/** null when the zone is not in the coarse map (no judgement). */
export function timezoneCountry(timezone: string | null | undefined): string | null {
    if (typeof timezone !== 'string') return null;
    const zone = timezone.trim();
    if (!zone) return null;
    return TIMEZONE_COUNTRY[zone] || null;
}

/**
 * Primary language -> country. A region subtag wins (`ja-JP` -> JP,
 * `en-US` -> US, `zh-Hant-TW` -> TW); otherwise only unambiguous languages
 * map. Returns null when the tag carries no usable geography.
 */
export function languageCountry(language: string | null | undefined): string | null {
    if (typeof language !== 'string') return null;
    const parts = language.trim().toLowerCase().split(/[-_]/).filter(Boolean);
    if (!parts.length) return null;
    const region = parts.slice(1).find((part) => /^[a-z]{2}$/.test(part));
    if (region) {
        const code = region.toUpperCase();
        const normalized = REGION_ALIASES[code] || code;
        return normalizeCountryCode(normalized);
    }
    return LANGUAGE_ONLY_COUNTRY[parts[0]] || null;
}

export interface GeoConsistencyInput {
    countryCode?: string | null;
    timezone?: string | null;
    languages?: readonly string[] | null;
}

/**
 * `none` when the IP country is unknown or both mapped values agree; `tz` /
 * `lang` when exactly one disagrees; `both` when both disagree. Unknown
 * timezone/language never counts as a mismatch.
 */
export function computeGeoMismatch(input: GeoConsistencyInput): GeoMismatch {
    const ipCountry = normalizeCountryCode(input.countryCode);
    if (!ipCountry) return 'none';
    const tzCountry = timezoneCountry(input.timezone);
    const primaryLanguage = Array.isArray(input.languages) ? input.languages[0] : undefined;
    const langCountry = languageCountry(primaryLanguage);
    const tzMismatch = !!tzCountry && tzCountry !== ipCountry;
    const langMismatch = !!langCountry && langCountry !== ipCountry;
    if (tzMismatch && langMismatch) return 'both';
    if (tzMismatch) return 'tz';
    if (langMismatch) return 'lang';
    return 'none';
}
