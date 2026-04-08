import dayjs from 'dayjs';
import { initializeDatabase } from '../db/database';
import db from '../db/database';
import { fetchTodayVenues, fetchRaceCard, saveRaceData } from './races';
import { fetchExactaOdds, saveOddsData } from './odds';
import { fetchWinOdds, saveWinOdds } from './win_odds';
import { fetchRaceResult, saveResultData } from './results';

initializeDatabase();

const DELAY_MS = 1000;
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rebuildStats() {
  const stats = db.prepare(`
    SELECT re.boat_number, re.racer_class,
      COUNT(*) as total, SUM(CASE WHEN r.place = 1 THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN r.place <= 2 THEN 1 ELSE 0 END) as place2
    FROM race_entries re
    JOIN results r ON r.race_id = re.race_id AND r.boat_number = re.boat_number
    WHERE re.racer_class IN ('A1','A2','B1','B2')
    GROUP BY re.boat_number, re.racer_class
  `).all() as any[];

  const upsert = db.prepare(`
    INSERT INTO course_stats (boat_number, racer_class, total_races, win_count, place2_count, win_rate, place2_rate)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(boat_number, racer_class) DO UPDATE SET
      total_races=excluded.total_races, win_count=excluded.win_count, place2_count=excluded.place2_count,
      win_rate=excluded.win_rate, place2_rate=excluded.place2_rate
  `);

  db.transaction(() => {
    for (const s of stats) {
      upsert.run(s.boat_number, s.racer_class, s.total, s.wins, s.place2,
        s.total > 0 ? s.wins / s.total : 0, s.total > 0 ? s.place2 / s.total : 0);
    }
  })();
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

          const emptyMap = new Map();
          const raceId = saveRaceData(race, entries, emptyMap);
          await sleep(DELAY_MS);

          const exactaOdds = await fetchExactaOdds(date, venueId, rno);
          if (exactaOdds.length > 0) saveOddsData(raceId, exactaOdds);
          await sleep(DELAY_MS);

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
  } catch (e: any) {
    console.error(`\n${date} エラー:`, e.message);
  }
  return count;
}

async function main() {
  const daysBack = parseInt(process.argv[2] || '90', 10);
  const today = dayjs();

  console.log(`=== 過去${daysBack}日分を収集開始 ===`);
  console.log(`開始: ${dayjs().format('HH:mm:ss')}\n`);

  let totalNew = 0;
  let daysProcessed = 0;

  for (let d = daysBack; d >= 1; d--) {
    const date = today.subtract(d, 'day').format('YYYY-MM-DD');
    process.stdout.write(`${date}: `);

    const count = await scrapeDay(date);
    if (count > 0) {
      totalNew += count;
      console.log(` ${count}レース`);
    } else {
      console.log(' skip');
    }

    daysProcessed++;

    // 10日ごとに統計を再構築して進捗表示
    if (daysProcessed % 10 === 0) {
      rebuildStats();
      const totalRaces = (db.prepare('SELECT COUNT(*) as c FROM races').get() as { c: number }).c;
      const totalResults = (db.prepare('SELECT COUNT(*) as c FROM results').get() as { c: number }).c;
      const totalDates = (db.prepare('SELECT COUNT(DISTINCT race_date) as c FROM races').get() as { c: number }).c;
      console.log(`\n--- 進捗: ${totalDates}日分 / ${totalRaces}レース / ${totalResults}件の結果 ---\n`);
    }
  }

  // 最終統計構築
  rebuildStats();
  const totalRaces = (db.prepare('SELECT COUNT(*) as c FROM races').get() as { c: number }).c;
  const totalResults = (db.prepare('SELECT COUNT(*) as c FROM results').get() as { c: number }).c;
  const totalDates = (db.prepare('SELECT COUNT(DISTINCT race_date) as c FROM races').get() as { c: number }).c;

  console.log(`\n=== 収集完了 ===`);
  console.log(`${totalDates}日分 / ${totalRaces}レース / ${totalResults}件の結果`);
  console.log(`終了: ${dayjs().format('HH:mm:ss')}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
