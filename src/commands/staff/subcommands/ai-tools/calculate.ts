import type { OpenAITool, ToolHandler } from '../../../../types/openai.js';
import { runBashCalculation } from '../../../../core/ai/BashCalculation.js';

export const bashCalculationDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'calculate_bash',
        description: '計算専用のBash記述を実行する。暗算で断定せず、このツールで検算する。高精度小数・巨大整数・平方根・三角関数・対数・指数・数列・集計はbc -lを使いscaleで精度を指定。s(x)=sin、c(x)=cos、a(x)=atan、l(x)=自然対数、e(x)=指数。角度はラジアン。bc内の変数・配列・関数・for/whileも使用可能。Bashの$((...))は固定長整数専用で、小数や大きい整数には使わない。入力はecho "$((数式))"、printf \'%s\\n\' \'bcプログラム\' | bc -l、またはbc -l <<\'BC\'の引用付きヒアドキュメントのみ。任意のシェルコマンド、ファイル操作、ネット接続、Python等は未対応。実行5秒、CPU3秒、メモリー128MiB、出力32000バイトまで。',
        parameters: {
            type: 'object', properties: {
                command: { type: 'string', description: '計算用Bash記述（16000文字以内）。例: printf \'%s\\n\' \'scale=80; sqrt(2)\' | bc -l。複雑な例: bc -l <<\'BC\'\ndefine f(n) { auto r,i; r=1; for(i=2;i<=n;i++) r*=i; return(r); }\nf(100)\nBC' },
            }, required: ['command'], additionalProperties: false,
        },
    },
};

export const bashCalculationHandler: ToolHandler = async (args: unknown) => {
    if (!args || typeof args !== 'object' || !('command' in args) || typeof args.command !== 'string') {
        return { error: 'commandに計算用Bash記述を指定してください' };
    }
    return runBashCalculation(args.command);
};
