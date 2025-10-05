
/**
 * 静的に定義されたコマンドモジュールを非同期で読み込みます。
 * @returns 読み込みが成功したかどうかを示す boolean
 */
export async function loadStaticCommands(): Promise<boolean> {
    console.log('⚙️ 静的コマンドモジュール読み込み開始...');
    try {
        const modulePath = './import';
        await import(modulePath); 
        console.log('✔ 静的コマンドモジュールの読み込み/登録が完了しました。');
        return true;
    } catch (error: any) {
        console.error('❌ 静的コマンドモジュールの読み込み中にエラーが発生しました:', error.message);
        return false;
    }
}