# 高千穂峡貸しボート 空き枠監視

指定日に空きが出たら Slack へ通知します。予約入力は手動です。

## おすすめ運用: GitHub Actions（PC不要）

PCをつけっぱなしにせず、クラウドが15分ごとにチェックします。

→ 初めての人は **[SETUP_GITHUB.md](./SETUP_GITHUB.md)** を上から順に実行してください。

## ローカルで動かす場合

```bash
npm start          # 15分ごとに常駐
npm run check      # 1回だけ確認
```

`config.example.json` を `config.local.json` にコピーして Webhook を記入（gitignore 済み）。
