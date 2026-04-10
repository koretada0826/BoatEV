import Database, { Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DB_DIR, 'boatrace.db');

// dataディレクトリがなければ作成
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const db: DatabaseType = new Database(DB_PATH);

// WALモードで高速化
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export default db;

/**
 * テーブルを初期化する（初回起動時に自動実行）
 */
export function initializeDatabase(): void {
  db.exec(`
    -- 開催場マスタ
    CREATE TABLE IF NOT EXISTS venues (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      short_name TEXT NOT NULL
    );

    -- レーステーブル
    CREATE TABLE IF NOT EXISTS races (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      race_date TEXT NOT NULL,
      venue_id INTEGER NOT NULL REFERENCES venues(id),
      race_number INTEGER NOT NULL,
      race_name TEXT,
      deadline TEXT,
      status TEXT NOT NULL DEFAULT 'scheduled',
      weather TEXT,
      wind_direction TEXT,
      wind_speed REAL,
      wave_height REAL,
      temperature REAL,
      water_temperature REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(race_date, venue_id, race_number)
    );

    CREATE INDEX IF NOT EXISTS idx_races_date ON races(race_date);
    CREATE INDEX IF NOT EXISTS idx_races_status ON races(status);

    -- 出走表
    CREATE TABLE IF NOT EXISTS race_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      race_id INTEGER NOT NULL REFERENCES races(id) ON DELETE CASCADE,
      boat_number INTEGER NOT NULL,
      racer_id INTEGER,
      racer_name TEXT NOT NULL,
      racer_class TEXT,
      racer_branch TEXT,
      win_rate_all REAL,
      win_rate_local REAL,
      motor_number INTEGER,
      motor_win_rate REAL,
      boat_number_assigned INTEGER,
      boat_win_rate REAL,
      exhibition_time REAL,
      tilt REAL,
      weight REAL,
      start_timing REAL,
      flying_count INTEGER DEFAULT 0,
      late_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(race_id, boat_number)
    );

    CREATE INDEX IF NOT EXISTS idx_race_entries_race ON race_entries(race_id);

    -- オッズ（2連単）
    CREATE TABLE IF NOT EXISTS odds_exacta (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      race_id INTEGER NOT NULL REFERENCES races(id) ON DELETE CASCADE,
      first_place INTEGER NOT NULL,
      second_place INTEGER NOT NULL,
      odds REAL NOT NULL,
      popularity INTEGER,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(race_id, first_place, second_place)
    );

    CREATE INDEX IF NOT EXISTS idx_odds_race ON odds_exacta(race_id);

    -- レース結果
    CREATE TABLE IF NOT EXISTS results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      race_id INTEGER NOT NULL REFERENCES races(id) ON DELETE CASCADE,
      place INTEGER NOT NULL,
      boat_number INTEGER NOT NULL,
      racer_name TEXT,
      race_time TEXT,
      start_timing REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(race_id, place)
    );

    CREATE INDEX IF NOT EXISTS idx_results_race ON results(race_id);

    -- 払戻金
    CREATE TABLE IF NOT EXISTS payouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      race_id INTEGER NOT NULL REFERENCES races(id) ON DELETE CASCADE,
      bet_type TEXT NOT NULL,
      combination TEXT NOT NULL,
      payout INTEGER NOT NULL,
      popularity INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_payouts_race ON payouts(race_id);

    -- 予測結果
    CREATE TABLE IF NOT EXISTS predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      race_id INTEGER NOT NULL REFERENCES races(id) ON DELETE CASCADE,
      boat_number INTEGER NOT NULL,
      win_probability REAL NOT NULL,
      place_probability REAL NOT NULL,
      calculated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(race_id, boat_number)
    );

    CREATE INDEX IF NOT EXISTS idx_predictions_race ON predictions(race_id);

    -- 購入推奨
    CREATE TABLE IF NOT EXISTS buy_recommendations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      race_id INTEGER NOT NULL REFERENCES races(id) ON DELETE CASCADE,
      verdict TEXT NOT NULL,
      skip_reason TEXT,
      calculated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(race_id)
    );

    CREATE INDEX IF NOT EXISTS idx_buy_recommendations_race ON buy_recommendations(race_id);

    -- 購入推奨の買い目詳細
    CREATE TABLE IF NOT EXISTS buy_recommendation_details (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recommendation_id INTEGER NOT NULL REFERENCES buy_recommendations(id) ON DELETE CASCADE,
      rank INTEGER NOT NULL,
      first_place INTEGER NOT NULL,
      second_place INTEGER NOT NULL,
      probability REAL NOT NULL,
      odds REAL NOT NULL,
      expected_value REAL NOT NULL,
      reason TEXT NOT NULL,
      UNIQUE(recommendation_id, rank)
    );

    CREATE INDEX IF NOT EXISTS idx_buy_details_rec ON buy_recommendation_details(recommendation_id);

    -- 単勝オッズ
    CREATE TABLE IF NOT EXISTS win_odds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      race_id INTEGER NOT NULL REFERENCES races(id) ON DELETE CASCADE,
      boat_number INTEGER NOT NULL,
      odds REAL NOT NULL,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(race_id, boat_number)
    );

    CREATE INDEX IF NOT EXISTS idx_win_odds_race ON win_odds(race_id);

    -- コース別×級別の実績統計（過去データから算出）
    CREATE TABLE IF NOT EXISTS course_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      boat_number INTEGER NOT NULL,
      racer_class TEXT NOT NULL,
      total_races INTEGER NOT NULL DEFAULT 0,
      win_count INTEGER NOT NULL DEFAULT 0,
      place2_count INTEGER NOT NULL DEFAULT 0,
      win_rate REAL NOT NULL DEFAULT 0,
      place2_rate REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(boat_number, racer_class)
    );

    -- 収支記録テーブル
    CREATE TABLE IF NOT EXISTS bet_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      race_id INTEGER REFERENCES races(id) ON DELETE SET NULL,
      bet_date TEXT NOT NULL,
      venue_name TEXT NOT NULL,
      race_number INTEGER NOT NULL,
      bet_type TEXT NOT NULL DEFAULT '2連単',
      bet_combination TEXT NOT NULL,
      bet_amount INTEGER NOT NULL,
      is_hit INTEGER NOT NULL DEFAULT 0,
      payout INTEGER NOT NULL DEFAULT 0,
      odds REAL,
      memo TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_bet_records_date ON bet_records(bet_date);

    -- 設定テーブル
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // 開催場マスタの初期データ
  const insertVenue = db.prepare('INSERT OR IGNORE INTO venues (id, name, short_name) VALUES (?, ?, ?)');
  const venues: [number, string, string][] = [
    [1,'桐生','桐生'],[2,'戸田','戸田'],[3,'江戸川','江戸'],[4,'平和島','平和'],
    [5,'多摩川','多摩'],[6,'浜名湖','浜名'],[7,'蒲郡','蒲郡'],[8,'常滑','常滑'],
    [9,'津','津'],[10,'三国','三国'],[11,'びわこ','びわ'],[12,'住之江','住之'],
    [13,'尼崎','尼崎'],[14,'鳴門','鳴門'],[15,'丸亀','丸亀'],[16,'児島','児島'],
    [17,'宮島','宮島'],[18,'徳山','徳山'],[19,'下関','下関'],[20,'若松','若松'],
    [21,'芦屋','芦屋'],[22,'福岡','福岡'],[23,'唐津','唐津'],[24,'大村','大村'],
  ];
  const insertMany = db.transaction(() => {
    for (const v of venues) insertVenue.run(...v);
  });
  insertMany();

  // 設定の初期データ
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  const settingsInit = db.transaction(() => {
    insertSetting.run('ev_threshold', '0.85');
    insertSetting.run('min_odds', '3.0');
    insertSetting.run('max_odds', '100.0');
    insertSetting.run('max_recommendations', '3');
    insertSetting.run('min_win_probability', '0.10');
    insertSetting.run('min_edge', '2.5');
  });
  settingsInit();

  // マイグレーション: bet_recordsテーブル追加
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bet_records'").get();
  if (!tables) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS bet_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        race_id INTEGER REFERENCES races(id) ON DELETE SET NULL,
        bet_date TEXT NOT NULL,
        venue_name TEXT NOT NULL,
        race_number INTEGER NOT NULL,
        bet_type TEXT NOT NULL DEFAULT '2連単',
        bet_combination TEXT NOT NULL,
        bet_amount INTEGER NOT NULL,
        is_hit INTEGER NOT NULL DEFAULT 0,
        payout INTEGER NOT NULL DEFAULT 0,
        odds REAL,
        memo TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_bet_records_date ON bet_records(bet_date);
    `);
    console.log('Migration: added bet_records table');
  }

  // マイグレーション: 天候カラム追加（既存DBに対応）
  const raceColumns = db.prepare("PRAGMA table_info(races)").all() as { name: string }[];
  const raceColNames = raceColumns.map(c => c.name);
  if (!raceColNames.includes('weather')) {
    db.exec(`
      ALTER TABLE races ADD COLUMN weather TEXT;
      ALTER TABLE races ADD COLUMN wind_direction TEXT;
      ALTER TABLE races ADD COLUMN wind_speed REAL;
      ALTER TABLE races ADD COLUMN wave_height REAL;
      ALTER TABLE races ADD COLUMN temperature REAL;
      ALTER TABLE races ADD COLUMN water_temperature REAL;
    `);
    console.log('Migration: added weather columns to races');
  }

  console.log('Database initialized:', DB_PATH);
}
