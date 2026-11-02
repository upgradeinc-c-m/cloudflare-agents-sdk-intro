# cloudflare-agents-sdk-intro

Cloudflare Agents SDK(`agents` 0.32)で AI エージェントを作る最小構成のサンプルです。
エージェントは「Lifecycle を取り付けた Durable Object」で、状態の保存と同期、スケジュール実行、WebSocket、LLM のループを 1 つのクラスにフィールドを並べて組みます。

- `counter-agent/` は LLM なし。`State` / `Scheduler` / `WebSockets` の動きを `wrangler dev` だけで確かめられます
- `my-agent/` は Pi ハーネス + Workers AI。ワークスペース(SQLite 上のファイルシステム)と自作ツール `word_count` を LLM が呼びます。API キーは不要です
- インフラは各ディレクトリの `wrangler.jsonc` が定義します(Worker、Durable Object、AI バインディング)。別途 Terraform などは使いません
- GitHub Actions(`.github/workflows/deploy.yml`)で型チェック・テスト・dry-run を行い、手動実行で `wrangler deploy` します

設計と検証の経緯は Zenn の記事「Cloudflare Agents SDKでAIエージェントを作ってみた(Durable Object入門)」にまとめています。

## 構成

| パス | 内容 |
| --- | --- |
| `counter-agent/src/index.ts` | `State` + `Scheduler` + `WebSockets` を `Lifecycle` につないだ Counter。HTTP と WebSocket の両方で操作できる |
| `counter-agent/test/index.spec.ts` | `@cloudflare/vitest-plugin` によるテスト(名前ごとのインスタンス、スケジュール登録、404) |
| `my-agent/src/index.ts` | `PiHarness` + Workers AI(`@cf/zai-org/glm-4.7-flash`)+ `@cloudflare/computer` のワークスペース + 自作ツール |
| `*/wrangler.jsonc` | Worker 本体、Durable Object(`exports` で SQLite 指定)、AI バインディングの定義 |
| `.github/workflows/deploy.yml` | check(typecheck / test / dry-run)と deploy(手動実行) |

## 動かし方

Node.js 22.19 以降と Cloudflare アカウント(`my-agent` のみ。Free プランで可)が必要です。

### counter-agent(ローカルだけで動く)

```sh
cd counter-agent
npm ci
npm run dev
```

```sh
curl -X POST http://localhost:8787/agents/counter/alice/inc          # {"count":1}
curl http://localhost:8787/agents/counter/bob                        # {"count":0}
curl -X POST "http://localhost:8787/agents/counter/alice/reset-later?in=5"
curl http://localhost:8787/agents/counter/alice/schedules
```

WebSocket は `ws://localhost:8787/agents/counter/alice` に接続し、`inc` を送ると state の更新が配られます。テストは `npm test`。

### my-agent(Workers AI)

Workers AI にはローカルのシミュレーションがなく、`wrangler dev` でも AI バインディングは Cloudflare 側へ中継されます。デプロイして確かめるのが確実です。

```sh
cd my-agent
npm ci
npx wrangler login
npx wrangler deploy
```

複数のアカウントに所属している場合は `CLOUDFLARE_ACCOUNT_ID` を環境変数で指定します。

```sh
URL=https://my-agent.<subdomain>.workers.dev/agents/assistant/demo
curl -X POST $URL -d "What is 47 times 19? Reply with the number only."
# {"status":"done","text":"893"}
curl -X POST $URL -d "Use the word_count tool to count the words in this sentence: the quick brown fox jumps over the lazy dog. Reply with the number only."
# {"status":"done","text":"9"}
curl $URL   # 会話の履歴(transcript)
```

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/upgradeinc-c-m/cloudflare-agents-sdk-intro/tree/main/my-agent)

### GitHub Actions でデプロイする

リポジトリシークレットに `CLOUDFLARE_API_TOKEN`(テンプレート「Edit Cloudflare Workers」)と `CLOUDFLARE_ACCOUNT_ID` を登録し、Actions の `deploy` ワークフローを手動実行します。`main` への push では check のみ走ります。

## 注意

- デプロイした URL は認証なしで誰でも呼べます。公開する前に `routeAgentRequest()` の `onBeforeRequest` / `onBeforeConnect` で呼び出し元を確認してください
- Pi 関連パッケージ(`@earendil-works/*`)は `agents` の 1 リリースにつき 1 マイナーのみ対応します。`~1.4.0` で固定しているのはそのためで、`^1.4.0` にすると 1.5.0 が入って peer 依存の衝突で `npm install` が失敗します(2026-11-02 時点)
- 公式クイックスタートのモデル `@cf/zai-org/glm-5.3-flash` は Workers Free プランでは使えません。このリポジトリは `@cf/zai-org/glm-4.7-flash` にしています
- Pi ハーネスは experimental で、ツール呼び出しの承認ステップはありません

## ライセンス

MIT
