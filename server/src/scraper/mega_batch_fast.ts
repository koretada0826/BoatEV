import dayjs from 'dayjs';
import { initializeDatabase } from '../db/database';
import db from '../db/database';
import { fetchTodayVenues, fetchRaceCard, saveRaceData } from './races';
import { fetchExactaOdds, saveOddsData } from './odds';
import { fetchWinOdds, saveWinOdds } from './win_odds';
import { fetchRaceResult, saveResultData } from './results';

initializeDatabase();

const DELAY_MS = 800; // 少し速め
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function scrapeDay(date: string): Promise<number> {
  const existing = db.prepare('SELECT COUNT(*) as c FROM races WHERE race_date = ?').get(date) as { c: number };
  if (existing.c > 50) return 0;

  let count = 0;
  try {
    const venueIds = await fetchTodayVenues(date);
    if (venueIds.length === 0) return 0;

    for (const venueId of venueIds) {
      for (let rno = 1; rno <= 12; rno++) {
        try {
          const { race, entries } = await fetchRaceCard(date, venueId, rno);
          if (entries.length < 6) continue;
          const raceId = saveRaceData(race, entries, new Map());
          await sleep(DELAY_MS);

          const exactaOdds = await fetchExactaOdds(date, venueId, rno);
          if (exactaOdds.length > 0) saveOddsData(raceId, exactaOdds);

          const winOddsMap = await fetchWinOdds(date, venueId, rno);
          if (winOddsMap.size > 0) saveWinOdds(raceId, winOddsMap);
          await sleep(DELAY_MS);

          const { results, payouts } = await fetchRaceResult(date, venueId, rno);
          if (results.length > 0) saveResultData(raceId, results, payouts);
          await sleep(DELAY_MS);

          count++;
          process.stdout.write('.');
        } catch {
          process.stdout.write('x');
        }
      }
    }
  } catch {}
  return count;
}

// 別の日付範囲を処理する（既存バッチと重複しないように）
// 引数: 開始日(何日前) 終了日(何日前)
async function main() {
  const startDay = parseInt(process.argv[2] || '91', 10);
  const endDay = parseInt(process.argv[3] || '180', 10);
  const today = dayjs();

  console.log(`=== ${startDay}日前〜${endDay}日前を収集 ===`);

  for (let d = startDay; d <= endDay; d++) {
    const date = today.subtract(d, 'day').format('YYYY-MM-DD');
    process.stdout.write(`${date}: `);
    const count = await scrapeDay(date);
    console.log(count > 0 ? ` ${count}レース` : ' skip');
  }

  const totalRaces = (db.prepare('SELECT COUNT(*) as c FROM races').get() as { c: number }).c;
  const totalDates = (db.prepare('SELECT COUNT(DISTINCT race_date) as c FROM races').get() as { c: number }).c;
  console.log(`\n完了: ${totalDates}日分 / ${totalRaces}レース`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
