# GitHub Actions セットアップ（初めて向け）

ゴール: **PCを消しても**、15分ごとに空きを見て Slack 通知する。

所要時間の目安: 10〜15分

---

## 事前に用意するもの

- GitHub 無料アカウント（ログインできること）
- Slack Webhook URL（すでに取得済みのもの）

---

## 手順1: リポジトリを作る（箱を作る）

1. ブラウザで https://github.com/new を開く
2. 次のように入力する
   - **Repository name**: `takachiho-slot-watch`（好きな名前でOK）
   - **Public** を選ぶ（無料枠で Actions を使いやすい。Webhook は秘密情報として別保存するのでコードには出ません）
   - 「Add a README」などのチェックは **全部外す**
3. **Create repository** を押す

作成後に出る画面は、いったんそのままでOKです。

---

## 手順2: このフォルダを GitHub に載せる

PCに Git が入っていない場合は、先に入れます。

### 2-A. Git を入れる（未導入のとき）

1. https://git-scm.com/download/win を開く
2. ダウンロードしてインストール（途中はだいたい Next でOK）
3. **Cursor / ターミナルを一度閉じて開き直す**

### 2-B. アップロード用コマンド

Cursor のターミナルで、次を **1行ずつ** 実行します。  
（`YOUR_GITHUB_USERNAME` は自分の GitHub ユーザー名に置き換え）

```powershell
cd "C:\Users\Masahiro\Desktop\自動予約ツール"
git init
git add .
git commit -m "Add slot watch for GitHub Actions"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/takachiho-slot-watch.git
git push -u origin main
```

`git push` のときログインを求められたら、ブラウザ認証の案内に従ってください。

---

## 手順3: Slack Webhook を GitHub に登録（秘密の金庫）

1. リポジトリページを開く
2. **Settings** → 左メニュー **Secrets and variables** → **Actions**
3. **New repository secret** を押す
4. 次を入力
   - **Name**: `SLACK_WEBHOOK_URL`（この名前以外だと動きません）
   - **Secret**: Slack の Webhook URL を貼り付け
5. **Add secret**

---

## 手順4: 動作確認（手動で1回動かす）

1. リポジトリの **Actions** タブを開く
2. 左の **Slot Watch** を選ぶ
3. **Run workflow** → **Run workflow** を押す
4. 黄色→緑になれば成功
5. Slack に通知が来るのは「空きが出たとき」だけです（今は完売なら来なくて正常）

ログの見方: 実行行をクリック → **check** → **Check availability**  
`空きなし` や `枠=18 空き=0` のような文字があればOKです。

---

## 手順5: あとは放置

- 15分ごとに自動実行されます
- PCの電源は切って大丈夫です
- 空きが出て内容が変わったときだけ Slack 通知します

止めるとき: **Actions** → **Slot Watch** → 右上 **...** → **Disable workflow**

---

## うまくいかないとき

| 症状 | 確認すること |
|------|----------------|
| Actions が灰色 / 動かない | 手順4で手動 Run してみる。Public か確認 |
| `SLACK_WEBHOOK_URL` エラー | Secret の名前が完全一致か |
| ブラウザインストール失敗 | もう一度 Run workflow |
| push できない | GitHub ログイン・リポジトリ名の打ち間違い |

詰まったら、Actions の赤い実行の画面をスクショして共有してください。
