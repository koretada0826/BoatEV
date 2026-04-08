import dayjs from 'dayjs';
import { fetchTodayVenues, fetchRaceCard, fetchExhibitionData, saveRaceData } from './races';
import { fetchExactaOdds, saveOddsData } from './odds';
import { fetchWinOdds, saveWinOdds } from './win_odds';
import { fetchRaceResult, saveResultData } from './results';
import db from '../db/database';

const DELAY_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 当日の全レース情報を取得・保存する
 */
export async function scrapeTodayRaces(date?: string): Promise<void> {
  const targetDate = date || dayjs().format('YYYY-MM-DD');
  console.log(`=== ${targetDate} のレース情報を取得開始 ===`);

  const venueIds = await fetchTodayVenues(targetDate);
  console.log(`開催場: ${venueIds.length}場`);

  if (venueIds.length === 0) {
    console.log('本日の開催はありません');
    return;
  }

  for (const venueId of venueIds) {
    console.log(`\n--- 場ID: ${venueId} ---`);

    for (let raceNum = 1; raceNum <= 12; raceNum++) {
      try {
        console.log(`  R${raceNum} 出走表取得中...`);
        const { race, entries } = await fetchRaceCard(targetDate, venueId, raceNum);

        if (entries.length === 0) {
          console.log(`  R${raceNum} 出走表データなし`);
          continue;
        }

        const exhibition = await fetchExhibitionData(targetDate, venueId, raceNum);
        await sleep(DELAY_MS);

        const raceId = saveRaceData(race, entries, exhibition);
        console.log(`  R${raceNum} 保存完了 (raceId=${raceId}, 選手数=${entries.length})`);

        await sleep(DELAY_MS);
      } catch (e: any) {
        console.error(`  R${raceNum} エラー:`, e.message);
      }
    }
  }

  console.log('\n=== レース情報取得完了 ===');
}

/**
 * 当日の全レースのオッズを取得・保存する
 */
export async function scrapeAllOdds(date?: string): Promise<void> {
  const targetDate = date || dayjs().format('YYYY-MM-DD');
  console.log(`=== ${targetDate} のオッズ取得開始 ===`);

  const races = db.prepare(
    `SELECT id, venue_id, race_number FROM races
     WHERE race_date = ? AND status IN ('scheduled','closed')
     ORDER BY venue_id, race_number`
  ).all(targetDate) as { id: number; venue_id: number; race_number: number }[];

  if (races.length === 0) {
    console.log('対象レースなし');
    return;
  }

  for (const race of races) {
    try {
      console.log(`  場${race.venue_id} R${race.race_number} オッズ取得中...`);
      const oddsList = await fetchExactaOdds(targetDate, race.venue_id, race.race_number);

      if (oddsList.length > 0) {
        saveOddsData(race.id, oddsList);
      }

      // 単勝オッズも取得
      const winOddsMap = await fetchWinOdds(targetDate, race.venue_id, race.race_number);
      if (winOddsMap.size > 0) {
        saveWinOdds(race.id, winOddsMap);
      }

      const total = oddsList.length + winOddsMap.size;
      console.log(total > 0 ? `  -> 2連単${oddsList.length}件, 単勝${winOddsMap.size}件` : `  -> オッズ未発表`);

      await sleep(DELAY_MS);
    } catch (e: any) {
      console.error(`  場${race.venue_id} R${race.race_number} エラー:`, e.message);
    }
  }

  console.log('=== オッズ取得完了 ===');
}

/**
 * 当日の全レースの結果を取得・保存する
 */
export async function scrapeAllResults(date?: string): Promise<void> {
  const targetDate = date || dayjs().format('YYYY-MM-DD');
  console.log(`=== ${targetDate} の結果取得開始 ===`);

  const races = db.prepare(
    `SELECT id, venue_id, race_number FROM races
     WHERE race_date = ? AND status != 'finished'
     ORDER BY venue_id, race_number`
  ).all(targetDate) as { id: number; venue_id: number; race_number: number }[];

  if (races.length === 0) {
    console.log('対象レースなし');
    return;
  }

  for (const race of races) {
    try {
      console.log(`  場${race.venue_id} R${race.race_number} 結果取得中...`);
      const { results, payouts } = await fetchRaceResult(targetDate, race.venue_id, race.race_number);

      if (results.length > 0) {
        saveResultData(race.id, results, payouts);
        console.log(`  -> 結果${results.length}件, 払戻${payouts.length}件保存`);
      } else {
        console.log(`  -> 結果未確定`);
      }

      await sleep(DELAY_MS);
    } catch (e: any) {
      console.error(`  場${race.venue_id} R${race.race_number} エラー:`, e.message);
    }
  }

  console.log('=== 結果取得完了 ===');
}
