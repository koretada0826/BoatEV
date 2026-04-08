import dayjs from 'dayjs';
import { initializeDatabase } from '../db/database';
import db from '../db/database';
import { fetchTodayVenues, fetchRaceCard, saveRaceData } from './races';
import { fetchExactaOdds, saveOddsData } from './odds';
import { fetchWinOdds, saveWinOdds } from './win_odds';
import { fetchRaceResult, saveResultData } from './results';

initializeDatabase();

const DELAY_MS = 1200;
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 指定日数分の過去データを一括取得する
 */
async function batchScrape(daysBack: number) {
  const today = dayjs();

  for (let d = daysBack; d >= 1; d--) {
    const date = today.subtract(d, 'day').format('YYYY-MM-DD');
    const dateStr = date.replace(/-/g, '');

    // 既にデータがあるかチェック
    const existing = db.prepare(
      'SELECT COUNT(*) as c FROM races WHERE race_date = ?'
    ).get(date) as { c: number };

    if (existing.c > 50) {
      console.log(`${date}: 既に${existing.c}件あり、スキップ`);
      continue;
    }

    console.log(`\n========== ${date} ==========`);

    try {
      // 開催場取得
      const venueIds = await fetchTodayVenues(date);
      if (venueIds.length === 0) {
        console.log('  開催なし');
        continue;
      }
      console.log(`  開催場: ${venueIds.length}場`);

      for (const venueId of venueIds) {
        for (let rno = 1; rno <= 12; rno++) {
          try {
            // 出走表
            const { race, entries } = await fetchRaceCard(date, venueId, rno);
            if (entries.length < 6) continue;

            const emptyMap = new Map<number, { exhibitionTime: number | null; startTiming: number | null }>();
            const raceId = saveRaceData(race, entries, emptyMap);
            await sleep(DELAY_MS);

            // 2連単オッズ
            const exactaOdds = await fetchExactaOdds(date, venueId, rno);
            if (exactaOdds.length > 0) saveOddsData(raceId, exactaOdds);
            await sleep(DELAY_MS);

            // 単勝オッズ
            const winOddsMap = await fetchWinOdds(date, venueId, rno);
            if (winOddsMap.size > 0) saveWinOdds(raceId, winOddsMap);
            await sleep(DELAY_MS);

            // 結果
            const { results, payouts } = await fetchRaceResult(date, venueId, rno);
            if (results.length > 0) saveResultData(raceId, results, payouts);
            await sleep(DELAY_MS);

            process.stdout.write('.');
          } catch (e: any) {
            process.stdout.write('x');
          }
        }
      }

      const count = db.prepare('SELECT COUNT(*) as c FROM races WHERE race_date = ?').get(date) as { c: number };
      console.log(`\n  -> ${count.c}レース保存`);
    } catch (e: any) {
      console.error(`  エラー:`, e.message);
    }
  }

  // 統計を計算
  console.log('\n========== 統計計算 ==========');
  buildCourseStats();

  const totalRaces = (db.prepare('SELECT COUNT(*) as c FROM races').get() as { c: number }).c;
  const totalResults = (db.prepare('SELECT COUNT(*) as c FROM results').get() as { c: number }).c;
  console.log(`合計: ${totalRaces}レース, ${totalResults}件の結果`);
}

/**
 * 過去データからコース×級別の統計を構築する
 */
function buildCourseStats() {
  // 結果とエントリーを結合して集計
  const stats = db.prepare(`
    SELECT
      re.boat_number,
      re.racer_class,
      COUNT(*) as total_races,
      SUM(CASE WHEN r.place = 1 THEN 1 ELSE 0 END) as win_count,
      SUM(CASE WHEN r.place <= 2 THEN 1 ELSE 0 END) as place2_count
    FROM race_entries re
    JOIN results r ON r.race_id = re.race_id AND r.boat_number = re.boat_number
    WHERE re.racer_class IN ('A1','A2','B1','B2')
    GROUP BY re.boat_number, re.racer_class
  `).all() as {
    boat_number: number;
    racer_class: string;
    total_races: number;
    win_count: number;
    place2_count: number;
  }[];

  const upsert = db.prepare(`
    INSERT INTO course_stats (boat_number, racer_class, total_races, win_count, place2_count, win_rate, place2_rate)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(boat_number, racer_class)
    DO UPDATE SET total_races=excluded.total_races, win_count=excluded.win_count,
                  place2_count=excluded.place2_count, win_rate=excluded.win_rate,
                  place2_rate=excluded.place2_rate, updated_at=datetime('now')
  `);

  const run = db.transaction(() => {
    for (const s of stats) {
      const winRate = s.total_races > 0 ? s.win_count / s.total_races : 0;
      const place2Rate = s.total_races > 0 ? s.place2_count / s.total_races : 0;
      upsert.run(s.boat_number, s.racer_class, s.total_races, s.win_count, s.place2_count, winRate, place2Rate);
      console.log(`  ${s.boat_number}コース ${s.racer_class}: 1着率=${(winRate * 100).toFixed(1)}% 2連率=${(place2Rate * 100).toFixed(1)}% (${s.total_races}レース)`);
    }
  });
  run();
}

// CLI
const days = parseInt(process.argv[2] || '7', 10);
console.log(`=== 過去${days}日分のデータを一括取得 ===`);
batchScrape(days).catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
