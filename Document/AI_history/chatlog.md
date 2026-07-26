# chatlog

## 2026-07-26
- 状況: 高千穂峡ボート予約競争向けツール作成。8/9 の 8:30/9:00/9:30 のいずれか1枠。
- 判断: Playwright 並列タブ＋完了までリトライ。カード入力まで自動、3DSは手動。ゲスト経路。
- 理由: サイトが混雑し読み込み待ちが多い。枠は先着のため複数時間を同時に狙い、最初の成功で足りる。3DSは完全無人化不可。
- 作業: カレンダー〜注文フォームのDOM調査、`src/reserve.js` / `config.local.json` 実装。

## 2026-07-26（再設計）
- 状況: 予約入力は手動でよい。空きが出たことだけ知りたい。
- 判断: 自動予約を廃止し、15分間隔の空き監視＋Slack Webhook通知のみに変更。
- 理由: 入力は自分でやる。必要なのは 8/9 の空き検知と即通知だけ。
- 作業: `src/watch.js` 新規、config/README簡素化。実測で 8/9 は全18枠完売。Webhook接続確認OK。

## 2026-07-26（クラウド移行）
- 状況: PCをつけっぱなしにしたくない。GAS移行も検討。GitHubは初めて・無料アカウントあり。
- 判断: GAS直移行は見送り。GitHub Actions（15分cron）を採用。Public推奨＋SecretでWebhook管理。
- 理由: カレンダーはJS描画のためGASのUrlFetchだけでは不可。Actionsなら現行Playwrightをそのまま動かせ、常時起動不要。
- 作業: `.github/workflows/watch.yml`、`SETUP_GITHUB.md`、watch.jsの環境変数対応。
