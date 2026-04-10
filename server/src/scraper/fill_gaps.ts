import dayjs from 'dayjs';
import { initializeDatabase } from '../db/database';
import db from '../db/database';
import { fetchTodayVenues, fetchRaceCard, fetchExhibitionData, saveRaceData } from './races';
import { fetchExactaOdds, saveOddsData } from './odds';
import { fetchWinOdds, saveWinOdds } from './win_odds';
import { fetchRaceResult, saveResultData } from './results';
import { saveDiscoveredStrategies } from '../prediction/auto_strategy';

initializeDatabase();

const DELAY_MS = 300; // 高速化
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findGapDates(startDate: string, endDate: string, maxDays: number): string[] {
  const gaps: string[] = [];
  for (let d = dayjs(startDate); d.isBefore(dayjs(endDate)) && gaps.length < maxDays; d = d.add(1, 'day')) {
    const ds = d.format('YYYY-MM-DD');
    const c = (db.prepare('SELECT COUNT(*) as c FROM races WHERE race_date = ?').get(ds) as { c: number }).c;
    if (c === 0) gaps.push(ds);
  }
  return gaps;
}

async function scrapeDay(date: string): Promise<number> {
  let count = 0;
  try {
    const venueIds = await fetchTodayVenues(date);
    if (venueIds.length === 0) return 0;

    for (const venueId of venueIds) {
      for (let rno = 1; rno <= 12; rno++) {
        try {
          const { race, entries } = await fetchRaceCard(date, venueId, rno);
          if (entries.length < 6) continue;

          const exhibition = await fetchExhibitionData(date, venueId, rno);
          const raceId = saveRaceData(race, entries, exhibition);
          await sleep(DELAY_MS);

          const [exactaOdds, winOddsMap] = await Promise.all([
            fetchExactaOdds(date, venueId, rno),
            fetchWinOdds(date, venueId, rno),
          ]);
          if (exactaOdds.length > 0) saveOddsData(raceId, exactaOdds);
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

/**
 * 歯抜けデータを埋める
 *
 * 使い方:
 *   npx ts-node src/scraper/fill_gaps.ts [開始日] [終了日] [最大日数]
 *
 * 例:
 *   npx ts-node src/scraper/fill_gaps.ts 2024-01-01 2026-04-09 100
 */
async function main() {
  const startDate = process.argv[2] || '2024-01-01';
  const endDate = process.argv[3] || dayjs().format('YYYY-MM-DD');
  const maxDays = parseInt(process.argv[4] || '200', 10);

  console.log(`=== 歯抜けデータ収集: ${startDate} 〜 ${endDate} (最大${maxDays}日) ===`);

  const gaps = findGapDates(startDate, endDate, maxDays);
  console.log(`不足日数: ${gaps.length}日\n`);

  let totalCollected = 0;

  for (let i = 0; i < gaps.length; i++) {
    const date = gaps[i];
    process.stdout.write(`[${i + 1}/${gaps.length}] ${date}: `);
    const count = await scrapeDay(date);
    totalCollected += count;
    console.log(count > 0 ? ` ${count}レース` : ' 開催なし');

    if (i > 0 && i % 30 === 0) {
      console.log('\n--- 戦略再発見中... ---');
      saveDiscoveredStrategies();
      console.log('--- 完了 ---\n');
    }
  }

  const totalRaces = (db.prepare('SELECT COUNT(*) as c FROM races').get() as { c: number }).c;
  const totalDates = (db.prepare('SELECT COUNT(DISTINCT race_date) as c FROM races').get() as { c: number }).c;
  console.log(`\n=== 完了: ${totalDates}日分 / ${totalRaces}レース (新規${totalCollected}レース) ===`);

  if (totalCollected > 0) {
    console.log('\n--- 最終戦略発見... ---');
    saveDiscoveredStrategies();
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
