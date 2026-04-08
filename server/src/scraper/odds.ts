import * as cheerio from 'cheerio';
import { fetchPage } from './http';
import db from '../db/database';

interface ExactaOdds {
  firstPlace: number;
  secondPlace: number;
  odds: number;
}

/**
 * 2連単オッズを取得する
 */
export async function fetchExactaOdds(
  date: string,
  venueId: number,
  raceNumber: number
): Promise<ExactaOdds[]> {
  const dateStr = date.replace(/-/g, '');
  const jcd = String(venueId).padStart(2, '0');
  const rno = String(raceNumber).padStart(2, '0');

  // odds2tf = 2連単・2連複オッズページ
  const html = await fetchPage(
    `/owpc/pc/race/odds2tf?rno=${rno}&jcd=${jcd}&hd=${dateStr}`
  );
  const $ = cheerio.load(html);

  const oddsList: ExactaOdds[] = [];

  // td.oddsPoint からオッズ値を取得
  // 先頭30個が2連単（6艇×5=30通り）、残り15個が2連複
  const cells = $('td.oddsPoint');

  let idx = 0;
  for (let first = 1; first <= 6; first++) {
    for (let second = 1; second <= 6; second++) {
      if (first === second) continue;
      if (idx < cells.length && idx < 30) {
        const text = $(cells[idx]).text().trim();
        const oddsValue = parseFloat(text);
        if (!isNaN(oddsValue) && oddsValue > 0) {
          oddsList.push({ firstPlace: first, secondPlace: second, odds: oddsValue });
        }
      }
      idx++;
    }
  }

  return oddsList;
}

/**
 * オッズデータをDBに保存する
 */
export function saveOddsData(raceId: number, oddsList: ExactaOdds[]): void {
  const deleteOdds = db.prepare('DELETE FROM odds_exacta WHERE race_id = ?');
  const insertOdds = db.prepare(`
    INSERT INTO odds_exacta (race_id, first_place, second_place, odds, popularity, fetched_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `);

  const sorted = [...oddsList].sort((a, b) => a.odds - b.odds);

  const run = db.transaction(() => {
    deleteOdds.run(raceId);
    sorted.forEach((o, i) => {
      insertOdds.run(raceId, o.firstPlace, o.secondPlace, o.odds, i + 1);
    });
  });
  run();
}
