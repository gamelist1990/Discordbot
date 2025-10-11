// src/commands/staff/subcommands/ai-tools/time.ts
import { OpenAITool, ToolHandler } from '../../../../types/openai';

export const timeToolDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'get_time',
        description: '現在の日時を返します。オプションで timezone を指定できます（例: Asia/Tokyo）。',
        parameters: {
            type: 'object',
            properties: {
                timezone: { type: 'string', description: 'IANA timezone name (例: Asia/Tokyo)' }
            },
            required: []
        }
    }
};

export const timeToolHandler: ToolHandler = (args: { timezone?: string }) => {
    try {
        const tz = args?.timezone;
        const now = new Date();
        let formatted: string;
        if (tz && Intl && (Intl as any).DateTimeFormat) {
            try {
                formatted = new Intl.DateTimeFormat('ja-JP', { timeZone: tz, dateStyle: 'full', timeStyle: 'long' }).format(now);
            } catch (e) {
                formatted = now.toString();
            }
        } else {
            formatted = now.toString();
        }

        return {
            timezone: tz || Intl.DateTimeFormat().resolvedOptions().timeZone,
            now: now.toISOString(),
            human: formatted
        };
    } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
    }
};
