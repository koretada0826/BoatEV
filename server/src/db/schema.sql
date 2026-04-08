-- =============================================
-- ボートレース期待値予測ツール DB設計
-- =============================================

-- 開催場マスタ
CREATE TABLE venues (
  id SMALLINT PRIMARY KEY,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL
);

INSERT INTO venues (id, name, short_name) VALUES
  (1, '桐生', '桐生'), (2, '戸田', '戸田'), (3, '江戸川', '江戸'), (4, '平和島', '平和'),
  (5, '多摩川', '多摩'), (6, '浜名湖', '浜名'), (7, '蒲郡', '蒲郡'), (8, '常滑', '常滑'),
  (9, '津', '津'), (10, '三国', '三国'), (11, 'びわこ', 'びわ'), (12, '住之江', '住之'),
  (13, '尼崎', '尼崎'), (14, '鳴門', '鳴門'), (15, '丸亀', '丸亀'), (16, '児島', '児島'),
  (17, '宮島', '宮島'), (18, '徳山', '徳山'), (19, '下関', '下関'), (20, '若松', '若松'),
  (21, '芦屋', '芦屋'), (22, '福岡', '福岡'), (23, '唐津', '唐津'), (24, '大村', '大村');

-- レーステーブル
CREATE TABLE races (
  id BIGSERIAL PRIMARY KEY,
  race_date DATE NOT NULL,
  venue_id SMALLINT NOT NULL REFERENCES venues(id),
  race_number SMALLINT NOT NULL,
  race_name TEXT,
  deadline TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'scheduled', -- scheduled, closed, finished
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(race_date, venue_id, race_number)
);

CREATE INDEX idx_races_date ON races(race_date);
CREATE INDEX idx_races_status ON races(status);

-- 出走表（各レースの選手情報）
CREATE TABLE race_entries (
  id BIGSERIAL PRIMARY KEY,
  race_id BIGINT NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  boat_number SMALLINT NOT NULL, -- 1-6
  racer_id INTEGER,
  racer_name TEXT NOT NULL,
  racer_class TEXT, -- A1, A2, B1, B2
  racer_branch TEXT, -- 支部
  win_rate_all NUMERIC(5,2), -- 全国勝率
  win_rate_local NUMERIC(5,2), -- 当地勝率
  motor_number INTEGER,
  motor_win_rate NUMERIC(5,2),
  boat_number_assigned INTEGER,
  boat_win_rate NUMERIC(5,2),
  exhibition_time NUMERIC(5,2), -- 展示タイム
  tilt NUMERIC(4,1), -- チルト
  weight NUMERIC(5,1),
  start_timing NUMERIC(4,2), -- スタートタイミング (展示)
  flying_count INTEGER DEFAULT 0, -- F数
  late_count INTEGER DEFAULT 0, -- L数
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(race_id, boat_number)
);

CREATE INDEX idx_race_entries_race ON race_entries(race_id);

-- オッズ（2連単）
CREATE TABLE odds_exacta (
  id BIGSERIAL PRIMARY KEY,
  race_id BIGINT NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  first_place SMALLINT NOT NULL, -- 1着艇番
  second_place SMALLINT NOT NULL, -- 2着艇番
  odds NUMERIC(8,1) NOT NULL,
  popularity INTEGER, -- 人気順
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(race_id, first_place, second_place)
);

CREATE INDEX idx_odds_race ON odds_exacta(race_id);

-- レース結果
CREATE TABLE results (
  id BIGSERIAL PRIMARY KEY,
  race_id BIGINT NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  place SMALLINT NOT NULL, -- 着順
  boat_number SMALLINT NOT NULL,
  racer_name TEXT,
  race_time TEXT, -- レースタイム
  start_timing NUMERIC(4,2), -- 本番ST
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(race_id, place)
);

CREATE INDEX idx_results_race ON results(race_id);

-- 払戻金
CREATE TABLE payouts (
  id BIGSERIAL PRIMARY KEY,
  race_id BIGINT NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  bet_type TEXT NOT NULL, -- exacta(2連単), quinella(2連複), trifecta(3連単), trio(3連複), win(単勝), place(複勝)
  combination TEXT NOT NULL, -- '1-3', '1-3-5' etc
  payout INTEGER NOT NULL,
  popularity INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payouts_race ON payouts(race_id);

-- 予測結果
CREATE TABLE predictions (
  id BIGSERIAL PRIMARY KEY,
  race_id BIGINT NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  boat_number SMALLINT NOT NULL,
  win_probability NUMERIC(6,4) NOT NULL, -- 1着確率
  place_probability NUMERIC(6,4) NOT NULL, -- 2着確率
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(race_id, boat_number)
);

CREATE INDEX idx_predictions_race ON predictions(race_id);

-- 購入推奨
CREATE TABLE buy_recommendations (
  id BIGSERIAL PRIMARY KEY,
  race_id BIGINT NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  verdict TEXT NOT NULL, -- 'buy' or 'skip'
  skip_reason TEXT, -- 見送り理由
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(race_id)
);

CREATE INDEX idx_buy_recommendations_race ON buy_recommendations(race_id);

-- 購入推奨の買い目詳細
CREATE TABLE buy_recommendation_details (
  id BIGSERIAL PRIMARY KEY,
  recommendation_id BIGINT NOT NULL REFERENCES buy_recommendations(id) ON DELETE CASCADE,
  rank SMALLINT NOT NULL, -- 推奨順位
  first_place SMALLINT NOT NULL,
  second_place SMALLINT NOT NULL,
  probability NUMERIC(6,4) NOT NULL,
  odds NUMERIC(8,1) NOT NULL,
  expected_value NUMERIC(8,4) NOT NULL,
  reason TEXT NOT NULL,
  UNIQUE(recommendation_id, rank)
);

CREATE INDEX idx_buy_details_rec ON buy_recommendation_details(recommendation_id);

-- 設定テーブル（閾値など）
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO settings (key, value) VALUES
  ('ev_threshold', '1.2'),
  ('min_odds', '2.0'),
  ('max_recommendations', '3'),
  ('min_win_probability', '0.05');

-- Row Level Security（必要に応じて有効化）
-- ALTER TABLE races ENABLE ROW LEVEL SECURITY;

-- Updated_at自動更新用トリガー
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER races_updated_at
  BEFORE UPDATE ON races
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
