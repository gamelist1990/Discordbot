# SSO (Single Sign-On) 移行案 / 実装 TODO

目的
- 現在の Discord OAuth2 + サーバ側セッション（sessionId cookie）方式を、全サービス（web dashboard, jamboard, private chat, settings 等）で共通利用できる SSO に統一する。
- 最小の変更で動作する "短期 JWT" 案と、より堅牢な中央 SSO サービス案（長期）を提示する。

前提
- ユーザ認証は Discord OAuth2 を IdP（Identity Provider）として利用する。
- 既存の `config.json` と OAuth2 コールバックは維持しつつ、セッションの運用方式を変更する。


1) 選択肢の概要

A. 短期案: JWT 発行（簡易 SSO）
- フロー概要:
  1. ユーザが Discord OAuth2 を使ってログイン（既存 `/api/auth/discord` → `/api/auth/callback`）。
  2. サーバ (`/api/auth/callback`) が Discord からアクセストークンとユーザ情報を取得。
  3. サーバは自前の秘密鍵（`JWT_SECRET`）で短期間有効な JWT を生成（payload: userId, guildId, exp, scopes など）。
  4. JWT を HttpOnly セキュア cookie (`sso_token`) にセットする（または、SPAs 向けにセキュアに localStorage に入れるが推奨しない）。
  5. 各サービス（jamboard 等）は incoming request の cookie から JWT を検証して認証情報を得る。
- 利点:
  - 実装が比較的簡単（既存 callback に JWT 発行を追加するだけ）。
  - セッションストア不要（stateless）。
  - 複数サーバー（水平スケール）に対応しやすい。
- 欠点/注意点:
  - JWT の失効（即時ログアウト）は難しい（ブラックリストや短い有効期間で緩和）。
  - リフレッシュトークン戦略が必要（長期ログインサポート）。

B. 中長期案: Central SSO Service + Stateful セッション（Redis 等）
- フロー概要:
  1. 専用の SSO サービスを用意（`sso.example.com`）。
  2. ユーザは SSO の `/login` にリダイレクトされ、そこで Discord OAuth2 を完了。
  3. SSO は自身のセッションストア（Redis）で sessionId を管理し、cookie を発行する。
  4. 他のサービスは SSO の `/validate` エンドポイントを呼ぶか、SSO が発行した JWT を受けて検証する。
- 利点:
  - セッションの即時失効や集中管理が可能。
  - 複数ドメイン/サブドメインでの SSO 実装が容易（cookie domain 設定やトークン共有）。
  - より柔軟な認可（scopes/roles）管理が可能。
- 欠点/注意点:
  - 新サービスの導入コスト（設計・運用・インフラ）。
  - SSO が単一障害点になりうるため冗長化が必要。


2) 推奨順序
- まず短期案 A（JWT ベース）を導入して素早く "全サービス共通ログイン" を実現。
- その間に中長期案 B の設計と PoC を進め、必要なら段階的に移行（JWT→Central SSO）する。


3) JWT ベース実装の詳細（実装 TODO）
- 環境:
  - `JWT_SECRET`（環境変数または安全に保管）
  - `JWT_EXP`（例: 15m）
  - `JWT_REFRESH_EXP`（例: 14d、refresh token が必要なら別途実装）

- エンドポイント:
  - `/api/auth/callback` — Discord コールバック。JWT を発行して HttpOnly cookie にセットし、元ページへリダイレクト。
  - `/api/auth/refresh` — (オプション) refresh token を受けて新しい JWT を発行。
  - ミドルウェア: `verifyJwt` — cookie から JWT を検証し、`req.user` をセット。

- ファイル/変更箇所:
  - `src/web/routes/auth.ts` — コールバックで `res.cookie('sso_token', jwt, { httpOnly: true, secure: ..., sameSite: ... })` を出す。
  - `src/web/middleware/auth.ts` — sessionId 参照の代わりに `sso_token` を検証（既存ロジックと併存可）。
  - `src/web/routes/*` — sessionId ベースのルートを JWT ベースに切り替える（段階的に）。

- セキュリティ考慮:
  - short lived JWT（例 15分） + refresh token を HttpOnly cookie に入れるパターンを推奨。
  - HTTPS 必須（secure cookie）
  - SameSite ポリシーは `lax` またはフロー次第で `none`（クロスサイトの場合）。


4) Central SSO 実装の概要（要件）
- サービス:
  - `POST /sso/login` → 認証開始（あるいは GET で Discord OAuth 認証 URL を返す）
  - `GET /sso/callback` → Discord コールバック。SSO でセッションを作成して cookie をセット。
  - `GET /sso/validate` → 他サービスが SSO にトークンを投げて検証。もしくは JWT を返す。
  - `POST /sso/logout` → セッション無効化
- ストレージ: Redis（セッションストア・ブラックリスト用）
- 可用性: SSO を冗長化（ロードバランサ + Redis クラスタ）


5) 移行ステップ（段階的）
- フェーズ 0: 準備
  - `JWT_SECRET` を用意
  - 環境で HTTPS を使える場合は設定を確認
- フェーズ 1: JWT を既存 callback に追加
  - `/api/auth/callback` 実装を修正して JWT を返す/セットする
  - `verifyJwt` ミドルウェアを実装
  - 小さなサービス（jamboard）で JWT 認証を試す
- フェーズ 2: 全ルートを JWT へ置換（段階的）
  - sessionId ベースは暫定的に残すが、新クライアントは JWT を利用
- フェーズ 3: Central SSO（任意）
  - SSO サービスを動かし、JWT または cookie ベースの認証を統一


6) テスト & 受け入れ基準
- ユーザが Discord ログインを完了すると `sso_token` cookie がブラウザに保存される
- `GET /api/auth/session`（or `/api/auth/validate`）が 200 を返してユーザ情報を返す
- Jamboard, PrivateChat, Settings の各画面でログイン済み状態が正しく表示される
- ログアウト時に cookie が削除され、protected API が 401 を返す


7) リスクと緩和策
- JWT の無効化（ログアウト直後に失効させたい） → 短寿命 + リフレッシュ + Redis blacklist
- Cookie の SameSite/secure 設定ミス → dev/prod 用に設定を分けて実装
- セキュリティ: `JWT_SECRET` の秘匿管理、HTTPS 強制


8) 次のアクション（私がやれます）
- 1) まず短期案 A を実装するパッチを作り、`/api/auth/callback` で JWT を発行して cookie にセット（15〜30分の有効期限）。
- 2) `verifyJwt` ミドルウェアを実装して jamboard 等のルートで使うようにする。
- 3) 本番用に `SameSite`/`secure` を環境依存で切り替える設定を入れる。

作業を開始して良ければ `1` を返してください（私がパッチを作成・テストまで進めます）。
