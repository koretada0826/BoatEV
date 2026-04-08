# BoatEV - ボートレース期待値予測ツール セットアップ手順

## ディレクトリ構成

```
ボートレース_1/
├── server/                     # バックエンド（Node.js + Express）
│   ├── src/
│   │   ├── api/routes.ts       # REST APIエンドポイント
│   │   ├── db/
│   │   │   ├── schema.sql      # Supabaseテーブル定義
│   │   │   └── supabase.ts     # Supabase接続
│   │   ├── prediction/
│   │   │   ├── calculator.ts   # 予測・EV計算ロジック
│   │   │   └── cli.ts          # 予測CLIツール
│   │   ├── scraper/
│   │   │   ├── cli.ts          # スクレイピングCLIツール
│   │   │   ├── http.ts         # HTTP取得（Shift_JISデコード対応）
│   │   │   ├── index.ts        # スクレイピング統合処理
│   │   │   ├── odds.ts         # 2連単オッズ取得
│   │   │   ├── races.ts        # レース情報・出走表取得
│   │   │   └── results.ts      # レース結果取得
│   │   └── index.ts            # Expressサーバー
│   ├── .env.example
│   ├── package.json
│   └── tsconfig.json
├── frontend/                   # フロントエンド（React + Ant Design）
│   ├── src/
│   │   ├── pages/
│   │   │   ├── RaceListPage.tsx    # レース一覧画面
│   │   │   └── RaceDetailPage.tsx  # レース詳細画面
│   │   ├── types/index.ts         # TypeScript型定義
│   │   ├── utils/api.ts           # API呼び出し
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
└── render.yaml                 # Render デプロイ設定
```

## 環境変数

| 変数名 | 説明 | 例 |
|--------|------|-----|
| `SUPABASE_URL` | SupabaseプロジェクトのURL | `https://xxx.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Supabaseサービスロールキー | `eyJhbGciOi...` |
| `PORT` | サーバーポート（デフォルト3001） | `3001` |

## セットアップ手順

### 1. Supabaseプロジェクト作成

1. https://supabase.com でプロジェクトを作成
2. SQLエディタで `server/src/db/schema.sql` を実行
3. Settings > API からURLとService Role Keyを取得

### 2. 環境変数設定

```bash
cd server
cp .env.example .env
# .envファイルにSupabaseの情報を記入
```

### 3. 依存関係インストール

```bash
# サーバー
cd server && npm install

# フロントエンド
cd ../frontend && npm install
```

### 4. データ取得

```bash
cd server

# 当日のレース情報・出走表を取得
npm run scrape:today

# オッズを取得
npm run scrape:odds

# 予測計算を実行
npm run predict

# レース結果を取得（レース終了後）
npm run scrape:results
```

### 5. 開発サーバー起動

```bash
# ターミナル1: バックエンド
cd server && npm run dev

# ターミナル2: フロントエンド
cd frontend && npm run dev
```

ブラウザで http://localhost:5173 を開く

### 6. Renderへのデプロイ

1. GitHubにpush
2. Render.com でBlueprintとして `render.yaml` を使ってデプロイ
3. 環境変数を設定

## APIエンドポイント

| メソッド | パス | 説明 |
|----------|------|------|
| `GET` | `/api/races?date=YYYY-MM-DD` | レース一覧（判定付き） |
| `GET` | `/api/races/:id` | レース詳細 |
| `POST` | `/api/refresh` | データ再取得+予測計算 |
| `POST` | `/api/predict` | 予測のみ再計算 |
| `GET` | `/api/settings` | 設定値取得 |
| `PUT` | `/api/settings` | 設定値更新 |

## 予測ロジック

### 1着確率の算出

各艇のスコアを以下の要素から算出し、正規化して確率にする。

- **コース有利性**: 1号艇55%、2号艇14%、3号艇12%、4号艇10%、5号艇6%、6号艇3%
- **選手勝率**: 全国勝率5.0を基準に±4%/ポイント
- **当地勝率**: ±2%/ポイント（軽め反映）
- **級別**: A1=×1.2、A2=×1.05、B1=×0.9、B2=×0.75
- **モーター勝率**: 35%を基準に±0.5%/ポイント
- **展示タイム**: 6.7秒を基準に±3%/0.1秒
- **スタート展示**: 0.15秒を基準に補正
- **Fカウント**: F持ちは×0.92

### 2連単確率の算出

```
P(i=1着, j=2着) = P(i=1着) × P(j=2着 | i=1着)
P(j=2着 | i=1着) = score_j / (total_score - score_i)
```

### 期待値（EV）

```
EV = 的中確率 × オッズ
```

### 見送り条件

- EVが基準値（デフォルト1.2）を超える買い目がない
- 最有力艇の1着確率が低すぎる（混戦）
- 上位2艇の差が3%未満で不確定要素が大きい

### 調整可能な閾値（settingsテーブル）

| キー | デフォルト | 説明 |
|------|-----------|------|
| `ev_threshold` | 1.2 | EV閾値（これ以上で購入推奨） |
| `min_odds` | 2.0 | 最低オッズ（これ未満は除外） |
| `max_recommendations` | 3 | 最大推奨買い目数 |
| `min_win_probability` | 0.05 | 最低1着確率 |

## 今後の改善ポイント

### 短期
- [ ] スクレイピングの安定化（HTMLパーサの改善、エラーハンドリング強化）
- [ ] 自動更新機能（cron / setIntervalで定期的にデータ取得）
- [ ] 過去データの一括取得（バックフィル機能）

### 中期
- [ ] 過去データを使ったバックテスト機能
- [ ] 予測精度の検証（的中率、回収率のトラッキング）
- [ ] 重回帰分析やロジスティック回帰による確率モデルの改善
- [ ] 風向き・天候データの取得と反映
- [ ] コース別・選手別の傾向分析

### 長期
- [ ] 機械学習モデル（LightGBM等）への移行
- [ ] リアルタイムオッズ変動の監視
- [ ] 資金管理機能（Kelly基準等）
- [ ] 3連単への拡張
- [ ] モバイル対応（PWA）
