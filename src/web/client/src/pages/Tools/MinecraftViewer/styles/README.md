# MinecraftViewer CSS Architecture

## 概要 (Overview)

このディレクトリには、MinecraftViewer コンポーネントの CSS スタイルが含まれています。モジュール化されたアーキテクチャにより、保守性と拡張性が向上しています。

This directory contains the CSS styles for the MinecraftViewer component. The modular architecture improves maintainability and extensibility.

## ファイル構成 (File Structure)

```
styles/
├── index.css         # メインエントリポイント (Main entry point)
├── base.css          # 基礎スタイル (Foundation styles)
├── layout.css        # レイアウト・グリッド (Layout & grid)
├── viewer.css        # 3Dビューア固有 (3D viewer specific)
├── controls.css      # UIコントロール (UI controls)
├── thumbnails.css    # サムネイル・フレーム (Thumbnails & frames)
└── utilities.css     # ユーティリティクラス (Utility classes)
```

## 各ファイルの役割 (Role of Each File)

### 1. base.css
**基礎スタイル - Foundation Styles**

- **CSS カスタムプロパティ (CSS Custom Properties/Tokens)**
  - カラーパレット (Color palette)
  - タイポグラフィ (Typography)
  - スペーシング (Spacing scale)
  - シャドウ (Shadows)
  - ボーダー半径 (Border radius)
  - トランジション (Transitions)

- **リセット・正規化 (Reset/Normalize)**
  - Box-sizing
  - マージン・パディングのリセット (Margin/padding reset)

- **基本タイポグラフィ (Basic Typography)**
  - 見出しスタイル (Heading styles)
  - 段落スタイル (Paragraph styles)

- **アクセシビリティ (Accessibility)**
  - フォーカス状態 (Focus states)
  - 選択スタイル (Selection styles)

- **ダークモード対応 (Dark Mode Support)**
  - `prefers-color-scheme: dark` メディアクエリ

### 2. layout.css
**レイアウト構造 - Layout Structure**

- **メインコンテナ (Main Container)**
  - `.minecraft-viewer` - ルートコンテナ

- **ヘッダー (Header)**
  - `.viewer-header` - タイトルと説明

- **グリッドシステム (Grid System)**
  - `.viewer-container` - 2カラムグリッド (キャンバス + サイドバー)
  - `.canvas-area` - 3D表示エリア
  - `.control-section` - コントロールパネル

- **レスポンシブブレークポイント (Responsive Breakpoints)**
  - デスクトップ: 1200px以上 (2カラム)
  - タブレット: 768px〜1200px (1カラム)
  - モバイル: 768px以下 (1カラム、調整あり)
  - 小型モバイル: 480px以下 (最適化)

### 3. viewer.css
**3Dビューア固有スタイル - 3D Viewer Specific**

- **キャンバスエリア (Canvas Area)**
  - アスペクト比維持 (Aspect ratio maintenance)
  - ローディング状態 (Loading states)

- **ファイル入力 (File Input)**
  - `.file-input-group` - ファイル選択UI
  - カスタムファイルセレクタボタン

- **背景設定 (Background Settings)**
  - `.background-section` - 背景コントロール

- **ステータス表示 (Status Display)**
  - `.hint-text` - ヒントメッセージ
  - `.status-text` - ステータスメッセージ
  - `.error-message` - エラーメッセージ

- **ダイアログ (Dialogs)**
  - `.dialog-overlay` - モーダルオーバーレイ
  - `.dialog-box` - ダイアログコンテンツ

### 4. controls.css
**UIコントロール - UI Controls**

- **タブナビゲーション (Tab Navigation)**
  - `.tabs` - タブコンテナ
  - `.tab` - 個別タブ
  - `.tab.active` - アクティブタブ
  - モバイル: 画面下部に固定 (Fixed bottom on mobile)

- **ボタン (Buttons)**
  - `.btn` - 基本ボタン
  - `.btn-primary` - プライマリアクション
  - `.btn-secondary` - セカンダリアクション
  - `.btn-danger` - 危険な操作
  - `.btn-small` / `.btn-large` - サイズバリエーション

- **スライダー (Sliders)**
  - `.slider-group` - スライダーコンテナ
  - カスタムトラック・サムスタイル

- **ラジオボタン・チェックボックス (Radio/Checkbox)**
  - `.radio-group` - ラジオボタングループ
  - `.part-toggle-label` - パーツ表示切替

- **セレクト・入力 (Select/Input)**
  - `select` - ドロップダウン
  - `input[type="text"]` - テキスト入力

### 5. thumbnails.css
**サムネイル・フレーム - Thumbnails & Frames**

- **フレームリスト (Frame List)**
  - `.frame-list` - フレームリストコンテナ
  - `.frame-list.clamped` - スクロール可能な制限付きリスト

- **フレームアイテム (Frame Items)**
  - `.frame-list-item` - 個別フレーム
  - `.frame-thumb` - サムネイル画像
  - `.frame-meta` - メタデータ (タイトル、日付)
  - `.frame-actions` - アクション (移動、削除)

- **フルスクリーンモーダル (Fullscreen Modal)**
  - `.frame-modal` - モーダルオーバーレイ
  - `.frame-modal-content` - モーダルコンテンツ
  - `.frame-modal-grid` - グリッドレイアウト

- **プリセット (Presets)**
  - `.preset-item` - プリセットアイテム
  - `.preset-header` - プリセットヘッダー
  - `.preset-hint` - ヒントボックス

### 6. utilities.css
**ユーティリティクラス - Utility Classes**

汎用的なヘルパークラス集:

- **スペーシング (Spacing)**: `.m-*`, `.mt-*`, `.mb-*`, `.p-*`, etc.
- **ディスプレイ (Display)**: `.flex`, `.grid`, `.block`, `.hidden`
- **Flexbox**: `.flex-row`, `.flex-col`, `.items-center`, `.justify-between`
- **テキスト (Text)**: `.text-center`, `.text-sm`, `.text-primary`, `.truncate`
- **幅・高さ (Width/Height)**: `.w-full`, `.h-full`
- **ボーダー (Border)**: `.border`, `.rounded`, `.rounded-lg`
- **シャドウ (Shadow)**: `.shadow-sm`, `.shadow-md`, `.shadow-lg`
- **アクセシビリティ (Accessibility)**: `.sr-only` (screen reader only)
- **アニメーション (Animation)**: `.animate-spin`, `.animate-pulse`

## 使用方法 (Usage)

### TypeScript/React での読み込み

```typescript
import './styles/index.css';
```

`index.css` がすべてのモジュールを正しい順序でインポートします。

### カスタマイズ

カラー、スペーシング、タイポグラフィなどをカスタマイズするには、`base.css` の CSS カスタムプロパティを変更してください:

```css
:root {
  --color-primary: #1a73e8;
  --space-4: 16px;
  --font-size-base: 14px;
}
```

### ダークモード

ダークモードは自動的に `prefers-color-scheme: dark` メディアクエリで対応されます。独自のダークモード切替を実装する場合は、`base.css` のカラートークンを参考にしてください。

## レスポンシブデザイン (Responsive Design)

### ブレークポイント (Breakpoints)

- **デスクトップ (Desktop)**: 1200px 以上
  - 2カラムレイアウト (3Dビュー + サイドバー)
  
- **タブレット (Tablet)**: 768px〜1200px
  - 1カラムレイアウト (縦並び)
  
- **モバイル (Mobile)**: 768px 以下
  - タブを画面下部に固定
  - キャンバス高さ調整
  - タッチ最適化
  
- **小型モバイル (Small Mobile)**: 480px 以下
  - さらなる最適化
  - フォントサイズ縮小

### モバイル最適化

- **タッチターゲット**: 最小 44x44px (Appleガイドライン)
- **タブ固定ナビ**: 画面下部に常時表示
- **スクロール**: `overflow-scrolling: touch` で慣性スクロール
- **タッチアクション**: `touch-action: none` で3Dコントロール干渉を防止

## アクセシビリティ (Accessibility)

### フォーカス表示

すべてのインタラクティブ要素に明確なフォーカス状態:

```css
*:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
```

### カラーコントラスト

WCAG 2.1 AA 基準に準拠:
- テキスト: 4.5:1 以上
- 大きなテキスト: 3:1 以上

### スクリーンリーダー対応

`.sr-only` クラスで視覚的に隠しつつアクセシブル:

```css
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  ...
}
```

## パフォーマンス (Performance)

### CSS の最適化

- **モジュール分割**: 必要な部分だけ読み込み可能
- **カスタムプロパティ**: 動的な値変更が効率的
- **トランジション**: GPU アクセラレーション対応

### ファイルサイズ

- `base.css`: ~4KB
- `layout.css`: ~4KB
- `viewer.css`: ~4KB
- `controls.css`: ~9KB
- `thumbnails.css`: ~7KB
- `utilities.css`: ~9KB
- **合計**: ~37KB (minify前)

## 将来の拡張 (Future Enhancements)

### CSS モジュール化

`.module.css` への移行を検討:

```typescript
import styles from './styles/controls.module.css';
<button className={styles.btn}>...</button>
```

### テーマ切替

JavaScript でクラスを動的に追加してテーマ切替:

```typescript
document.documentElement.classList.add('theme-dark');
```

```css
.theme-dark {
  --color-bg: #0f172a;
  --color-surface: #1e293b;
  ...
}
```

### CSS-in-JS への移行

必要に応じて styled-components や emotion への移行も可能。

## トラブルシューティング (Troubleshooting)

### スタイルが適用されない

1. `index.css` が正しくインポートされているか確認
2. ブラウザのキャッシュをクリア
3. ビルドプロセスを再実行: `npm run web`

### レスポンシブが機能しない

1. ビューポートメタタグを確認:
   ```html
   <meta name="viewport" content="width=device-width, initial-scale=1.0">
   ```
2. メディアクエリの順序を確認 (mobile-first)

### ダークモードが動作しない

1. OS/ブラウザのダークモード設定を確認
2. `prefers-color-scheme` メディアクエリのサポートを確認

## 貢献 (Contributing)

スタイルの変更・追加時は以下のガイドラインに従ってください:

1. **BEM命名規則** または **ユーティリティファースト** を使用
2. **CSS カスタムプロパティ** を活用して値を再利用
3. **レスポンシブ** を常に考慮
4. **アクセシビリティ** を損なわない
5. **パフォーマンス** を意識する (不要なセレクタを避ける)

## ライセンス (License)

このプロジェクトのライセンスに従います。

---

**最終更新**: 2025-10-29  
**バージョン**: 1.0.0
