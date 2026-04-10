import { Router, Request, Response } from 'express';
import dayjs from 'dayjs';
import db from '../db/database';
import { scrapeTodayRaces, scrapeAllOdds } from '../scraper/index';
import { predictRace, savePrediction } from '../prediction/calculator';
import { getLastUpdate, updateOddsAndPredict } from '../scheduler';
import { applyStrategies } from '../prediction/strategy';

const router = Router();

/**
 * GET /api/races?date=YYYY-MM-DD
 */
router.get('/races', (req: Request, res: Response) => {
  try {
    const date = (req.query.date as string) || dayjs().format('YYYY-MM-DD');

    const races = db.prepare(`
      SELECT r.id, r.race_date, r.venue_id, r.race_number, r.race_name, r.deadline, r.status,
             v.name as venue_name, v.short_name as venue_short_name,
             br.verdict, br.skip_reason
      FROM races r
      JOIN venues v ON v.id = r.venue_id
      LEFT JOIN buy_recommendations br ON br.race_id = r.id
      WHERE r.race_date = ?
      ORDER BY r.venue_id, r.race_number
    `).all(date) as any[];

    const formatted = races.map((race) => {
      const details = db.prepare(`
        SELECT brd.rank, brd.first_place, brd.second_place, brd.expected_value
        FROM buy_recommendation_details brd
        JOIN buy_recommendations br ON br.id = brd.recommendation_id
        WHERE br.race_id = ?
        ORDER BY brd.rank
        LIMIT 1
      `).get(race.id) as any;

      return {
        id: race.id,
        date: race.race_date,
        venueId: race.venue_id,
        venueName: race.venue_name,
        venueShortName: race.venue_short_name,
        raceNumber: race.race_number,
        raceName: race.race_name,
        deadline: race.deadline,
        status: race.status,
        verdict: race.verdict || 'pending',
        skipReason: race.skip_reason || null,
        topPick: details
          ? details.second_place > 0
            ? `${details.first_place}-${details.second_place}`
            : `${details.first_place}号艇`
          : null,
        topEv: details?.expected_value || null,
      };
    });

    res.json({ date, races: formatted });
  } catch (e: any) {
    console.error('GET /api/races error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/races/:id
 */
router.get('/races/:id', (req: Request, res: Response) => {
  try {
    const raceId = parseInt(req.params.id, 10);

    const race = db.prepare(`
      SELECT r.*, v.name as venue_name, v.short_name as venue_short_name
      FROM races r JOIN venues v ON v.id = r.venue_id
      WHERE r.id = ?
    `).get(raceId) as any;

    if (!race) {
      res.status(404).json({ error: 'Race not found' });
      return;
    }

    const entries = db.prepare(
      'SELECT * FROM race_entries WHERE race_id = ? ORDER BY boat_number'
    ).all(raceId) as any[];

    const predictions = db.prepare(
      'SELECT * FROM predictions WHERE race_id = ? ORDER BY boat_number'
    ).all(raceId) as any[];

    const recommendation = db.prepare(
      'SELECT * FROM buy_recommendations WHERE race_id = ?'
    ).get(raceId) as any;

    let details: any[] = [];
    if (recommendation) {
      details = db.prepare(
        'SELECT * FROM buy_recommendation_details WHERE recommendation_id = ? ORDER BY rank'
      ).all(recommendation.id) as any[];
    }

    const odds = db.prepare(
      'SELECT * FROM odds_exacta WHERE race_id = ? ORDER BY popularity'
    ).all(raceId) as any[];

    res.json({
      race: {
        id: race.id,
        date: race.race_date,
        venueId: race.venue_id,
        venueName: race.venue_name,
        raceNumber: race.race_number,
        raceName: race.race_name,
        deadline: race.deadline,
        status: race.status,
      },
      entries: entries.map((e: any) => ({
        boatNumber: e.boat_number,
        racerName: e.racer_name,
        racerClass: e.racer_class,
        winRateAll: e.win_rate_all,
        winRateLocal: e.win_rate_local,
        motorWinRate: e.motor_win_rate,
        exhibitionTime: e.exhibition_time,
        startTiming: e.start_timing,
      })),
      predictions: predictions.map((p: any) => ({
        boatNumber: p.boat_number,
        winProbability: p.win_probability,
        placeProbability: p.place_probability,
      })),
      verdict: recommendation?.verdict || 'pending',
      skipReason: recommendation?.skip_reason || null,
      calculatedAt: recommendation?.calculated_at || null,
      recommendations: details.map((d: any) => ({
        rank: d.rank,
        bet: `${d.first_place}-${d.second_place}`,
        firstPlace: d.first_place,
        secondPlace: d.second_place,
        probability: d.probability,
        odds: d.odds,
        ev: d.expected_value,
        reason: d.reason,
      })),
      odds: odds.map((o: any) => ({
        bet: `${o.first_place}-${o.second_place}`,
        odds: o.odds,
        popularity: o.popularity,
      })),
      strategies: applyStrategies(raceId),
    });
  } catch (e: any) {
    console.error('GET /api/races/:id error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/status - 最終更新時刻を返す
 */
router.get('/status', (_req: Request, res: Response) => {
  const last = getLastUpdate();
  res.json({
    lastOddsUpdate: last.odds ? new Date(last.odds).toISOString() : null,
    lastRaceUpdate: last.races ? new Date(last.races).toISOString() : null,
    autoRefreshInterval: '3分',
  });
});

/**
 * POST /api/refresh - 手動でオッズ再取得 + 予測更新
 */
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const result = await updateOddsAndPredict();
    res.json({
      status: 'done',
      message: `更新完了（購入推奨: ${result.buy}件 / 見送り: ${result.skip}件）`,
      ...result,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/refresh-full - フルデータ再取得（レース情報+オッズ+予測）
 */
router.post('/refresh-full', async (req: Request, res: Response) => {
  try {
    const date = (req.body.date as string) || dayjs().format('YYYY-MM-DD');

    res.json({ status: 'started', message: 'フルデータ更新を開始しました' });

    (async () => {
      try {
        await scrapeTodayRaces(date);
        await scrapeAllOdds(date);

        const races = db.prepare('SELECT id FROM races WHERE race_date = ?').all(date) as { id: number }[];
        for (const race of races) {
          const result = predictRace(race.id);
          savePrediction(result);
        }
        console.log(`[refresh] ${date} 完了`);
      } catch (e: any) {
        console.error(`[refresh] エラー:`, e.message);
      }
    })();
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/predict - 予測のみ再計算
 */
router.post('/predict', (req: Request, res: Response) => {
  try {
    const date = (req.body.date as string) || dayjs().format('YYYY-MM-DD');

    const races = db.prepare('SELECT id, venue_id, race_number FROM races WHERE race_date = ?').all(date) as any[];

    let buyCount = 0;
    let skipCount = 0;

    for (const race of races) {
      const result = predictRace(race.id);
      savePrediction(result);
      if (result.verdict === 'buy') buyCount++;
      else skipCount++;
    }

    res.json({ status: 'done', total: races.length, buy: buyCount, skip: skipCount });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/settings
 */
router.get('/settings', (_req: Request, res: Response) => {
  try {
    const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    const settings: Record<string, any> = {};
    for (const r of rows) settings[r.key] = r.value;
    res.json(settings);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * PUT /api/settings
 */
router.put('/settings', (req: Request, res: Response) => {
  try {
    const upsert = db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')
    `);
    const run = db.transaction(() => {
      for (const [key, value] of Object.entries(req.body)) {
        upsert.run(key, String(value));
      }
    });
    run();
    res.json({ status: 'ok' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 収支管理API =====

/**
 * GET /api/bet-records?month=YYYY-MM
 * 月別の収支記録一覧
 */
router.get('/bet-records', (req: Request, res: Response) => {
  try {
    const month = (req.query.month as string) || dayjs().format('YYYY-MM');
    const startDate = `${month}-01`;
    const endDate = dayjs(startDate).endOf('month').format('YYYY-MM-DD');

    const records = db.prepare(`
      SELECT * FROM bet_records
      WHERE bet_date >= ? AND bet_date <= ?
      ORDER BY bet_date DESC, venue_name, race_number
    `).all(startDate, endDate) as any[];

    // 月間サマリー
    const totalBet = records.reduce((s: number, r: any) => s + r.bet_amount, 0);
    const totalPayout = records.reduce((s: number, r: any) => s + r.payout, 0);
    const hitCount = records.filter((r: any) => r.is_hit).length;
    const totalRaces = records.length;

    // 日別サマリー
    const dailyMap = new Map<string, { bet: number; payout: number; hit: number; total: number }>();
    for (const r of records) {
      const d = r.bet_date;
      if (!dailyMap.has(d)) dailyMap.set(d, { bet: 0, payout: 0, hit: 0, total: 0 });
      const day = dailyMap.get(d)!;
      day.bet += r.bet_amount;
      day.payout += r.payout;
      if (r.is_hit) day.hit++;
      day.total++;
    }
    const daily = Array.from(dailyMap.entries()).map(([date, v]) => ({
      date, ...v, profit: v.payout - v.bet,
    })).sort((a, b) => a.date.localeCompare(b.date));

    res.json({
      month,
      summary: {
        totalBet,
        totalPayout,
        profit: totalPayout - totalBet,
        hitCount,
        totalRaces,
        hitRate: totalRaces > 0 ? (hitCount / totalRaces * 100).toFixed(1) : '0',
        returnRate: totalBet > 0 ? (totalPayout / totalBet * 100).toFixed(1) : '0',
      },
      daily,
      records: records.map((r: any) => ({
        id: r.id,
        raceId: r.race_id,
        betDate: r.bet_date,
        venueName: r.venue_name,
        raceNumber: r.race_number,
        betType: r.bet_type,
        betCombination: r.bet_combination,
        betAmount: r.bet_amount,
        isHit: !!r.is_hit,
        payout: r.payout,
        odds: r.odds,
        memo: r.memo,
        profit: r.payout - r.bet_amount,
      })),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/bet-records
 * 収支記録を追加
 */
router.post('/bet-records', (req: Request, res: Response) => {
  try {
    const { raceId, betDate, venueName, raceNumber, betType, betCombination, betAmount, isHit, payout, odds, memo } = req.body;

    const result = db.prepare(`
      INSERT INTO bet_records (race_id, bet_date, venue_name, race_number, bet_type, bet_combination, bet_amount, is_hit, payout, odds, memo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(raceId || null, betDate, venueName, raceNumber, betType || '2連単', betCombination, betAmount, isHit ? 1 : 0, payout || 0, odds || null, memo || null);

    res.json({ status: 'ok', id: result.lastInsertRowid });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * PUT /api/bet-records/:id
 * 収支記録を更新
 */
router.put('/bet-records/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { betAmount, isHit, payout, odds, memo } = req.body;

    db.prepare(`
      UPDATE bet_records SET
        bet_amount = COALESCE(?, bet_amount),
        is_hit = COALESCE(?, is_hit),
        payout = COALESCE(?, payout),
        odds = COALESCE(?, odds),
        memo = COALESCE(?, memo),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(betAmount, isHit != null ? (isHit ? 1 : 0) : null, payout, odds, memo, id);

    res.json({ status: 'ok' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * DELETE /api/bet-records/:id
 */
router.delete('/bet-records/:id', (req: Request, res: Response) => {
  try {
    db.prepare('DELETE FROM bet_records WHERE id = ?').run(parseInt(req.params.id, 10));
    res.json({ status: 'ok' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
