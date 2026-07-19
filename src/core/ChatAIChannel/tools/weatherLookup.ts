import type { OpenAITool, ToolHandler } from '../../../types/openai.js';
import type { ChatAIToolRegistrar } from './types.js';

const weatherDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'weather_lookup',
        description: '指定地点の現在の天気概要を取得します。',
        parameters: {
            type: 'object',
            properties: {
                location: { type: 'string', description: '都市名、地名、緯度経度など' },
            },
            required: ['location'],
        },
    },
};

const weatherHandler: ToolHandler = async (args) => {
    const location = String(args?.location ?? '').trim();
    if (!location) return '地点が空です。';
    const url = `https://wttr.in/${encodeURIComponent(location)}?format=j1&lang=ja`;
    try {
        const response = await fetch(url, { headers: { 'user-agent': 'PexisChatAI/1.0' } });
        if (!response.ok) return `WEATHER_ERROR: HTTP ${response.status}`;
        const data = await response.json() as any;
        const current = data.current_condition?.[0];
        if (!current) return '天気情報を取得できませんでした。';
        return [
            `地点: ${location}`,
            `天気: ${current.lang_ja?.[0]?.value || current.weatherDesc?.[0]?.value || 'unknown'}`,
            `気温: ${current.temp_C}℃ / 体感: ${current.FeelsLikeC}℃`,
            `湿度: ${current.humidity}%`,
            `風速: ${current.windspeedKmph} km/h`,
            `観測時刻: ${current.localObsDateTime || 'unknown'}`,
        ].join('\n');
    } catch (error) {
        return `WEATHER_ERROR: ${error instanceof Error ? error.message : String(error)}`;
    }
};

export const registerWeatherLookupTool: ChatAIToolRegistrar = (manager) => {
    manager.registerTool(weatherDefinition, weatherHandler);
};
