import dayjs from 'dayjs';
import { initializeDatabase } from '../db/database';
import db from '../db/database';
import { fetchTodayVenues, fetchRaceCard, fetchExhibitionData, saveRaceData } from './races';
import { fetchExactaOdds, saveOddsData } from './odds';
import { fetchWinOdds, saveWinOdds } from './win_odds';
import { fetchRaceResult, saveResultData } from './results';
import { saveDiscoveredStrategies } from '../prediction/auto_strategy';

initializeDatabase();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 1レース分を取得（エラーは全て握りつぶして続行）
 */
async function scrapeRace(date: string, venueId: number, rno: number): Promise<boolean> {
  try {
    const { race, entries } = await fetchRaceCard(date, venueId, rno);
    if (entries.length < 6) return false;

    let exhibition: any = new Map();
    if (date >= '2023-01-01') {
      try { exhibition = await fetchExhibitionData(date, venueId, rno); } catch {}
    }

    const raceId = saveRaceData(race, entries, exhibition);
    await sleep(150);

    // オッズ+結果を並列
    try {
      const [exacta, wins, res] = await Promise.all([
        fetchExactaOdds(date, venueId, rno).catch(() => []),
        fetchWinOdds(date, venueId, rno).catch(() => new Map<number, number>()),
        fetchRaceResult(date, venueId, rno).catch(() => ({ results: [] as any[], payouts: [] as any[] })),
      ]);
      if ((exacta as any[]).length > 0) saveOddsData(raceId, exacta as any);
      if ((wins as Map<number, number>).size > 0) saveWinOdds(raceId, wins as any);
      if (res.results.length > 0) saveResultData(raceId, res.results, res.payouts);
    } catch {}

    await sleep(150);
    return true;
  } catch {
    return false;
  }
}

/**
 * 1日分を取得
 */
async function scrapeDay(date: string): Promise<number> {
  try {
    const existing = (db.prepare('SELECT COUNT(*) as c FROM races WHERE race_date = ?').get(date) as { c: number }).c;
    if (existing > 50) return -1;

    const venueIds = await fetchTodayVenues(date);
    if (venueIds.length === 0) return -1;

    let total = 0;
    for (const vid of venueIds) {
      for (let rno = 1; rno <= 12; rno++) {
        const ok = await scrapeRace(date, vid, rno);
        if (ok) total++;
      }
    }
    return total;
  } catch (e: any) {
    console.error(`  ${date} エラー: ${e.message}`);
    return 0;
  }
}

async function main() {
  const startDate = process.argv[2] || '2018-01-01';
  const endDate = process.argv[3] || dayjs().format('YYYY-MM-DD');

  // 歯抜け日リスト
  const gaps: string[] = [];
  for (let d = dayjs(startDate); d.isBefore(dayjs(endDate)) || d.isSame(dayjs(endDate)); d = d.add(1, 'day')) {
    const ds = d.format('YYYY-MM-DD');
    const c = (db.prepare('SELECT COUNT(*) as c FROM races WHERE race_date = ?').get(ds) as { c: number }).c;
    if (c === 0) gaps.push(ds);
  }

  const totalBefore = (db.prepare('SELECT COUNT(*) as c FROM races').get() as { c: number }).c;
  const daysBefore = (db.prepare('SELECT COUNT(DISTINCT race_date) as c FROM races').get() as { c: number }).c;

  console.log(`=== ターボ収集: ${startDate} 〜 ${endDate} ===`);
  console.log(`現在: ${daysBefore}日分 / ${totalBefore}レース`);
  console.log(`不足: ${gaps.length}日分`);
  console.log('');

  let collected = 0;
  let daysOk = 0;
  const t0 = Date.now();

  for (let i = 0; i < gaps.length; i++) {
    const date = gaps[i];
    const count = await scrapeDay(date);

    if (count > 0) {
      collected += count;
      daysOk++;
    }

    // 10日ごとに進捗
    if ((i + 1) % 10 === 0) {
      const sec = (Date.now() - t0) / 1000;
      const rate = daysOk > 0 ? sec / daysOk : 0;
      const left = (gaps.length - i - 1) * rate / 60;
      console.log(`[${i + 1}/${gaps.length}] ${date} | +${collected}レース | ${daysOk + daysBefore}日分 | ${rate.toFixed(0)}秒/日 | 残${left.toFixed(0)}分`);
    }

    // 100日ごとに戦略再発見
    if (daysOk > 0 && daysOk % 100 === 0) {
      console.log('--- 戦略再発見 ---');
      try { saveDiscoveredStrategies(); } catch {}
    }
  }

  const totalAfter = (db.prepare('SELECT COUNT(*) as c FROM races').get() as { c: number }).c;
  const daysAfter = (db.prepare('SELECT COUNT(DISTINCT race_date) as c FROM races').get() as { c: number }).c;
  const min = ((Date.now() - t0) / 60000).toFixed(1);

  console.log(`\n=== 完了 (${min}分) ===`);
  console.log(`${daysBefore}日→${daysAfter}日 / ${totalBefore}→${totalAfter}レース (+${totalAfter - totalBefore})`);

  if (collected > 0) {
    console.log('--- 最終戦略発見 ---');
    try { saveDiscoveredStrategies(); } catch {}
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
