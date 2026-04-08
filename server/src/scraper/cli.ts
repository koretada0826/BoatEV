import dayjs from 'dayjs';
import { initializeDatabase } from '../db/database';
import { scrapeTodayRaces, scrapeAllOdds, scrapeAllResults } from './index';

// DB初期化
initializeDatabase();

const command = process.argv[2];
const dateArg = process.argv[3] || dayjs().format('YYYY-MM-DD');

async function main() {
  switch (command) {
    case 'today':
      await scrapeTodayRaces(dateArg);
      break;
    case 'odds':
      await scrapeAllOdds(dateArg);
      break;
    case 'results':
      await scrapeAllResults(dateArg);
      break;
    default:
      console.log('Usage: tsx scraper/cli.ts <today|odds|results> [YYYY-MM-DD]');
      process.exit(1);
  }
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
