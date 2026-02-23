# Google カレンダー連携 予約システム

Google Workspace完結のスロット予約システム。
Apps Script (Web App) + Google Sheets + Google Calendar で動作します。

---

## ファイル構成

```
Code.gs                          # サーバーサイドロジック
index.html                       # 予約フォームUI
appsscript.json                  # Apps Script マニフェスト
.clasp.json                      # clasp プロジェクト設定
.github/workflows/deploy.yml     # GitHub Actions 自動デプロイ
```

---

## セットアップ手順

### 1. Google スプレッドシートを作成する

新しいスプレッドシートを作成し、2枚のシートを用意します。

#### シート1: `設定`

A列（キー）とB列（値）で設定を記入します。

| A（キー）    | B（値）の例                          | 説明                          |
|------------|-------------------------------------|-------------------------------|
| 開始時間     | 10:00                               | 予約受付の開始時刻              |
| 終了時間     | 17:00                               | 予約受付の終了時刻              |
| 枠時間(分)   | 60                                  | 1枠の長さ（分）                |
| 予約可能日数  | 30                                  | 何日先まで予約を受け付けるか     |
| 予約可能曜日  | 1,2,3,4,5                           | 0=日,1=月,...,6=土 カンマ区切り |
| カレンダーID | xxxxx@group.calendar.google.com     | Google CalendarのカレンダーID  |

> **カレンダーIDの確認方法:** Google Calendar → 対象カレンダーの「設定と共有」→「カレンダーの統合」に記載

#### シート2: `予約`

1行目にヘッダーを入力します（データは自動追記されます）。

| 予約ID | 日付 | 時間 | 名前 | メール | 予約日時 | ステータス |

---

### 2. clasp をインストールする（ローカルで一度だけ）

```bash
npm install -g @google/clasp
clasp login   # ブラウザでGoogleアカウント認証 → ~/.clasprc.json が生成される
```

---

### 3. GAS プロジェクトを用意する

#### パターンA: スプレッドシートにバインドされた既存プロジェクトを使う（推奨）

スプレッドシートのメニューから **拡張機能 → Apps Script** を開き、
エディタのURL `https://script.google.com/d/<SCRIPT_ID>/edit` から Script ID を取得します。

`.clasp.json` に記入します。

```json
{ "scriptId": "取得したScript ID", "rootDir": "." }
```

#### パターンB: clasp で新規スタンドアロンプロジェクトを作成する

```bash
clasp create --type webapp --title "予約システム"
# → .clasp.json が自動生成される
```

> **注意:** パターンBの場合、スプレッドシートとの紐付けは Apps Script エディタで手動設定が必要です。
> スプレッドシートを使うならパターンAを推奨します。

---

### 4. 初回デプロイ（Web App URL を確定させる）

```bash
clasp push                        # コードをGASにアップロード
clasp deploy --description "initial"   # Web App として公開

clasp deployments                 # Deployment ID を確認・控える
# → AKfycb... のような文字列
```

> 初回のみ、GAS エディタの **「デプロイ」→「デプロイを管理」** で
> 権限の確認（スプレッドシート・カレンダー・Gmail へのアクセス）を許可してください。

---

### 5. GitHub Secrets を登録する

GitHub リポジトリの **Settings → Secrets and variables → Actions** に以下を登録します。

| Secret 名 | 値の取得方法 |
|---|---|
| `CLASP_TOKEN` | `cat ~/.clasprc.json` の出力内容をそのまま貼り付ける |
| `CLASP_DEPLOYMENT_ID` | `clasp deployments` で確認した `AKfy...` の文字列 |

> `CLASP_TOKEN` は OAuth リフレッシュトークンを含みます。**git にはコミットしないでください**（`.gitignore` で除外済み）。

---

### 6. Google カレンダーの共有設定

Apps Script がカレンダーにイベントを追加するには、
スクリプトを実行するアカウント（デプロイしたアカウント）が
そのカレンダーの **編集権限** を持つ必要があります。

---

## 2回目以降の運用（自動デプロイ）

`main` ブランチに push するだけで GitHub Actions が自動的にデプロイします。
**Web App の URL は変わりません。**

```bash
# コードを編集して push するだけ
git add .
git commit -m "fix: ..."
git push origin main   # ← GitHub Actions が clasp push + deploy を実行
```

### ローカルから手動デプロイする場合

```bash
clasp push
clasp deploy --deploymentId AKfycb...   # 控えておいたDeployment IDを指定
```

---

## 動作フロー

```
ユーザー
  │
  ▼
① 日付を選択（予約可能日を自動表示）
  │
  ▼
② 時間枠を選択（予約済はグレーアウト）
  │
  ▼
③ 名前・メールアドレスを入力
  │
  ▼
④ 「予約を確定する」ボタン
  │
  ├── LockService で排他制御（二重予約防止）
  ├── Google Sheets に予約を記録
  ├── Google Calendar にイベントを追加
  └── 確認メールを送信
```

---

## 重複予約の防止

`LockService.getScriptLock()` を使用し、同時アクセス時の競合状態（race condition）を防止しています。
ロック内で最終確認を行い、すでに予約済みの場合はエラーを返します。

---

## 管理者操作

- **予約キャンセル:** 予約シートの「ステータス」列を `キャンセル` に変更する
- **設定変更:** 設定シートの値を変更後、再デプロイは不要（即時反映）
- **予約確認:** 予約シートで一覧管理、Google Calendar でも確認可能

---

## 必要な権限（初回実行時に許可が求められます）

- Google スプレッドシート（読み書き）
- Google カレンダー（書き込み）
- Gmail（メール送信）
