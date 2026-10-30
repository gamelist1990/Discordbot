import { config, NEMOTRON_MODEL } from '../../../config.js';
import type { OpenAITool, ToolHandler } from '../../../types/openai.js';
import type { ChatAIToolRegistrar } from './types.js';

type VisionToolContext = {
    images?: Array<{
        index: number;
        author: string;
        dataUrl: string;
    }>;
};

const visionDescribeDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'vision_describe_image',
        description: '画像認識が必要な場合だけ、指定された直近添付画像をHomePCのLFMとA8のNemotronで解析します。',
        parameters: {
            type: 'object',
            properties: {
                imageIndex: { type: 'number', description: '解析する画像番号。1から始まります。' },
                prompt: { type: 'string', description: '画像について知りたい内容。未指定なら短く説明します。' },
            },
            required: ['imageIndex'],
        },
    },
};

const visionDescribeHandler: ToolHandler = async (args, context?: VisionToolContext) => {
    const imageIndex = Math.max(1, Math.floor(Number(args?.imageIndex ?? 1)));
    const prompt = String(args?.prompt ?? 'この画像を日本語で簡潔に説明してください。').trim() || 'この画像を日本語で簡潔に説明してください。';
    const image = context?.images?.find(entry => entry.index === imageIndex);

    if (!image) {
        return `画像 ${imageIndex} が見つかりません。直近の添付画像番号を確認してください。`;
    }

    try {
        const response = await fetch(`${config.pexAi.endpoint.replace(/\/+$/, '')}/chat/completions`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                ...(config.pexAi.apiKey ? { authorization: `Bearer ${config.pexAi.apiKey}` } : {}),
            },
            body: JSON.stringify({
                model: NEMOTRON_MODEL,
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: prompt },
                            { type: 'image_url', image_url: { url: image.dataUrl, detail: 'auto' } },
                        ],
                    },
                ],
                temperature: 0.2,
                // Leave room for reasoning plus a final user-visible answer.
                max_tokens: 1200,
                chat_template_kwargs: { enable_thinking: true },
            }),
        });

        if (!response.ok) {
            return `VISION_ERROR: HTTP ${response.status} ${await response.text().catch(() => '')}`.slice(0, 1200);
        }

        const data = await response.json() as any;
        const choice = data?.choices?.[0];
        const text = choice?.message?.content;
        if ((!text || !String(text).trim()) && choice?.finish_reason === 'length') {
            return 'VISION_ERROR: 思考が出力上限に達し、最終回答を生成できませんでした。';
        }
        return typeof text === 'string' && text.trim()
            ? text.trim()
            : 'VISION_ERROR: 画像解析APIから有効な応答がありませんでした。';
    } catch (error) {
        return `VISION_ERROR: ${error instanceof Error ? error.message : String(error)}`;
    }
};

export const registerVisionDescribeTool: ChatAIToolRegistrar = (manager) => {
    manager.registerTool(visionDescribeDefinition, visionDescribeHandler);
};
