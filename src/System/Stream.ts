import { Message, TextChannel, DiscordAPIError } from "discord.js";

export class StreamHandler {
    private channel: TextChannel;
    private message: Message | null;
    private accumulatedResponse: string = "";
    private lastEditContent: string = "";
    private lastEditTime: number = 0;
    private editTimeout: NodeJS.Timeout | null = null;
    private editQueued: boolean = false;
    private isEditing: boolean = false;
    private isFinished: boolean = false;

    // --- 定数 ---
    private readonly EDIT_INTERVAL: number = 1000; // メッセージ編集間隔 (ミリ秒) - 1秒に設定
    private readonly MAX_EDIT_LENGTH: number = 1990; // 編集時の最大文字数
    private readonly MAX_MESSAGE_LENGTH: number = 2000; // Discordの最大メッセージ長

    constructor(channel: TextChannel, initialMessage: Message) {
        this.channel = channel;
        this.message = initialMessage;
    }

    /**
     * AIからのテキストチャンクをバッファに追加し、編集をスケジュールします。
     * @param delta 受信したテキストチャンク
     */
    public buffer(delta: string): void {
        if (this.isFinished || !this.message) return; // 終了後またはメッセージがない場合は何もしない

        this.accumulatedResponse += delta;
        this.scheduleEdit();
    }

    /**
     * ストリームの終了を通知し、最終的なメッセージ編集と分割送信を行います。
     */
    public async end(): Promise<void> {
        if (this.isFinished) return; // 既に終了処理済みなら何もしない
        this.isFinished = true;
        console.log("StreamHandler: end() called.");

        if (this.editTimeout) {
            clearTimeout(this.editTimeout);
            this.editTimeout = null;
            this.editQueued = false; // タイマーをクリアしたのでキューも解除
        }

        // 最終編集を実行
        await this.performFinalEdit();
    }

    /**
     * ストリーミング中または最終処理中に発生したエラーを処理します。
     * @param error 発生したエラー
     */
    public async handleError(error: any): Promise<void> {
        console.error("StreamHandler: handleError called.", error);
        this.isFinished = true; // エラー発生時も終了とみなす
        if (this.editTimeout) {
            clearTimeout(this.editTimeout);
            this.editTimeout = null;
            this.editQueued = false;
        }
        // 編集中フラグもリセット
        this.isEditing = false;

        const errorMessage = `エラーが発生しました: ${error?.message || error || '不明なエラー'}`;
        const truncatedError = errorMessage.substring(0, this.MAX_MESSAGE_LENGTH);

        if (this.message) {
            try {
                // 既存メッセージをエラーメッセージで編集試行
                await this.message.edit(truncatedError);
            } catch (editError) {
                console.error(`StreamHandler: Failed to edit message with error: ${editError}`);
                // 編集に失敗した場合（メッセージ削除など）、新しいメッセージでエラーを送信
                try {
                    await this.channel.send(truncatedError);
                } catch (sendError) {
                    console.error(`StreamHandler: Failed to send error message: ${sendError}`);
                }
                this.message = null; // メッセージ参照をクリア
            }
        } else {
            // そもそも初期メッセージがない場合（稀だが）、新しいメッセージでエラーを送信
            try {
                await this.channel.send(truncatedError);
            } catch (sendError) {
                console.error(`StreamHandler: Failed to send error message initially: ${sendError}`);
            }
        }
    }


    // --- 内部メソッド ---

    /**
     * レート制限を考慮してメッセージ編集をスケジュールします。
     */
    private scheduleEdit(): void {
        if (this.editQueued || this.isEditing || this.isFinished || !this.message) {
            return;
        }

        const now = Date.now();
        const timeSinceLastEdit = now - this.lastEditTime;

        // 編集を実行する関数
        const performEdit = async () => {
            this.editQueued = false; // スケジュールフラグ解除
            // isFinishedチェックを追加（タイマー実行前にend()が呼ばれた場合のため）
            if (this.isEditing || this.isFinished || !this.message) {
                return;
            }
            this.isEditing = true;   // 編集中フラグ

            // 表示用に末尾に ... をつけるか判断
            const currentContent = this.accumulatedResponse;
            let displayContent = currentContent.length > this.MAX_EDIT_LENGTH
                ? currentContent.substring(0, this.MAX_EDIT_LENGTH) + "..."
                : currentContent;

            // 空文字や前回と同じ場合は編集しない
            if (displayContent && displayContent !== this.lastEditContent) {
                try {
                    // contentが空文字列の場合editは失敗するためチェック
                    if (displayContent.length === 0) {
                        displayContent = "..."; // 空の代わりにインジケータ表示
                    }
                    await this.message.edit(displayContent);
                    this.lastEditContent = displayContent;
                    this.lastEditTime = Date.now();
                } catch (editError: any) {
                    console.warn(`StreamHandler: メッセージ編集エラー (スケジュール実行中): ${editError}`);
                    if (editError instanceof DiscordAPIError && editError.code === 10008) { // Unknown Message
                        console.log("StreamHandler: 編集対象のメッセージが見つかりません。ストリーミング編集を停止します。");
                        this.message = null; // メッセージ参照をクリア
                        this.isFinished = true; // 終了扱いにする
                        if (this.editTimeout) clearTimeout(this.editTimeout);
                        this.editTimeout = null;
                        this.editQueued = false;
                    }
                    // その他のエラーは継続を試みる場合もあるが、一旦ログのみ
                } finally {
                    this.isEditing = false; // 編集中フラグ解除
                    // 編集中にend()が呼ばれた可能性があるので再チェック
                    if (this.isFinished) {
                        console.log("StreamHandler: performEdit finished after stream ended, performing final edit check.");
                        await this.performFinalEdit(); // 念のため最終編集を試みる
                    }
                }
            } else {
                // 内容が同じかメッセージがない場合はフラグだけ解除
                this.isEditing = false;
                // 編集中にend()が呼ばれた可能性があるので再チェック
                if (this.isFinished) {
                    console.log("StreamHandler: performEdit skipped (no change/empty), performing final edit check.");
                    await this.performFinalEdit(); // 念のため最終編集を試みる
                }
            }
        };

        // 前回の編集から十分な時間が経過しているか？
        if (timeSinceLastEdit >= this.EDIT_INTERVAL) {
            // すぐに編集を実行
            performEdit();
        } else {
            // 必要な待機時間を計算してタイマーをセット
            this.editQueued = true; // スケジュールフラグ
            const delay = this.EDIT_INTERVAL - timeSinceLastEdit;
            if (this.editTimeout) clearTimeout(this.editTimeout); // 既存タイマーをクリア
            this.editTimeout = setTimeout(performEdit, delay);
        }
    }

    /**
     * ストリーム終了時に最終的なメッセージ編集と長文分割送信を行います。
     */
    private async performFinalEdit(): Promise<void> {
        // 既に編集中なら少し待って再試行
        if (this.isEditing) {
            console.log("StreamHandler: Waiting for ongoing edit before final edit.");
            setTimeout(() => this.performFinalEdit(), 100); // 100ms待つ
            return;
        }
        // isFinished チェックは end() で行われているのでここでは不要かもだが念のため
        if (!this.message || !this.isFinished) {
            console.log("StreamHandler: Final edit skipped (no message or not finished).");
            return; // メッセージがないか、終了フラグが立っていなければ何もしない
        }

        console.log("StreamHandler: Performing final edit.");
        this.isEditing = true; // 最終編集中フラグ (分割送信を含む)

        const finalContent = this.accumulatedResponse;
        const firstChunk = finalContent.substring(0, this.MAX_MESSAGE_LENGTH);
        const isEmptyResponse = finalContent.length === 0;

        try {
            // 応答が空の場合のメッセージ
            const editContent = isEmptyResponse ? "AIからの応答がありませんでした。" : firstChunk;

            // 最終内容が前回編集時と同じでも、"..." が付いていた可能性があるので必ず編集する
            await this.message.edit(editContent);
            this.lastEditContent = editContent; // 最終状態を記録
            this.lastEditTime = Date.now();
            console.log("StreamHandler: Final edit complete.");

            // --- ストリーミング完了後の長文分割処理 ---
            if (finalContent.length > this.MAX_MESSAGE_LENGTH) {
                console.log("StreamHandler: Response too long, splitting message.");
                for (let i = this.MAX_MESSAGE_LENGTH; i < finalContent.length; i += this.MAX_MESSAGE_LENGTH) {
                    const nextChunk = finalContent.substring(i, i + this.MAX_MESSAGE_LENGTH);
                    // レート制限に引っかからないよう、少し待つことも検討 (Discord.jsが内部で処理してくれるはずだが念のため)
                    // await new Promise(resolve => setTimeout(resolve, 50));
                    try {
                        await this.channel.send({ content: nextChunk });
                    } catch (splitSendError) {
                        console.error(`StreamHandler: 分割メッセージ送信エラー: ${splitSendError}`);
                        // 1つのチャンク送信失敗しても、次を試みる（部分的にでも送信するため）
                    }
                }
            }
        } catch (finalEditError: any) {
            console.error(`StreamHandler: 最終編集エラー: ${finalEditError}`);
            // 最終編集に失敗した場合、長文分割送信を試みる
            if (finalContent.length > 0 && !(finalEditError instanceof DiscordAPIError && finalEditError.code === 10008)) { // Unknown Message以外
                console.log("StreamHandler: Final edit failed, attempting to send as new messages.");
                try {
                    for (let i = 0; i < finalContent.length; i += this.MAX_MESSAGE_LENGTH) {
                        const nextChunk = finalContent.substring(i, i + this.MAX_MESSAGE_LENGTH);
                        // await new Promise(resolve => setTimeout(resolve, 50));
                        if (i === 0 && this.message?.reference?.messageId) { // 元のメッセージがあればリプライ形式で
                            await this.channel.send({ content: nextChunk, reply: { messageReference: this.message.reference.messageId } });
                        } else {
                            await this.channel.send({ content: nextChunk });
                        }
                    }
                } catch (splitSendError) {
                    console.error(`StreamHandler: 最終編集失敗後の分割送信エラー: ${splitSendError}`);
                    // ここで失敗したら諦める
                    try { // 最後の試みとして短いエラーメッセージを送る
                        await this.channel.send("応答の送信中にエラーが発生しました。");
                    } catch { }
                }
            } else if (isEmptyResponse && !(finalEditError instanceof DiscordAPIError && finalEditError.code === 10008)) {
                // 応答が空で、編集に失敗した場合（メッセージ削除以外）
                try {
                    await this.channel.send("AIからの応答がありませんでした。");
                } catch { }
            }
            // Unknown Messageの場合は、メッセージが削除されたので何もしない
        } finally {
            this.isEditing = false; // 最終処理完了
            // メッセージの参照を保持し続ける必要はないかもしれない
            // this.message = null;
        }
    }
}