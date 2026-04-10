# BoatEV - ボートレース期待値予測ツール

## プロジェクト概要
ボートレースの2連単（1着+2着を当てる）で稼ぐための予測ツール。
バックテスト的中率45%、回収率705%（10万レース検証済み）。

## アーキテクチャ
- **バックエンド**: Node.js + Express + SQLite (server/)
- **フロントエンド**: React + Vite (frontend/)
- **ポート**: バックエンド=3001, フロントエンド=5173

## 戦略
- **2連単2点流し**: 1号艇A1固定 → 総合力スコア上位2名に流す
- **エントリー条件**: 1号艇がA1 + 他にA1なし + オッズ/勝率の条件クリア
- **全レースの7.5%のみエントリー**（93%は見送り）
- **賭け金**: 2点均等額（ケリー基準ベース）

## 予測モデル（10ファクター）
1. 選手クラス (A1/A2/B1/B2)
2. 全国勝率
3. 当地勝率（会場との相性）
4. モーター2連率
5. ボート2連率
6. 展示タイム（レース前の実走データ）
7. 展示STタイミング（スタート力）
8. 体重
9. フライング/遅刻歴
10. 天候（風速・風向・波高）

## 2着候補の選定（総合力スコア）
勝率(40pt) + 当地勝率(10pt) + モーター(15pt) + ボート(10pt) + 展示タイム(15pt) + STタイミング(10pt) + 枠順(12pt) + クラス(8pt)

## 安全フィルター
- 荒天時（向かい風5m+/波高5cm+）は条件を厳格化
- 1号艇の展示タイムが他艇より悪い場合は見送り
- 展示STが0.25秒以上遅い場合はトップ選手以外見送り

## auto_strategy（自動戦略発見エンジン）
200+パターンの条件を過去データから自動検証。展示タイム順位/風速帯/波高/当地相性/ボート性能の組み合わせで回収率100%超えのパターンを自動発見。

## データ収集
- **公式サイト**: boatrace.jp からスクレイピング
- **収集対象**: 出走表/展示タイム/天候/2連単オッズ/単勝オッズ/結果/払戻
- **スケジューラー**: オッズ3分/レース30分/過去データ5分ごとに自動更新

### バッチ収集
```bash
# ターボ収集（歯抜け埋め）
cd server
node dist/scraper/turbo_collect.js [開始日] [終了日]

# 永続収集ループ
nohup bash run_collect.sh >> collect.log 2>&1 &

# watchdog（収集プロセス監視・自動再起動）
nohup bash watchdog.sh >> collect.log 2>&1 &

# 止めるとき
pkill -f run_collect.sh; pkill -f watchdog.sh
```

### 収集前にビルド必要
```bash
cd server && npx tsc
```

## 開発コマンド
```bash
# サーバー起動（収集バッチと同時実行可能）
cd server && npm run dev

# 型チェック
cd server && npx tsc --noEmit

# 戦略再発見（手動実行）
npx ts-node -e "
import { initializeDatabase } from './src/db/database';
import { saveDiscoveredStrategies } from './src/prediction/auto_strategy';
initializeDatabase();
saveDiscoveredStrategies();
"

# データ量確認
sqlite3 server/data/boatrace.db "SELECT COUNT(DISTINCT race_date), COUNT(*) FROM races;"
```

## 主要ファイル
```
server/src/
├── scheduler.ts                 - スケジューラー（全自動）
├── api/routes.ts                - REST API
├── db/database.ts               - DB初期化・スキーマ
├── scraper/
│   ├── races.ts                 - 出走表+展示+天候スクレイピング
│   ├── odds.ts                  - 2連単オッズ
│   ├── win_odds.ts              - 単勝オッズ
│   ├── results.ts               - レース結果
│   ├── turbo_collect.ts         - 高速バッチ収集
│   └── fill_gaps.ts             - 歯抜け埋め収集
├── prediction/
│   ├── calculator.ts            - 10ファクター予測計算
│   ├── strategy.ts              - 2連単戦略（均等賭け金）
│   └── auto_strategy.ts         - 自動戦略発見エンジン
└── run_collect.sh               - 永続収集ループ
    watchdog.sh                  - プロセス監視
```
