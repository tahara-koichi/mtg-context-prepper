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
- `Secrets.TARGET_ACCOUNT`
