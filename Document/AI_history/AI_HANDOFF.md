# AI Handoff

## 現在の状態
空き枠監視は GitHub Actions 運用向けに準備済み。ローカル常駐は不要にする方針。
PC に Git 未導入のため、ユーザーは SETUP_GITHUB.md の手順でリポジトリ作成→push→Secret 登録が必要。

## 直近の決定
- PC常時起動なしが目的 → GitHub Actions（15分 cron）を採用（GASはAPI特定が必要で後回し）
- Webhook は GitHub Actions Secret `SLACK_WEBHOOK_URL`
- リポジトリは Public 推奨（無料 Actions 枠のため。秘密は Secret のみ）

## 次にやること
1. Git インストール（済ならスキップ）
2. GitHub でリポジトリ作成
3. push → Secret 登録 → Actions で手動 Run 確認
