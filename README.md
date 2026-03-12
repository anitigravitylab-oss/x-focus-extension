# Xフォーカスフィルター

`x.com` / `twitter.com` のタイムライン上で、キーワード条件に合わない投稿を非表示にする Chrome 拡張の試作版です。

## できること

- `x.com` / `twitter.com` 上で直接動作
- タイムラインに追加で読み込まれた投稿も監視
- 広告投稿を非表示
- 2つのモードを切り替え可能
  - `include`: 指定キーワードに一致する投稿だけ残す
  - `exclude`: 指定キーワードに一致する投稿を隠す

## ローカルで読み込む

1. `chrome://extensions` を開く
2. `Developer mode` を有効にする
3. `Load unpacked` を押す
4. `/root/workspace/x-focus-extension` を選ぶ

## 注意点

- DOM ベースの試作なので、X 側の HTML 構造が変わると壊れます。
- `include` モードは「興味ある投稿だけ残す」に近いですが、判定はまだ単純なキーワード一致です。
- X 側の投稿マークアップが変わった場合は、[content.js](/root/workspace/x-focus-extension/content.js) のセレクタ修正が必要です。
