# mtg-context-prepper
前MTG内容を要約&amp;次の予定の通知

### secretsディレクトリ内にGCP_SERVICE_ACCOUNT_KEYのJSONファイル用意
gcp-sa.jsonファイルを作成し、その中にGCPのサービスアカウントキーの情報を貼り付ける

## 実行対象ユーザ
- `TARGET_ACCOUNT` が設定されている場合
  - サービスアカウントに共有済みのGoogleアカウントのうち、指定アカウントのみ処理
- `TARGET_ACCOUNT` が未設定の場合
  - 共有済みアカウント全体を処理

## GitHub Actionsに設定する
- `Secrets.GCP_SERVICE_ACCOUNT_KEY`
  - サービスアカウントの鍵ファイル(json)を設定
- `Secrets.TARGET_ACCOUNT`
  - 実行したい共有済アカウントのメールアドレスを設定(任意)

## OpenClaw実行前に、ローカルのmtg-context-prepper配下に以下を設定
  - .env
  - secrets/gcp-sa.json

## ローカルテスト時に設定
- index.tsのコード修正(ローカルファイルのみ修正、git上のファイルに反映させないこと！)
  - ⚠️ローカル実行用 のメモを確認し、コメントアウトを解除・追加

