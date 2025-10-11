// src/commands/staff/subcommands/ai-tools/weather.ts
import { OpenAITool, ToolHandler } from '../../../../types/openai';

/**
 * 天気取得ツール (気象庁の非公式 JSON API を利用)
 * パラメータ:
 * - area_code?: string  (ex: '340000' のようなオフィスコード)
 * - prefecture?: string (県名、例: '広島')
 */
export const weatherToolDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'get_weather',
        description: '指定した地域の天気予報を返します。area_code または prefecture を指定してください。',
        parameters: {
            type: 'object',
            properties: {
                area_code: { type: 'string', description: '気象庁のエリアコード（例: 340000）' },
                prefecture: { type: 'string', description: '県名（例: 広島）' }
            },
            required: []
        }
    }
};

export const weatherToolHandler: ToolHandler = async (args: { area_code?: string; prefecture?: string }) => {
    try {
        const areaJsonUrl = 'https://www.jma.go.jp/bosai/common/const/area.json';

        // helper: fetch JSON
        const fetchJson = async (url: string) => {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
            return await res.json();
        };

        const areaData = await fetchJson(areaJsonUrl);

        let areaCode: string | undefined = args.area_code;
        if (!areaCode && args.prefecture) {
            // 探索: offices に prefecture 名を含むキーを探す
            const offices = areaData.offices || {};
            for (const [code, info] of Object.entries(offices)) {
                const name = (info as any).name || '';
                if (name.includes(args.prefecture)) {
                    areaCode = code;
                    break;
                }
            }
        }

        if (!areaCode) {
            return { error: 'area_code または prefecture を指定してください（例: prefecture: "広島"）' };
        }

        const forecastUrl = `https://www.jma.go.jp/bosai/forecast/data/forecast/${areaCode}.json`;
        const forecast = await fetchJson(forecastUrl);

        if (!Array.isArray(forecast) || forecast.length === 0) {
            return { error: '天気予報データが見つかりませんでした' };
        }

        // 代表的な最初の要素を要約して返す
        const item = forecast[0];
        const publishingOffice = item.publishingOffice;
        const reportDatetime = item.reportDatetime;

        const summary: any[] = [];
        if (Array.isArray(item.timeSeries)) {
            for (const ts of item.timeSeries.slice(0, 2)) {
                const times = ts.timeDefines || ts.timeDefines || [];
                const areas = ts.areas || [];
                for (const a of areas) {
                    summary.push({
                        area: a.area?.name || a.area?.code || 'unknown',
                        weathers: a.weathers || a.weatherCodes || [],
                        timeDefines: times
                    });
                }
            }
        }

        return {
            publishingOffice,
            reportDatetime,
            areaCode,
            summary
        };
    } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
    }
};
