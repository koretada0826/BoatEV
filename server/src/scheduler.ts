import dayjs from 'dayjs';
import { scrapeTodayRaces, scrapeAllOdds } from './scraper/index';
import { predictRace, savePrediction } from './prediction/calculator';
import { saveDiscoveredStrategies } from './prediction/auto_strategy';
import { fetchTodayVenues, fetchRaceCard, fetchExhibitionData, saveRaceData, fetchRaceDeadlines, saveDeadlines } from './scraper/races';
import { fetchExactaOdds, saveOddsData } from './scraper/odds';
import { fetchWinOdds, saveWinOdds } from './scraper/win_odds';
import { fetchRaceResult, saveResultData } from './scraper/results';
import db from './db/database';

const ODDS_INTERVAL_MS = 3 * 60 * 1000;
const RACE_FETCH_INTERVAL_MS = 30 * 60 * 1000;
const HISTORY_INTERVAL_MS = 5 * 60 * 1000; // 5分ごとに過去データ収集（高速化）

let lastOddsFetch = 0;
let lastRaceFetch = 0;
let isRunning = false;
let isHistoryRunning = false;

export function getLastUpdate() {
  return { odds: lastOddsFetch, races: lastRaceFetch };
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function updateOddsAndPredictInner(): Promise<{ updated: number; buy: number; skip: number }> {
  const today = dayjs().format('YYYY-MM-DD');
  await scrapeAllOdds(today);
  lastOddsFetch = Date.now();

  const races = db.prepare('SELECT id FROM races WHERE race_date = ?').all(today) as { id: number }[];
  let buy = 0, skip = 0;
  for (const race of races) {
    const result = predictRace(race.id);
    savePrediction(result);
    if (result.verdict === 'buy') buy++; else skip++;
  }
  console.log(`[自動更新] ${dayjs().format('HH:mm:ss')} オッズ+予測完了 (買い${buy}/見送り${skip})`);
  return { updated: races.length, buy, skip };
}

export async function updateOddsAndPredict() {
  if (isRunning) return { updated: 0, buy: 0, skip: 0 };
  isRunning = true;
  try { return await updateOddsAndPredictInner(); }
  catch (e: any) { console.error('[自動更新] エラー:', e.message); return { updated: 0, buy: 0, skip: 0 }; }
  finally { isRunning = false; }
}

async function updateRaces() {
  if (isRunning) return;
  isRunning = true;
  try {
    const today = dayjs().format('YYYY-MM-DD');
    await scrapeTodayRaces(today);
    lastRaceFetch = Date.now();

    // 締切時間を取得
    const todayVenues = await fetchTodayVenues(today);
    for (const vid of todayVenues) {
      try {
        const deadlines = await fetchRaceDeadlines(today, vid);
        if (deadlines.size > 0) saveDeadlines(today, vid, deadlines);
        await sleep(800);
      } catch {}
    }

    // 明日のレースも取得
    const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD');
    const tomorrowExists = (db.prepare('SELECT COUNT(*) as c FROM races WHERE race_date = ?').get(tomorrow) as { c: number }).c;
    if (tomorrowExists === 0) {
      await scrapeTodayRaces(tomorrow);
      console.log(`[自動更新] 明日(${tomorrow})のレース情報取得完了`);
    }

    // 昨日の結果を取得（まだなければ）
    const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
    const yestResults = (db.prepare(`
      SELECT COUNT(*) as c FROM results r JOIN races ra ON ra.id = r.race_id WHERE ra.race_date = ?
    `).get(yesterday) as { c: number }).c;
    if (yestResults === 0) {
      const yestRaces = db.prepare('SELECT id, venue_id, race_number FROM races WHERE race_date = ?').all(yesterday) as any[];
      for (const race of yestRaces) {
        try {
          const { results, payouts } = await fetchRaceResult(yesterday, race.venue_id, race.race_number);
          if (results.length > 0) saveResultData(race.id, results, payouts);
          await sleep(1000);
        } catch {}
      }
      console.log(`[自動更新] 昨日(${yesterday})の結果取得完了`);
    }
  } catch (e: any) {
    console.error('[自動更新] レース取得エラー:', e.message);
  } finally {
    isRunning = false;
  }
}

/**
 * 過去データを自動で埋めていく（サーバー稼働中にバックグラウンドで）
 */
async function collectHistoricalData() {
  if (isHistoryRunning) return;
  isHistoryRunning = true;

  try {
    // 最も古いデータの日付を取得
    const oldest = db.prepare('SELECT MIN(race_date) as d FROM races').get() as { d: string | null };
    const newest = db.prepare('SELECT MAX(race_date) as d FROM races').get() as { d: string | null };
    const totalDays = (db.prepare('SELECT COUNT(DISTINCT race_date) as c FROM races').get() as { c: number }).c;
    const totalRaces = (db.prepare('SELECT COUNT(*) as c FROM races').get() as { c: number }).c;

    // 過去に遡る（1日分ずつ）
    const oldestDate = oldest?.d ? dayjs(oldest.d) : dayjs();
    const targetDate = oldestDate.subtract(1, 'day').format('YYYY-MM-DD');

    // 歯抜けを埋める（既存の最古〜最新の間で欠けている日を探す）
    let dateToFetch = targetDate;
    if (newest?.d && oldest?.d) {
      const start = dayjs(oldest.d);
      const end = dayjs(newest.d);
      for (let d = start; d.isBefore(end); d = d.add(1, 'day')) {
        const ds = d.format('YYYY-MM-DD');
        const exists = (db.prepare('SELECT COUNT(*) as c FROM races WHERE race_date = ?').get(ds) as { c: number }).c;
        if (exists === 0) {
          dateToFetch = ds;
          break;
        }
      }
    }

    // 1日分取得
    const existing = (db.prepare('SELECT COUNT(*) as c FROM races WHERE race_date = ?').get(dateToFetch) as { c: number }).c;
    if (existing > 0) {
      isHistoryRunning = false;
      return;
    }

    console.log(`[データ収集] ${dateToFetch} を取得中... (${totalDays}日分/${totalRaces}レース蓄積済み)`);

    const venueIds = await fetchTodayVenues(dateToFetch);
    if (venueIds.length === 0) {
      isHistoryRunning = false;
      return;
    }

    for (const venueId of venueIds) {
      for (let rno = 1; rno <= 12; rno++) {
        try {
          const { race, entries } = await fetchRaceCard(dateToFetch, venueId, rno);
          if (entries.length < 6) continue;
          const exhibition = await fetchExhibitionData(dateToFetch, venueId, rno);
          const raceId = saveRaceData(race, entries, exhibition);
          await sleep(800);

          const exactaOdds = await fetchExactaOdds(dateToFetch, venueId, rno);
          if (exactaOdds.length > 0) saveOddsData(raceId, exactaOdds);

          const winOddsMap = await fetchWinOdds(dateToFetch, venueId, rno);
          if (winOddsMap.size > 0) saveWinOdds(raceId, winOddsMap);
          await sleep(800);

          const { results, payouts } = await fetchRaceResult(dateToFetch, venueId, rno);
          if (results.length > 0) saveResultData(raceId, results, payouts);
          await sleep(800);
        } catch {}
      }
    }

    const newCount = (db.prepare('SELECT COUNT(*) as c FROM races WHERE race_date = ?').get(dateToFetch) as { c: number }).c;
    const newTotal = (db.prepare('SELECT COUNT(DISTINCT race_date) as c FROM races').get() as { c: number }).c;
    console.log(`[データ収集] ${dateToFetch} 完了 (${newCount}レース) → 合計${newTotal}日分`);

    // 30日ごとに統計と戦略を更新（高速化）
    if (newTotal % 30 === 0) {
      saveDiscoveredStrategies();
    }
  } catch (e: any) {
    console.error('[データ収集] エラー:', e.message);
  } finally {
    isHistoryRunning = false;
  }
}

export async function startScheduler(): Promise<void> {
  console.log('[スケジューラー] 開始 - 全自動モード');

  // 初回: 戦略更新
  try { saveDiscoveredStrategies(); } catch (e: any) { console.error('[戦略] エラー:', e.message); }

  // 初回: 今日+明日のレース+昨日の結果
  await updateRaces();
  await updateOddsAndPredict();

  // 3分ごと: オッズ取得+予測更新（8-18時）
  setInterval(async () => {
    const hour = dayjs().hour();
    if (hour >= 8 && hour <= 18) {
      await updateOddsAndPredict();
    }
  }, ODDS_INTERVAL_MS);

  // 30分ごと: レース情報更新（7-21時）
  setInterval(async () => {
    const hour = dayjs().hour();
    if (hour >= 7 && hour <= 21) {
      await updateRaces();
    }
  }, RACE_FETCH_INTERVAL_MS);

  // 10分ごと: 過去データ収集（24時間）
  setInterval(() => {
    collectHistoricalData();
  }, HISTORY_INTERVAL_MS);

  // 初回: 過去データ収集も開始
  setTimeout(() => collectHistoricalData(), 30000);

  console.log('[スケジューラー] オッズ3分/レース30分/過去データ10分ごとに自動更新');
}
