import { EmbedBuilder } from "discord.js";
import { registerCommand } from "../../..";
import { Command } from "../../../types/command";


interface FortuneResult {
    category: '大吉' | '中吉' | '吉' | '小吉' | '末吉' | '凶' | '大凶'; // 運勢カテゴリ
    message: string;        // メインのメッセージ
    advice?: string;       // アドバイス (任意)
    luckyItem?: string;    // ラッキーアイテム (任意)
    luckyColor?: string;   // ラッキーカラー (任意)
    color: number;         // Embedの色 (カテゴリに基づくと一貫性が出る)
}

// カテゴリごとの基本色
const categoryColors: Record<FortuneResult['category'], number> = {
    '大吉': 0xFFD700, // 金色
    '中吉': 0x00FF7F, // 明るい緑
    '吉': 0x87CEEB, // 空色
    '小吉': 0xFFA07A, // 明るいサーモンピンク
    '末吉': 0x778899, // ライトスレートグレー
    '凶': 0xDC143C, // クリムゾンレッド
    '大凶': 0x4B0082, // インディゴ
};

type FortunePreset = 'normal' | 'love' | 'study' | 'money'; // 必要に応じて他のプリセットを追加可能

const fortunes: Record<FortunePreset, FortuneResult[]> = {
    // --- 通常のおみくじ ---
    normal: [
        // 大吉
        { category: '大吉', message: '雲ひとつない快晴のような運勢！何事も驚くほどうまくいくでしょう。自信を持って前へ！', advice: '周りの人への感謝を忘れずにいると、さらに運気が上昇します。', luckyItem: '太陽のモチーフ', luckyColor: '金色', color: categoryColors['大吉'] },
        { category: '大吉', message: '強い追い風が吹いています！計画していたことがあるなら、今が実行のチャンスです！', advice: '大胆な挑戦が吉と出ます。ためらわないで！', luckyItem: '新しい靴', luckyColor: 'オレンジ', color: categoryColors['大吉'] },
        { category: '大吉', message: '予想外の幸運が舞い込みそう！チャンスの女神が微笑んでいます。積極的に行動しましょう。', advice: '謙虚な姿勢を忘れずに、周りの意見にも耳を傾けると良いでしょう。', luckyItem: '四つ葉のクローバー', luckyColor: 'エメラルドグリーン', color: categoryColors['大吉'] },
        // 中吉
        { category: '中吉', message: '努力が着実に実を結び始めています。この調子で続ければ、目標達成は目前です！', advice: '小さな成功体験を積み重ねることが、大きな自信につながります。', luckyItem: '万年筆', luckyColor: '緑', color: categoryColors['中吉'] },
        { category: '中吉', message: '穏やかで安定した運気。急がず、焦らず、自分のペースを大切にしましょう。', advice: '読書や瞑想など、心を落ち着ける時間を持つと良いでしょう。', luckyItem: 'ブックマーク', luckyColor: '水色', color: categoryColors['中吉'] },
        { category: '中吉', message: '人間関係が良好な日。チームワークを発揮すれば、難しい課題も乗り越えられます。', advice: '積極的にコミュニケーションを取り、相手への配慮を忘れずに。', luckyItem: 'お揃いのマグカップ', luckyColor: 'クリーム色', color: categoryColors['中吉'] },
        { category: '中吉', message: '日々の積み重ねが評価される兆し。地道な努力が認められ、達成感を得られるでしょう。', advice: '手を抜かずに、最後まで丁寧に取り組むことが重要です。', luckyItem: 'スケジュール帳', luckyColor: 'ネイビー', color: categoryColors['中吉'] },
        // 吉
        { category: '吉', message: '平凡な一日の中に、ささやかな幸せが隠れています。見つける楽しみを味わって。', advice: '道端の花や空の雲など、普段見過ごしがちなものに目を向けてみて。', luckyItem: 'マグカップ', luckyColor: '白', color: categoryColors['吉'] },
        { category: '吉', message: '思いがけない人から嬉しい連絡があるかも。コミュニケーションを大切に。', advice: '聞き役に徹すると、良い情報が得られそうです。', luckyItem: 'スマートフォン', luckyColor: '黄色', color: categoryColors['吉'] },
        { category: '吉', message: '新しい趣味や興味が見つかるかも。インスピレーションを大切にしてみましょう。', advice: '気になったことは、まず試してみる軽い気持ちが大切です。', luckyItem: 'スケッチブック', luckyColor: 'ライムグリーン', color: categoryColors['吉'] },
        { category: '吉', message: '少し気分転換が必要な時。近所を散歩したり、好きな音楽を聴いたりしてみては。', advice: 'リフレッシュすることで、新たな活力が湧いてきます。', luckyItem: 'イヤホン', luckyColor: 'ラベンダー', color: categoryColors['吉'] },
        { category: '吉', message: '周りの人との協力がスムーズに進む日。頼ったり頼られたり、良い関係を築けそうです。', advice: '感謝の言葉を具体的に伝えると、より良い関係につながります。', luckyItem: '共有できるお菓子', luckyColor: 'ベージュ', color: categoryColors['吉'] },
        // 小吉
        { category: '小吉', message: '小さなつまずきがあるかもしれませんが、冷静に対処すれば乗り越えられます。', advice: '計画に余裕を持たせ、焦らないことが大切です。', luckyItem: 'メモ帳', luckyColor: '茶色', color: categoryColors['小吉'] },
        { category: '小吉', message: '判断に迷うことがありそう。信頼できる人に相談してみると良いでしょう。', advice: '直感も大切ですが、客観的な意見も参考に。', luckyItem: 'お気に入りのキーホルダー', luckyColor: '灰色', color: categoryColors['小吉'] },
        { category: '小吉', message: 'うっかりミスに注意。特に、メールの宛先やメッセージの誤送信に気を付けて。', advice: '送信前にもう一度確認する癖をつけましょう。', luckyItem: '修正テープ', luckyColor: 'ライトグレー', color: categoryColors['小吉'] },
        { category: '小吉', message: '少し疲れが溜まっているかも。無理せず、休息を意識しましょう。', advice: '短い昼寝や、温かいお風呂でリラックスするのも効果的です。', luckyItem: 'アイマスク', luckyColor: 'ペールブルー', color: categoryColors['小吉'] },
        { category: '小吉', message: '予定通りに進まないことも。臨機応変に対応する柔軟性が求められます。', advice: '完璧を目指しすぎず、「まあ、いっか」と受け流すことも時には必要です。', luckyItem: '折り畳み傘', luckyColor: 'カーキ', color: categoryColors['小吉'] },
        // 末吉
        { category: '末吉', message: '油断していると、思わぬところで足をすくわれるかも。気を引き締めていきましょう。', advice: '確認作業を怠らないように。ダブルチェックが有効です。', luckyItem: '腕時計', luckyColor: '紺色', color: categoryColors['末吉'] },
        { category: '末吉', message: '言葉足らずで誤解を招きやすい時。説明は丁寧に、相手に伝わっているか確認しましょう。', advice: 'メールやチャットだけでなく、直接話す機会を作るのも良いでしょう。', luckyItem: 'クリアファイル', luckyColor: 'ダークグリーン', color: categoryColors['末吉'] },
        { category: '末吉', message: '体調管理に気を配りたい日。少しでも不調を感じたら、無理せず休みましょう。', advice: '栄養バランスの取れた食事と、十分な睡眠を心がけて。', luckyItem: '体温計', luckyColor: 'オフホワイト', color: categoryColors['末吉'] },
        { category: '末吉', message: '集中力が途切れがち。作業環境を見直したり、短時間集中を繰り返すなど工夫してみて。', advice: '周りの音や視線が気になるなら、場所を変えるのも手です。', luckyItem: '耳栓', luckyColor: 'ボルドー', color: categoryColors['末吉'] },
        // 凶
        { category: '凶', message: '今日は少し運気が低迷気味。無理な行動は避け、慎重に過ごしましょう。', advice: '休息をしっかり取り、エネルギーを充電する日に。', luckyItem: '温かい飲み物', luckyColor: '黒', color: categoryColors['凶'] },
        { category: '凶', message: '対人関係で誤解が生じやすい時。言葉遣いに注意し、丁寧なコミュニケーションを心がけて。', advice: '感情的にならず、冷静に話すことが解決の糸口です。', luckyItem: 'ハンカチ', luckyColor: '紫', color: categoryColors['凶'] },
        { category: '凶', message: '些細なことでイライラしてしまいそう。感情のコントロールを意識しましょう。', advice: '深呼吸をしたり、一時的にその場を離れたりするのも有効です。', luckyItem: 'ストレスボール', luckyColor: 'ダークレッド', color: categoryColors['凶'] },
        { category: '凶', message: '忘れ物や落とし物に注意。持ち物はしっかり管理し、出かける前や後に確認を。', advice: 'カバンの中を整理整頓しておくと、紛失防止につながります。', luckyItem: 'ネームタグ', luckyColor: 'チャコールグレー', color: categoryColors['凶'] },
        // 大凶
        { category: '大凶', message: '嵐の前の静けさ…？今日は大人しくしているのが賢明です。大きな決断や行動は控えて。', advice: '無理せず、自分の心と体を守ることを最優先に。', luckyItem: 'お守り', luckyColor: '濃い灰色', color: categoryColors['大凶'] },
        { category: '大凶', message: '予期せぬトラブルに巻き込まれる可能性が。危険な場所や状況には近づかないように。', advice: 'いつも以上に慎重に行動し、周りの状況をよく観察しましょう。', luckyItem: '防犯ブザー', luckyColor: '漆黒', color: categoryColors['大凶'] },
    ],
    // --- 恋占い ---
    love: [
        // 大吉
        { category: '大吉', message: '最高の恋愛運！運命の赤い糸が強く結ばれる日。ドラマチックな展開が待っているかも！💖', advice: '自分の魅力を信じて、積極的にアプローチしてみて！', luckyItem: 'ハートのアクセサリー', luckyColor: 'ローズピンク', color: categoryColors['大吉'] },
        { category: '大吉', message: '意中の人との関係が急速に進展する予感！二人きりになれるチャンスを大切に。', advice: '素直な気持ちを言葉で伝えるのが効果的です。', luckyItem: 'ペアの小物', luckyColor: 'ベビーピンク', color: categoryColors['大吉'] },
        { category: '大吉', message: '相手からのアプローチも期待できそう！自然体でいることが、あなたの魅力を引き出します。', advice: '笑顔を忘れずに、明るいオーラを纏いましょう。', luckyItem: '鏡', luckyColor: 'パールホワイト', color: categoryColors['大吉'] },
        // 中吉
        { category: '中吉', message: '穏やかで心温まる時間が過ごせそう。相手への思いやりが、二人の絆を深めます。', advice: '共通の趣味や好きなことについて話すと、会話が弾みます。', luckyItem: '手作りのプレゼント', luckyColor: 'コーラルピンク', color: categoryColors['中吉'] },
        { category: '中吉', message: '新しい出会いのチャンスがありそう。いつもより少しおしゃれをして出かけてみては？✨', advice: '笑顔を忘れずにいると、魅力がさらにアップします。', luckyItem: '香水', luckyColor: 'ラベンダー', color: categoryColors['中吉'] },
        { category: '中吉', message: '気になる相手との共通点が見つかり、距離が縮まるきっかけに。', advice: '相手の好きなことに関心を持ち、質問してみると良いでしょう。', luckyItem: '話題の本や映画', luckyColor: 'ミントグリーン', color: categoryColors['中吉'] },
        { category: '中吉', message: '誠実な態度が相手に好印象を与える日。約束はきちんと守り、信頼関係を築きましょう。', advice: '聞き上手になることを意識すると、相手は心を開きやすくなります。', luckyItem: 'シンプルな腕時計', luckyColor: 'スカイブルー', color: categoryColors['中吉'] },
        // 吉
        { category: '吉', message: '友達だと思っていた相手から、意識される出来事があるかも？さりげない優しさが鍵。', advice: '相手の良いところを見つけて褒めてあげましょう。', luckyItem: 'お揃いのストラップ', luckyColor: 'パステルイエロー', color: categoryColors['吉'] },
        { category: '吉', message: '安定した関係を育める時。焦らず、二人のペースでゆっくりと愛を深めていきましょう。', advice: '感謝の気持ちを言葉で伝えると、相手は喜びます。', luckyItem: '写真立て', luckyColor: 'アイボリー', color: categoryColors['吉'] },
        { category: '吉', message: 'グループデートや複数人での交流の中に、良い出会いや進展のきっかけがありそう。', advice: '周りの人への気配りを忘れずに、自然体で楽しみましょう。', luckyItem: 'シェアできるお菓子', luckyColor: 'オレンジシャーベット', color: categoryColors['吉'] },
        { category: '吉', message: '相手の意外な一面を知ることができ、より魅力的に感じるかも。', advice: '固定観念を持たずに、相手の様々な側面を受け入れてみましょう。', luckyItem: '小さなサプライズ', luckyColor: 'ピーチ', color: categoryColors['吉'] },
        { category: '吉', message: 'デートはリラックスできる場所がおすすめ。公園でのんびりしたり、カフェでおしゃべりしたり。', advice: '飾らない素のあなたを見せることが、関係を深める近道です。', luckyItem: ' आरामदायकな服装', luckyColor: 'ライトブラウン', color: categoryColors['吉'] },
        // 小吉
        { category: '小吉', message: 'ちょっとした誤解やすれ違いが起こりやすいかも。コミュニケーション不足に注意。', advice: '相手の話を最後まで聞き、自分の気持ちも正直に伝えて。', luckyItem: '手鏡', luckyColor: 'ベージュ', color: categoryColors['小吉'] },
        { category: '小吉', message: '相手の些細な言動に一喜一憂してしまいそう。少し距離を置いて冷静になる時間も必要かも。', advice: '自分の感情に振り回されず、客観的に状況を見つめ直しましょう。', luckyItem: '好きな音楽プレイリスト', luckyColor: 'シルバーグレー', color: categoryColors['小吉'] },
        { category: '小吉', message: '自分の気持ちを伝えるのが少し難しいと感じるかも。焦らず、タイミングを見計らって。', advice: '手紙やメッセージなど、文字で伝えるのも一つの方法です。', luckyItem: '便箋と封筒', luckyColor: 'ペールグリーン', color: categoryColors['小吉'] },
        { category: '小吉', message: 'ライバルの存在が気になったり、少し不安になったりする場面があるかも。', advice: '他人と比較せず、自分自身の魅力を信じることが大切です。', luckyItem: 'お気に入りのアクセサリー', luckyColor: 'スモーキーピンク', color: categoryColors['小吉'] },
        // 末吉
        { category: '末吉', message: 'ライバルが出現したり、心が揺らぐ出来事があるかも。自分に自信を持つことが大切。', advice: '自分磨きを怠らず、魅力を高める努力をしましょう。', luckyItem: 'リップクリーム', luckyColor: 'シルバー', color: categoryColors['末吉'] },
        { category: '末吉', message: '過去の恋愛を引きずっているなら、少し立ち止まって自分の心と向き合う時間が必要かも。', advice: '無理に忘れようとせず、自分のペースで気持ちを整理していきましょう。', luckyItem: '日記帳', luckyColor: 'モスグリーン', color: categoryColors['末吉'] },
        { category: '末吉', message: '相手のペースに合わせすぎて、少し疲れてしまうかも。自分の時間も大切に。', advice: '時には「NO」と言う勇気も必要です。健全な関係のためにはバランスが大事。', luckyItem: 'アロマキャンドル', luckyColor: 'ディープブルー', color: categoryColors['末吉'] },
        { category: '末吉', message: 'マンネリを感じやすい時期かも。いつもと違うデートプランを提案してみるなど、変化を取り入れてみて。', advice: 'サプライズや新しい体験が、関係に新鮮さをもたらします。', luckyItem: '映画のチケット', luckyColor: 'ワインレッド', color: categoryColors['末吉'] },
        // 凶
        { category: '凶', message: '恋愛運は停滞気味。焦って行動すると裏目に出る可能性が。今は距離を置くのも手。', advice: '自分の時間を大切にし、趣味や好きなことに没頭するのも良いでしょう。', luckyItem: '日記帳', luckyColor: 'グレー', color: categoryColors['凶'] },
        { category: '凶', message: '些細なことから口論に発展しやすい時。感情的にならず、冷静な話し合いを心がけて。', advice: '一度距離を置いて、頭を冷やしてから話し合うのが良いかもしれません。', luckyItem: '深呼吸', luckyColor: 'ダークパープル', color: categoryColors['凶'] },
        { category: '凶', message: '相手への不信感が募る出来事があるかも。早合点せず、事実確認をしっかりと。', advice: '疑心暗鬼になると、良い関係も壊れてしまいます。落ち着いて。', luckyItem: '信頼できる友人への相談', luckyColor: 'ブラウン', color: categoryColors['凶'] },
        // 大凶
        { category: '大凶', message: '失恋や別れの危機…？感情的にならず、冷静に状況を見極める必要がありそう。💔', advice: '一人で抱え込まず、信頼できる友人に相談してみては。', luckyItem: '落ち着く音楽', luckyColor: 'ダークグレー', color: categoryColors['大凶'] },
        { category: '大凶', message: '三角関係や不誠実な関係に巻き込まれる暗示。甘い言葉や誘惑には注意して。', advice: '少しでも怪しいと感じたら、きっぱりと距離を置く勇気を持ちましょう。', luckyItem: '強い意志', luckyColor: 'ブラック', color: categoryColors['大凶'] },
    ],
    // --- 学業運 ---
    study: [
        // 大吉
        { category: '大吉', message: '知的好奇心が最高潮！難しい問題もスラスラ解け、新しい知識がどんどん吸収できるでしょう！🎓', advice: '興味を持った分野を深く掘り下げてみて。大きな発見があるかも。', luckyItem: '参考書', luckyColor: '青', color: categoryColors['大吉'] },
        { category: '大吉', message: '試験や発表で、実力以上の成果を発揮できそう！自信を持って臨みましょう！', advice: '日頃の努力が報われる時です。最後まで油断せずに準備を。', luckyItem: '合格祈願のお守り', luckyColor: '赤', color: categoryColors['大吉'] },
        { category: '大吉', message: '素晴らしい先生や先輩との出会いがありそう。積極的に質問し、多くを学びましょう。', advice: '謙虚な姿勢で教えを請うことが、成長への近道です。', luckyItem: 'ノートとペン', luckyColor: '白', color: categoryColors['大吉'] },
        // 中吉
        { category: '中吉', message: '集中力が高まり、勉強が捗る日。計画通りに進められそうです。📝', advice: '苦手分野の克服に取り組むと、効果が出やすいでしょう。', luckyItem: 'タイマー', luckyColor: '黄緑', color: categoryColors['中吉'] },
        { category: '中吉', message: '効率的な学習方法が見つかるかも。色々な方法を試してみて、自分に合ったスタイルを確立しましょう。', advice: 'インプットだけでなく、アウトプット（問題を解く、説明するなど）も意識して。', luckyItem: 'マインドマップ', luckyColor: 'ターコイズブルー', color: categoryColors['中吉'] },
        { category: '中吉', message: 'グループ学習やディスカッションで、新たな視点や気づきを得られそう。', advice: '自分の意見をしっかり持ちつつ、他の人の考えも尊重しましょう。', luckyItem: 'ホワイトボード', luckyColor: 'ライトオレンジ', color: categoryColors['中吉'] },
        { category: '中吉', message: '難しいと思っていた内容が、ふとしたきっかけで理解できるようになるかも。', advice: '諦めずに粘り強く取り組む姿勢が大切です。', luckyItem: '解説動画', luckyColor: 'シアン', color: categoryColors['中吉'] },
        // 吉
        { category: '吉', message: '友達と一緒に勉強すると、良い刺激を受けられそう。教え合うことで理解が深まります。🤝', advice: '休憩時間には雑談も楽しんで、リフレッシュしましょう。', luckyItem: 'ノート', luckyColor: 'オレンジ', color: categoryColors['吉'] },
        { category: '吉', message: '苦手な科目でも、基礎から丁寧に見直せば、着実に理解が進みます。', advice: '焦らず、一歩一歩、自分のペースで進めましょう。', luckyItem: '教科書', luckyColor: 'イエロー', color: categoryColors['吉'] },
        { category: '吉', message: '休憩時間に軽い運動を取り入れたり、窓を開けて換気したりすると、集中力が回復します。', advice: 'メリハリをつけて勉強することが、効率アップの鍵です。', luckyItem: 'ストレッチポール', luckyColor: 'グリーン', color: categoryColors['吉'] },
        { category: '吉', message: '興味のある分野のドキュメンタリーや関連書籍を読むと、学習意欲が高まりそう。', advice: '楽しみながら学ぶことが、知識の定着につながります。', luckyItem: '図書館カード', luckyColor: 'ピンク', color: categoryColors['吉'] },
        { category: '吉', message: '暗記科目は、声に出して読んだり、単語カードを使ったりすると覚えやすいでしょう。', advice: '五感を活用した学習法を取り入れてみましょう。', luckyItem: '単語カード', luckyColor: 'パープル', color: categoryColors['吉'] },
        // 小吉
        { category: '小吉', message: '少し集中力が散漫になりがちかも。勉強環境を整えて、気分転換を挟みましょう。🍃', advice: '短い時間でも良いので、毎日コツコツ続けることが大切です。', luckyItem: '付箋', luckyColor: 'ピンク', color: categoryColors['小吉'] },
        { category: '小吉', message: '誘惑が多い日。スマホの通知をオフにしたり、勉強場所を変えたりする工夫が必要かも。', advice: '自分の集中を妨げるものを、一時的に遠ざけましょう。', luckyItem: 'ノイズキャンセリングイヤホン', luckyColor: 'ライトブルー', color: categoryColors['小吉'] },
        { category: '小吉', message: '理解したつもりでも、いざ問題を解いてみると難しいかも。演習不足に注意。', advice: '知識のインプットだけでなく、アウトプットの練習もバランス良く行いましょう。', luckyItem: '問題集', luckyColor: 'ブラウン', color: categoryColors['小吉'] },
        { category: '小吉', message: '計画通りに進まなくても、焦らないで。計画を見直し、無理のないペースに調整しましょう。', advice: '完璧主義になりすぎず、柔軟に対応することが大切です。', luckyItem: '修正可能なペン', luckyColor: 'グレー', color: categoryColors['小吉'] },
        // 末吉
        { category: '末吉', message: 'ケアレスミスに注意が必要な日。見直しをしっかり行いましょう。🔍', advice: '焦らず、一つ一つ丁寧に取り組むことを心がけて。', luckyItem: '消しゴム', luckyColor: '紫', color: categoryColors['末吉'] },
        { category: '末吉', message: '勉強方法が自分に合っていないのかも？他の人のやり方を参考にしたり、先生に相談したりしてみては。', advice: '試行錯誤しながら、自分に最適な学習スタイルを見つけましょう。', luckyItem: '学習記録ノート', luckyColor: 'ネイビー', color: categoryColors['末吉'] },
        { category: '末吉', message: '睡眠不足は学習効率を大きく低下させます。夜更かしはほどほどに。', advice: '質の高い睡眠をとるために、寝る前のスマホ操作は控えましょう。', luckyItem: '目覚まし時計', luckyColor: 'ベージュ', color: categoryColors['末吉'] },
        { category: '末吉', message: '周りの人の進捗が気になって、焦りを感じてしまうかも。', advice: '他人と比較するのではなく、過去の自分と比べて成長を実感することが大切です。', luckyItem: '自分の目標を書いた紙', luckyColor: 'カーキ', color: categoryColors['末吉'] },
        // 凶
        { category: '凶', message: '勉強への意欲が湧きにくいかも…。無理せず、軽い復習程度に留めるのが吉。🧠', advice: '好きな科目を勉強したり、学習漫画を読んだりして、モチベーションを維持しましょう。', luckyItem: '好きなキャラクターの文房具', luckyColor: '灰色', color: categoryColors['凶'] },
        { category: '凶', message: 'いくら時間をかけても、なかなか内容が頭に入ってこないかも。今日は思い切って休むのも手。', advice: '疲れている時は、学習効率が悪くなります。リフレッシュを優先しましょう。', luckyItem: 'リラックスできる音楽', luckyColor: 'ダークグリーン', color: categoryColors['凶'] },
        { category: '凶', message: '先生や友人との間で、勉強に関する意見の食い違いがあるかも。', advice: '感情的にならず、相手の意見も尊重しつつ、冷静に話し合いましょう。', luckyItem: '客観的なデータ', luckyColor: 'マルーン', color: categoryColors['凶'] },
        // 大凶
        { category: '大凶', message: '勉強した内容が頭に入ってこないかも…。今日はしっかり休んで、明日に備えましょう。😴', advice: '睡眠不足は学習効率を大きく下げます。早めに寝ることを心がけて。', luckyItem: 'アイマスク', luckyColor: '黒', color: categoryColors['大凶'] },
        { category: '大凶', message: '試験で予想外の失敗をしてしまうかも。準備不足や体調不良が原因に。', advice: '結果に落ち込みすぎず、原因を分析して次に活かすことが大切です。', luckyItem: '反省ノート', luckyColor: 'ダークブラウン', color: categoryColors['大凶'] },
    ],
    // --- 金運 ---
    money: [
        // 大吉
        { category: '大吉', message: '臨時収入や思わぬ幸運が舞い込むかも！？宝くじを買ってみるのも良いかもしれません！💰', advice: '得た幸運は独り占めせず、周りの人にも少しお裾分けすると、さらに運気がアップします。', luckyItem: '金色の財布', luckyColor: 'ゴールド', color: categoryColors['大吉'] },
        { category: '大吉', message: '投資や副業が大きく成功する兆し！チャンスを見逃さず、積極的に行動しましょう！', advice: 'リスク管理も忘れずに。情報収集を怠らず、慎重な判断も必要です。', luckyItem: 'ビジネス書', luckyColor: 'プラチナ', color: categoryColors['大吉'] },
        { category: '大吉', message: '価値ある掘り出し物に出会えるかも！フリマアプリやアンティークショップを覗いてみては？', advice: '直感を信じてみるのも良いですが、相場を調べてから判断するのも忘れずに。', luckyItem: '虫眼鏡', luckyColor: 'シャンパンゴールド', color: categoryColors['大吉'] },
        // 中吉
        { category: '中吉', message: '節約や貯金が順調に進みそう。家計簿をつけるなど、お金の管理を見直すと吉。📈', advice: '将来のための自己投資（スキルアップなど）にお金を使うのは良い選択です。', luckyItem: '貯金箱', luckyColor: '黄土色', color: categoryColors['中吉'] },
        { category: '中吉', message: '仕事での頑張りが評価され、昇給やボーナスにつながる可能性あり！', advice: '日頃の努力をアピールする機会があれば、積極的に活用しましょう。', luckyItem: '名刺入れ', luckyColor: 'シルバー', color: categoryColors['中吉'] },
        { category: '中吉', message: '計画的な買い物が吉。本当に必要なものかどうか、よく考えてから購入しましょう。', advice: 'ウィッシュリストを作成し、優先順位をつけるのがおすすめです。', luckyItem: '家計簿アプリ', luckyColor: 'ライトグリーン', color: categoryColors['中吉'] },
        { category: '中吉', message: '人脈を通じて、有益な金銭情報が得られるかも。交流を大切に。', advice: 'ただし、情報の真偽は自分でしっかり確かめることが重要です。', luckyItem: '手帳', luckyColor: 'クリームイエロー', color: categoryColors['中吉'] },
        // 吉
        { category: '吉', message: '欲しかったものがお得に手に入るチャンスがありそう。ネットショッピングなどをチェックしてみて。🛒', advice: '衝動買いには注意。本当に必要か、よく考えてから購入しましょう。', luckyItem: 'ポイントカード', luckyColor: 'シルバー', color: categoryColors['吉'] },
        { category: '吉', message: 'ポイントやクーポンをうまく活用して、賢く節約できそう。', advice: 'キャンペーン情報などをこまめにチェックすると思わぬ得があるかも。', luckyItem: 'スマートフォンのクーポンアプリ', luckyColor: 'オレンジ', color: categoryColors['吉'] },
        { category: '吉', message: '副業やスキルアップにつながる情報収集が吉。将来の収入増につながる種まきを。', advice: 'すぐには結果が出なくても、コツコツ続けることが大切です。', luckyItem: '専門書', luckyColor: 'ブルー', color: categoryColors['吉'] },
        { category: '吉', message: '日頃お世話になっている人に、ちょっとしたプレゼントをすると喜ばれ、良い運気が巡ってきそう。', advice: '金額よりも、気持ちを込めることが大切です。', luckyItem: 'ラッピング用品', luckyColor: 'ピンク', color: categoryColors['吉'] },
        { category: '吉', message: '断捨離をして不要なものを売ると、予想外のお小遣いになるかも。', advice: '部屋もスッキリして一石二鳥です。フリマアプリなどを活用してみては。', luckyItem: '梱包材', luckyColor: 'ホワイト', color: categoryColors['吉'] },
        // 小吉
        { category: '小吉', message: '予定外の出費があるかも。交際費やレジャー費は計画的に。💸', advice: '無駄遣いを減らす工夫をしてみましょう。自炊を増やすなど。', luckyItem: '電卓', luckyColor: '緑', color: categoryColors['小吉'] },
        { category: '小吉', message: '人付き合いでの出費がかさみそう。見栄を張らず、無理のない範囲で付き合いましょう。', advice: '断る勇気も時には必要です。', luckyItem: '割り勘計算アプリ', luckyColor: 'グレー', color: categoryColors['小吉'] },
        { category: '小吉', message: 'サブスクリプションサービスなど、固定費を見直す良い機会かも。', advice: '利用頻度の低いものがないか、一度チェックしてみましょう。', luckyItem: '契約書控え', luckyColor: 'ライトグレー', color: categoryColors['小吉'] },
        { category: '小吉', message: '「安物買いの銭失い」になりやすい時。価格だけでなく、品質もしっかり見て判断しましょう。', advice: '長く使える良いものを選ぶ視点も大切です。', luckyItem: '製品レビューサイト', luckyColor: 'ベージュ', color: categoryColors['小吉'] },
        // 末吉
        { category: '末吉', message: 'お金の貸し借りはトラブルの元。今日は特にお金のやり取りは慎重に。🙅‍♂️', advice: 'うまい儲け話には裏がある可能性も。冷静に判断しましょう。', luckyItem: '鍵', luckyColor: '茶色', color: categoryColors['末吉'] },
        { category: '末吉', message: 'ローンや大きな買い物、契約事は、今日いったん見送るのが無難かも。', advice: '焦って決めずに、情報を集めたり、信頼できる人に相談したりする時間を設けましょう。', luckyItem: '印鑑', luckyColor: 'ネイビー', color: categoryColors['末吉'] },
        { category: '末吉', message: 'ギャンブルや投機的な話には乗らない方が賢明。地道な努力が一番です。', advice: '一攫千金を狙うよりも、コツコツと資産を築くことを考えましょう。', luckyItem: '貯蓄計画表', luckyColor: 'ダークグリーン', color: categoryColors['末吉'] },
        { category: '末吉', message: '財布やカードの管理に注意。置き忘れや紛失がないように気を付けて。', advice: '使わないカードは持ち歩かないなど、リスクを減らす工夫を。', luckyItem: 'カードケース', luckyColor: 'ボルドー', color: categoryColors['末吉'] },
        // 凶
        { category: '凶', message: '紛失や盗難に注意が必要な日。貴重品の管理はしっかりと。🔒', advice: '人混みや慣れない場所では特に注意しましょう。', luckyItem: 'カバンの中の整理整頓', luckyColor: '紺色', color: categoryColors['凶'] },
        { category: '凶', message: '予想外の請求や支払いが発生するかも。請求書の内容はよく確認しましょう。', advice: '不明な点があれば、すぐに問い合わせることが大切です。', luckyItem: '請求書ファイル', luckyColor: 'パープル', color: categoryColors['凶'] },
        { category: '凶', message: '衝動買いをして後悔しそう。買い物に行く前に、本当に必要かリストアップを。', advice: '欲しいものがあっても、一日時間をおいて冷静に考えてみて。', luckyItem: '買い物メモ', luckyColor: 'チャコールグレー', color: categoryColors['凶'] },
        // 大凶
        { category: '大凶', message: '大きな損失や詐欺に巻き込まれる危険性が…！投資話や高額な買い物は絶対に避けて。📉', advice: '怪しいと感じたら、すぐに信頼できる人に相談しましょう。', luckyItem: 'お札（お守りとして）', luckyColor: '赤', color: categoryColors['大凶'] },
        { category: '大凶', message: '借金の保証人になったり、安易にお金を貸したりするのは絶対にNG！人間関係も壊れる元です。', advice: 'きっぱりと断る勇気を持ちましょう。自分の身を守ることが最優先です。', luckyItem: '消費者センターの連絡先', luckyColor: 'ブラック', color: categoryColors['大凶'] },
    ]
};

// 利用可能なプリセットの情報
const presetInfo: Record<FortunePreset, { name: string; emoji: string; description: string }> = {
    normal: { name: '通常', emoji: '⛩️', description: '今日の総合的な運勢を占います。' },
    love: { name: '恋占い', emoji: '💖', description: '今日の恋愛運を占います。' },
    study: { name: '学業運', emoji: '📚', description: '今日の学業や勉強に関する運勢を占います。' },
    money: { name: '金運', emoji: '💰', description: '今日のお金に関する運勢を占います。' },
};

const omikujiCommand: Command = {
    name: 'おみくじ',
    description: '今日の運勢を占います。種類を指定したり、種類一覧を表示できます。',
    admin: false,
    usage: 'おみくじ [種類 | list | 一覧]',
    execute: async (_client, message, args) => {
        if (!message.guild) {
            await message.reply('❌ このコマンドはサーバー内でのみ使用できます。');
            return;
        }

        const subCommand = args[0]?.toLowerCase(); 

        // --- 種類一覧表示 ---
        if (subCommand === 'list' || subCommand === '一覧') {
            const listEmbed = new EmbedBuilder()
                .setColor(0x0099FF) 
                .setTitle('🔮 選べるおみくじの種類 🔮')
                .setDescription('`!おみくじ [種類名]` で占いたい運勢を選べます。\n種類名を省略すると「通常」のおみくじになります。')
                .setTimestamp();

            const fields = Object.entries(presetInfo).map(([key, info]) => ({
                name: `${info.emoji} ${info.name} (\`${key}\`)`,
                value: info.description,
                inline: false
            }));
            listEmbed.addFields(fields);

            await message.reply({ embeds: [listEmbed] });
            return;
        }

        const requestedPreset = (subCommand || 'normal') as FortunePreset;

        if (!fortunes[requestedPreset]) {
            const availablePresets = Object.keys(presetInfo).map(key => `\`${key}\``).join(', ');
            const usageEmbed = new EmbedBuilder()
                .setColor(0xFF0000) 
                .setTitle('❌ おみくじの種類が無効です')
                .setDescription(`使い方: \`!おみくじ [種類]\` または \`!おみくじ list\`\n\n**利用可能な種類:** ${availablePresets}`)
                .addFields({ name: '例', value: '`!おみくじ` (通常)\n`!おみくじ love` (恋占い)\n`!おみくじ list` (種類一覧)' });

            await message.reply({ embeds: [usageEmbed] });
            return; 
        }

        try {
            const currentFortunes = fortunes[requestedPreset];
            const randomIndex = Math.floor(Math.random() * currentFortunes.length);
            const chosenFortune = currentFortunes[randomIndex];
            const presetDetails = presetInfo[requestedPreset];

            const embed = new EmbedBuilder()
                .setColor(chosenFortune.color)
                .setTitle(`${presetDetails.emoji} ${message.author.displayName} さんの今日の運勢 (${presetDetails.name}) ${presetDetails.emoji}`)
                .setThumbnail(message.author.displayAvatarURL({ forceStatic: false }))
                .addFields(
                    { name: `運勢: ${chosenFortune.category}`, value: `**${chosenFortune.message}**` }
                )
                .setTimestamp() // 実行時刻
                .setFooter({ text: 'あくまで占いです！素敵な一日になりますように！' });

            if (chosenFortune.advice) {
                embed.addFields({ name: '💡 アドバイス', value: chosenFortune.advice });
            }
            if (chosenFortune.luckyItem) {
                embed.addFields({ name: '🍀 ラッキーアイテム', value: chosenFortune.luckyItem, inline: true });
            }
            if (chosenFortune.luckyColor) {
                embed.addFields({ name: '🎨 ラッキーカラー', value: chosenFortune.luckyColor, inline: true });
            }
            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error(`❌ おみくじ (${requestedPreset}) コマンドでエラーが発生しました:`, error);
            await message.reply(`❌ 占いの途中で問題が発生しました。もう一度試してみてください。`);
        }
    }
};

registerCommand(omikujiCommand);