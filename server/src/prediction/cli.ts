import dayjs from 'dayjs';
import { initializeDatabase } from '../db/database';
import db from '../db/database';
import { predictRace, savePrediction } from './calculator';

initializeDatabase();

const dateArg = process.argv[2] || dayjs().format('YYYY-MM-DD');

function main() {
  console.log(`=== ${dateArg} の予測計算開始 ===`);

  const races = db.prepare(
    'SELECT id, venue_id, race_number FROM races WHERE race_date = ? ORDER BY venue_id, race_number'
  ).all(dateArg) as { id: number; venue_id: number; race_number: number }[];

  if (races.length === 0) {
    console.log('対象レースなし');
    return;
  }

  let buyCount = 0;
  let skipCount = 0;

  for (const race of races) {
    const result = predictRace(race.id);
    savePrediction(result);

    if (result.verdict === 'buy') {
      buyCount++;
      console.log(`  場${race.venue_id} R${race.race_number}: ★購入推奨`);
      for (const rec of result.recommendations) {
        console.log(`    ${rec.label} | 的中${rec.historicalHitRate} 回収${rec.historicalReturnRate} オッズ${rec.odds}`);
      }
    } else {
      skipCount++;
    }
  }

  console.log(`\n=== 計算完了 ===`);
  console.log(`購入推奨: ${buyCount}件 / 見送り: ${skipCount}件 / 全${races.length}件`);
}

main();
