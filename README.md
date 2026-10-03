# web-game-template

ブラウザで動くゲームの型。TypeScript + Vite + Canvas。ゲームエンジンは使わない。
見本として三目並べが入っている。新しいゲームは、この型をコピーして `src/game` と `src/ui` を書き換えて作る。

## 新しいゲームを始める

1. GitHub で、このリポジトリの「Use this template」から新しいリポジトリを作る（1つのゲームは1つのリポジトリ）。GitHub Pages で公開するなら Public にする（無料プランでは Private だと使えない）
2. そのリポジトリの Settings → Pages → Source を「GitHub Actions」にする。この時点で、見本の三目並べが `https://pupe-xxx.github.io/<名前>/` に公開される
3. 手元に取ってくる: `git clone https://github.com/pupe-xxx/<名前>.git C:\dev\<名前>`
4. `npm install` → `npm run dev`
5. `package.json` の `name`、`index.html` の `<title>`、`src/main.ts` のセーブの名前（`createSave` の1つ目）をゲームの名前に変える
6. `src/game`（ルール）と `src/ui`（画面）を書き換える。見本のテスト（`tests/rules.test.ts`）も自分のルールのテストに置き換える
7. `tests/golden/cases.ts` を自分のゲームの場面に書き換え、`npm run record` で動作記録を取る
8. この README を、そのゲームの説明に書き換える

### 1人用のゲーム（CPU と対戦しない）の時

見本の CPU と画面なしの対戦は要らないので消す。

- 消すファイル: `src/game/cpu.ts`・`src/game/sim.ts`・`scripts/sim.ts`
- `package.json` から `sim` のコマンドを消す（`tsx` は `npm run record` が使うので残す）
- `tests/golden/cases.ts` には、決まった入力に対する結果を並べる（例：決まった配合で混ぜた色、決まった操作をした後の盤面）

### 動き続けるゲーム（アクションなど）の時

見本の三目並べは、操作した時だけ画面を描き直す。時間で進むゲームは `kit/loop.ts` を使う。

- `src/game` に「1刻み進める」関数を書く（例：`step(state, input, rng)`）。経過時間は受け取らず、1回呼ぶと 1/60 秒進むものとして書く
- `src/main.ts` で `createLoop({ update, render })` を作り、`update` でその関数を呼び、`render` で描く
- 操作（タップ・キー）はその場でルールに渡さず、いったん溜めて、次の `update` で渡す
- `tests/golden/cases.ts` には「決まった種と、決まった刻みで入れた操作」の後の状態を並べる

### 既にあるゲームを移す時

移す前の版で動作記録を取ってから移すと、移した後に同じ動きをするかを機械的に確かめられる。

### ボタンや一覧を HTML で作る時

Canvas に描くのは盤面や塗る面だけでよい。ボタン・パレット・点数の表示は `index.html` に書き、見た目は `src/ui/style.css` に書いて `src/main.ts` の先頭で `import './ui/style.css'` する。

## コマンド

| コマンド | すること |
|---|---|
| `npm run dev` | 手元で動かす（保存すると画面がすぐ変わる） |
| `npm test` | ルールの自動テスト |
| `npm run sim -- 1000` | 画面なしで CPU 同士を 1000 試合対戦させ、勝敗の内訳を出す |
| `npm run record` | 動作記録（`tests/golden/golden.json`）を取り直す |
| `npm run typecheck` | 型の検査（ルール側が画面に触れていないかも見る） |
| `npm run build` | 検査してから `dist/` に公開用のファイルを作る |
| `npm run preview` | `dist/` の中身を手元で開く |

## フォルダ

```
src/
  main.ts    入口。下の3つをつなぐ
  kit/       どのゲームでも使う共通部分
    rng.ts       種を固定できる乱数
    scale.ts     画面サイズの調整（論理サイズで描けば、実際の大きさは合わせてくれる）
    audio.ts     音（ファイルが無くても仮の効果音が鳴る）
    save.ts      セーブ（保存できない環境でも止まらない）
    golden.ts    動作記録との照合（状態を短い文字列に縮めて比べる）
    loop.ts      毎フレーム進める仕組み（動き続けるゲーム用。ルールは決まった刻みで進む）
    platform/    ゲームサイトの広告 SDK の差し込み口
  game/      ルール。画面の処理に触れない
  ui/        描画と操作
tests/       ルールと共通部分のテスト
  golden/      動作記録（golden.json）と、記録する場面（cases.ts）
scripts/     画面なしの対戦、動作記録の取り直し
```

## 守ること

- **`src/game` は画面に触れない。** `document`・Canvas を使うと `npm run typecheck` がエラーになる。こうしておくと、ルールをテストでき、CPU 同士を画面なしで対戦させられる
- **ルール側で `Math.random` を使わない。** `kit/rng.ts` の乱数を引数で受け取る。同じ種なら同じ試合になるので、不具合を再現できる
- **ルール側で時計を見ない。** `Date.now`・`performance.now` を使わず、刻みの回数で時間を数える。実際の時間を持ち込むと、端末の速さで結果が変わり、テストで再現できなくなる
- **CPU はどちらの番でも指せるように書く。** 片方専用にすると CPU 同士の対戦ができない
- **ルールや CPU を意図して変えたら、動作記録を取り直す（`npm run record`）。** `npm test` は記録と今の動きを比べるので、変えると失敗する。意図しない変化を見つけるための仕組みなので、取り直す前に「変わってよい理由」を確かめる
- **描画は論理サイズの座標で書く。** 画面の実寸や `devicePixelRatio` を描画のコードに持ち込まない
- **広告・計測は `kit/platform` の形を通して呼ぶ。** ゲーム本体に SDK を直接書かない

## 公開

- **GitHub Pages**: `main` に push すると、テスト → ビルド → 公開まで自動で進む（`.github/workflows/pages.yml`）。テストかビルドが失敗したら公開されない。初回だけ、リポジトリの Settings → Pages → Source を「GitHub Actions」にする
- **ゲームサイト（Poki・CrazyGames など）**: 今は差し込み口だけで、SDK は入っていない。載せると決めたら、公式の資料を見て `src/kit/platform/` にそのサイト用のファイルを足す（手順は `platform/index.ts` の説明）。ビルドは相対パスで出力するので、`dist/` の中身を zip にすればそのまま渡せる

## 共通部分を直した時

共通部分（`src/kit`）はゲームごとにコピーされる。直した内容は、既存のゲームには自動では届かない。
どのゲームにも効く修正は、この型にも入れておく。既存のゲームには、必要になった時に `src/kit` を上書きして取り込む。
