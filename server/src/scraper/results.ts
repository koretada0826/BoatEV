import * as cheerio from 'cheerio';
import { fetchPage } from './http';
import db from '../db/database';

interface RaceResult {
  place: number;
  boatNumber: number;
  racerName: string;
  raceTime: string;
}

interface PayoutInfo {
  betType: string;
  combination: string;
  payout: number;
  popularity: number | null;
}

/**
 * レース結果を取得する
 */
export async function fetchRaceResult(
  date: string,
  venueId: number,
  raceNumber: number
): Promise<{ results: RaceResult[]; payouts: PayoutInfo[] }> {
  const dateStr = date.replace(/-/g, '');
  const jcd = String(venueId).padStart(2, '0');
  const rno = String(raceNumber).padStart(2, '0');

  const html = await fetchPage(
    `/owpc/pc/race/raceresult?rno=${rno}&jcd=${jcd}&hd=${dateStr}`
  );
  const $ = cheerio.load(html);

  const results: RaceResult[] = [];
  const payouts: PayoutInfo[] = [];

  // 着順テーブル: is-w495 の最初のテーブル
  // 行フォーマット: 着順 | 艇番 | 選手名+番号 | タイム
  $('table.is-w495').first().find('tbody tr').each((_, row) => {
    const tds = $(row).find('td');
    if (tds.length < 3) return;

    const placeText = tds.eq(0).text().trim()
      .replace(/１/g, '1').replace(/２/g, '2').replace(/３/g, '3')
      .replace(/４/g, '4').replace(/５/g, '5').replace(/６/g, '6');
    const place = parseInt(placeText.replace(/[^0-9]/g, ''), 10);
    if (isNaN(place) || place < 1 || place > 6) return;

    const boatNumber = parseInt(tds.eq(1).text().trim(), 10);
    if (isNaN(boatNumber) || boatNumber < 1 || boatNumber > 6) return;

    const racerName = tds.eq(2).text().trim().replace(/\d{4}\s*/, '').replace(/\s+/g, '');
    const raceTime = tds.eq(3).text().trim();

    if (!results.find(r => r.place === place)) {
      results.push({ place, boatNumber, racerName, raceTime });
    }
  });

  // 払戻テーブル
  $('td, th').each((_, el) => {
    const text = $(el).text().trim();

    // 賭け種別を検出
    let betType = '';
    if (text === '3連単' || text === '３連単') betType = 'trifecta';
    else if (text === '3連複' || text === '３連複') betType = 'trio';
    else if (text === '2連単' || text === '２連単') betType = 'exacta';
    else if (text === '2連複' || text === '２連複') betType = 'quinella';
    else if (text === '単勝') betType = 'win';
    else if (text === '複勝') betType = 'place';
    else return;

    const row = $(el).closest('tr');
    const cells = row.find('td, th');

    // 組み合わせ（2番目のセル）
    let combinationIdx = -1;
    cells.each((i, c) => {
      if ($(c).text().trim() === text) combinationIdx = i;
    });
    if (combinationIdx < 0) return;

    const combinationCell = cells.eq(combinationIdx + 1);
    const payoutCell = cells.eq(combinationIdx + 2);
    const popCell = cells.eq(combinationIdx + 3);

    const combination = combinationCell.text().trim().replace(/\s+/g, '');
    const payoutText = payoutCell.text().trim().replace(/[,，円¥\\]/g, '');
    const payout = parseInt(payoutText, 10);
    const popText = popCell.text().trim();
    const popularity = parseInt(popText, 10) || null;

    if (!isNaN(payout) && payout > 0 && combination) {
      payouts.push({ betType, combination, payout, popularity });
    }
  });

  return { results, payouts };
}

/**
 * レース結果をDBに保存する
 */
export function saveResultData(raceId: number, results: RaceResult[], payouts: PayoutInfo[]): void {
  const run = db.transaction(() => {
    db.prepare('UPDATE races SET status = ? WHERE id = ?').run('finished', raceId);

    const upsertResult = db.prepare(`
      INSERT INTO results (race_id, place, boat_number, racer_name, race_time)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(race_id, place) DO UPDATE SET
        boat_number=excluded.boat_number, racer_name=excluded.racer_name
    `);
    for (const r of results) {
      upsertResult.run(raceId, r.place, r.boatNumber, r.racerName, r.raceTime);
    }

    db.prepare('DELETE FROM payouts WHERE race_id = ?').run(raceId);
    const insertPayout = db.prepare(
      'INSERT INTO payouts (race_id, bet_type, combination, payout, popularity) VALUES (?,?,?,?,?)'
    );
    for (const p of payouts) {
      insertPayout.run(raceId, p.betType, p.combination, p.payout, p.popularity);
    }
  });
  run();
}
