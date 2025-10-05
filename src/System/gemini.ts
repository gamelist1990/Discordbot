import {
    GenerateContentResponse,
    GoogleGenAI,
    Content 
} from "@google/genai";
import JsonDB from "../database";

// --- 定数 ---
const DB_NAME = "Gemini";
const API_KEY_DB_KEY = "gemini_apikey";
const DEFAULT_API_KEY_VALUE = { api_key: "" };

// --- データベースとAPIキーの初期化 ---
// データベースは Exeにした場合でも正常に機能するはず
const db = new JsonDB(DB_NAME);

/**
 * データベースからGemini APIキーを取得します。
 * キーが存在しない場合は、空のキーでデータベースを初期化します。
 * @returns APIキーを含むオブジェクト { api_key: string }
 */
async function getApiKey(): Promise<{ api_key: string }> {
    let keyData = await db.get(API_KEY_DB_KEY, DB_NAME);

    if (!keyData) {
        console.warn(`APIキー "${API_KEY_DB_KEY}" が見つかりません。デフォルト値を設定します。`);
        await db.set(API_KEY_DB_KEY, DB_NAME, DEFAULT_API_KEY_VALUE);
        keyData = DEFAULT_API_KEY_VALUE;
    }

    if (typeof keyData?.api_key !== 'string') {
        console.error("データベースから取得したAPIキーの形式が無効です。空のキーを使用します。", keyData);
        return DEFAULT_API_KEY_VALUE;
    }

    return keyData;
}

const apiKey = await getApiKey();

const gemini = new GoogleGenAI({
    apiKey: apiKey.api_key
});

class Gemini {
    private model: string;
    private useSearch: boolean;

    /**
     * Geminiクラスのインスタンスを生成します。
     * @param model 使用するGeminiモデル名 (例: "gemini-1.5-flash")
     * @param useSearch Google検索機能を使用するかどうか (オプション、デフォルトはfalse)
     */
    constructor(model: string, useSearch: boolean = false) {
        if (!model) {
            throw new Error("Geminiモデル名が指定されていません。");
        }
        this.model = model;
        this.useSearch = useSearch;
    }

    /**
     * 指定されたプロンプトとシステム指示を使用してGemini APIにリクエストを送信し、応答を取得します。
     * @param prompt Geminiへのユーザー入力テキスト
     * @param system Geminiへのシステム指示 (オプション)
     * @returns Geminiからの応答テキスト、またはエラーメッセージ
     */
    public async chat(prompt: string, system?: string): Promise<string> {
        if (!apiKey.api_key) {
            return "GeminiのAPIキーが設定されていません。";
        }
        if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
            return "有効なプロンプトを入力してください。";
        }

        try {
            let response: GenerateContentResponse | undefined;
            const contents: Content[] = [{ role: 'user', parts: [{ text: prompt }] }];
            const config: {
                tools?: any[];
                systemInstruction?: Content; // SYstem プロンプト
            } = {};

            if (system && typeof system === 'string' && system.trim() !== '') {
                config.systemInstruction = { parts: [{ text: system }] };
            }

            if (this.useSearch) {
               // Googleのリファレンスだと これでいいらしい
                config.tools = [{ googleSearch: {} }];
            }

            response = await gemini.models.generateContent({
                model: this.model,
                contents: contents, 
                config: config 
            });


            const responseCandidate = response?.candidates?.[0];

            if (responseCandidate?.content?.parts?.[0]?.text) {
                return responseCandidate.content.parts[0].text;
            } else if (responseCandidate?.finishReason) {
                console.warn(`Geminiからのテキスト応答が空でした。終了理由: ${responseCandidate.finishReason}`);
                return `Geminiからの応答が完了しませんでした (理由: ${responseCandidate.finishReason})。プロンプトや設定を確認してください。`;
            } else {
                console.warn("Geminiからの応答が空または無効でした。", response);
                return "Geminiからの応答がありませんでした。";
            }

        } catch (error: any) {
            console.error("Gemini APIの呼び出し中にエラーが発生しました:", error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (error?.response?.data?.error?.message) {
                return `Gemini APIエラー: ${error.response.data.error.message}`;
            }
            return `不明なエラーが発生しました: ${errorMessage}`;
        }
    }
}

export { Gemini };