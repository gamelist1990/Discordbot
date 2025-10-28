## コマドリ用state/構造設計案

### Frame型（1コマ分）
```ts
type Frame = {
	id: string; // uuid
	pose: any; // 各部位の回転・位置情報
	camera: any; // カメラ位置・ズーム等
	background: { type: string; preset?: string; customUrl?: string };
	thumb?: string; // サムネ画像(base64)
	createdAt: string;
};
```

### State例
```ts
const [frames, setFrames] = useState<Frame[]>([]);
const [activeFrameIndex, setActiveFrameIndex] = useState<number>(0);
```

### 必要な関数
- addFrame(): 現在のポーズ・カメラ・背景をFrameとして追加
- removeFrame(idx): 指定コマ削除
- moveFrame(from, to): コマ順序入替
- updateFrame(idx, data): コマ内容更新
- exportFrames(format): mp4/gifとしてエクスポート（UIのみ先行）
- generateThumb(frame): サムネ生成

---
 
 # MinecraftViewer UIリニューアル設計案
 
 ## 目的
 - Google Material Design風のクリーンなUI
 - Twitterのようなスマホでも直感的に扱えるUI
 - コマドリ（複数ポーズ保存→mp4/gif化）機能に備えた設計
 
 ## レイアウト概要
 - **ヘッダー**：タイトル＋説明
 - **2カラム（PC）/1カラム（モバイル）**：
	 - 左：3Dビュー
	 - 右：操作パネル（タブ切替）
 - **タブ切替**：
	 - Viewer（表示）
	 - Pose（ポーズ編集）
	 - コマドリ（新機能）
	 - Presets（従来のプリセット）
 - **コマドリタブ**：
	 - 「現在のポーズをコマとして追加」ボタン
	 - コマリスト（サムネイル＋削除＋順序入替）
	 - 「mp4/gifとして書き出し」ボタン
 
 ## モバイル対応
 - 1カラム化、タブは下部固定ナビ
 - ボタン・入力欄は大きめ、タッチしやすい余白
 
 ## デザイン指針
 - Material UIのようなカード・影・角丸
 - シンプルな配色、余白多め
 - アイコン活用（保存・削除・エクスポート等）
 
 ## コマドリ機能UI要件
 - コマ追加：現在のポーズ・カメラ・背景を「コマ」として保存
 - コマリスト：サムネイル表示、順序入替（ドラッグ or ボタン）、削除
 - コマ編集：各コマのポーズ再編集（将来的に）
 - エクスポート：コマ列をmp4/gifとして書き出し（UIのみ先行実装）
 - サムネ生成：各コマのプレビュー画像を自動生成
 
 ---
 
