import * as cheerio from 'cheerio';
import { fetchPage } from './http';
import db from '../db/database';

/**
 * 単勝オッズを取得する
 */
export async function fetchWinOdds(
  date: string,
  venueId: number,
  raceNumber: number
): Promise<Map<number, number>> {
  const dateStr = date.replace(/-/g, '');
  const jcd = String(venueId).padStart(2, '0');
  const rno = String(raceNumber).padStart(2, '0');

  const html = await fetchPage(
    `/owpc/pc/race/oddstf?rno=${rno}&jcd=${jcd}&hd=${dateStr}`
  );
  const $ = cheerio.load(html);

  const result = new Map<number, number>();
  const cells = $('td.oddsPoint');

  // 先頭6つが単勝オッズ（1号艇〜6号艇）
  for (let i = 0; i < Math.min(6, cells.length); i++) {
    const text = $(cells[i]).text().trim();
    const odds = parseFloat(text);
    if (!isNaN(odds) && odds > 0) {
      result.set(i + 1, odds);
    }
  }

  return result;
}

/**
 * 単勝オッズをDBに保存する
 */
export function saveWinOdds(raceId: number, winOdds: Map<number, number>): void {
  const upsert = db.prepare(`
    INSERT INTO win_odds (race_id, boat_number, odds, fetched_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(race_id, boat_number)
    DO UPDATE SET odds=excluded.odds, fetched_at=datetime('now')
  `);

  const run = db.transaction(() => {
    for (const [boat, odds] of winOdds) {
      upsert.run(raceId, boat, odds);
    }
  });
  run();
}
