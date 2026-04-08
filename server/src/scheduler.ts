import dayjs from 'dayjs';
import { scrapeTodayRaces, scrapeAllOdds } from './scraper/index';
import { predictRace, savePrediction } from './prediction/calculator';
import { saveDiscoveredStrategies } from './prediction/auto_strategy';
import db from './db/database';

const ODDS_INTERVAL_MS = 3 * 60 * 1000; // 3分ごとにオッズ更新
const RACE_FETCH_INTERVAL_MS = 30 * 60 * 1000; // 30分ごとにレース情報更新

let lastOddsFetch = 0;
let lastRaceFetch = 0;
let isRunning = false;

/**
 * 最終更新時刻を返す
 */
export function getLastUpdate(): { odds: number; races: number } {
  return { odds: lastOddsFetch, races: lastRaceFetch };
}

/**
 * オッズ取得 → 予測更新を行う
 */
async function updateOddsAndPredict(): Promise<{ updated: number; buy: number; skip: number }> {
  if (isRunning) return { updated: 0, buy: 0, skip: 0 };
  isRunning = true;

  try {
    const today = dayjs().format('YYYY-MM-DD');

    // オッズ取得
    await scrapeAllOdds(today);
    lastOddsFetch = Date.now();

    // 全レースの予測を再計算
    const races = db.prepare('SELECT id FROM races WHERE race_date = ?').all(today) as { id: number }[];

    let buy = 0;
    let skip = 0;
    for (const race of races) {
      const result = predictRace(race.id);
      savePrediction(result);
      if (result.verdict === 'buy') buy++;
      else skip++;
    }

    console.log(`[自動更新] ${dayjs().format('HH:mm:ss')} オッズ更新+予測完了 (購入推奨: ${buy}, 見送り: ${skip})`);
    return { updated: races.length, buy, skip };
  } catch (e: any) {
    console.error('[自動更新] エラー:', e.message);
    return { updated: 0, buy: 0, skip: 0 };
  } finally {
    isRunning = false;
  }
}

/**
 * レース情報を取得する
 */
async function updateRaces(): Promise<void> {
  if (isRunning) return;
  isRunning = true;

  try {
    const today = dayjs().format('YYYY-MM-DD');
    await scrapeTodayRaces(today);
    lastRaceFetch = Date.now();
    console.log(`[自動更新] ${dayjs().format('HH:mm:ss')} レース情報更新完了`);
  } catch (e: any) {
    console.error('[自動更新] レース取得エラー:', e.message);
  } finally {
    isRunning = false;
  }
}

async function fetchTomorrowRaces(): Promise<void> {
  try {
    const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD');
    const existing = db.prepare('SELECT COUNT(*) as c FROM races WHERE race_date = ?').get(tomorrow) as { c: number };
    if (existing.c > 0) return; // 既に取得済み
    console.log(`[自動更新] 明日(${tomorrow})のレース情報を取得中...`);
    await scrapeTodayRaces(tomorrow);
    console.log(`[自動更新] 明日のレース情報取得完了`);
  } catch (e: any) {
    console.error('[自動更新] 明日のレース取得エラー:', e.message);
  }
}

/**
 * 自動更新スケジューラーを開始する
 */
export async function startScheduler(): Promise<void> {
  console.log('[スケジューラー] 開始 - オッズ3分ごと / レース情報30分ごと');

  // 初回: 戦略を再発見（過去データから）
  try { saveDiscoveredStrategies(); } catch (e: any) { console.error('[戦略発見] エラー:', e.message); }

  // 初回: 今日+明日のレース情報取得
  await updateRaces();
  await fetchTomorrowRaces();
  // 初回: オッズ取得 + 予測
  await updateOddsAndPredict();

  // 定期実行: オッズ + 予測（3分ごと）
  setInterval(async () => {
    const hour = dayjs().hour();
    // 8時〜18時の間のみ自動更新（レース開催時間帯）
    if (hour >= 8 && hour <= 18) {
      await updateOddsAndPredict();
    }
  }, ODDS_INTERVAL_MS);

  // 定期実行: レース情報（30分ごと）
  setInterval(async () => {
    const hour = dayjs().hour();
    if (hour >= 7 && hour <= 18) {
      await updateRaces();
    }
    // 夜に翌日のレース情報を取得
    if (hour === 20 || hour === 21) {
      await fetchTomorrowRaces();
    }
  }, RACE_FETCH_INTERVAL_MS);
}

export { updateOddsAndPredict };
