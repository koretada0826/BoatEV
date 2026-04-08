import db from '../db/database';

/**
 * データドリブン戦略発見エンジン
 *
 * 過去データから自動的に回収率100%超えの条件を探し出す。
 * データが増えるほど精度が上がり、新しい戦略が見つかる。
 */

interface RaceContext {
  raceId: number;
  boat1Class: string;
  boat1WinRate: number;
  boat1MotorRate: number;
  boat1LocalRate: number;
  boat1Flying: number;
  boat1Odds: number;
  hasOtherA1: boolean;
  otherA1Count: number;
  maxOtherWinRate: number;
  winRateGap: number; // 1号艇と2位の勝率差
  bClassCount: number; // B級の人数
  boat2Class: string;
  boat3Class: string;
  winner: number;
}

interface StrategyResult {
  name: string;
  conditions: string;
  sampleSize: number;
  hitRate: number;
  returnRate: number;
  avgOdds: number;
}

/**
 * 全レースのコンテキストデータを構築
 */
function buildContexts(): RaceContext[] {
  const rows = db.prepare(`
    SELECT r.id as race_id,
      (SELECT res.boat_number FROM results res WHERE res.race_id = r.id AND res.place = 1) as winner
    FROM races r
    JOIN results res2 ON res2.race_id = r.id AND res2.place = 1
    JOIN win_odds wo ON wo.race_id = r.id AND wo.boat_number = 1
  `).all() as { race_id: number; winner: number }[];

  const contexts: RaceContext[] = [];

  for (const row of rows) {
    const entries = db.prepare(
      'SELECT boat_number, racer_class, win_rate_all, win_rate_local, motor_win_rate, flying_count FROM race_entries WHERE race_id = ? ORDER BY boat_number'
    ).all(row.race_id) as any[];

    if (entries.length < 6) continue;

    const boat1 = entries.find((e: any) => e.boat_number === 1);
    const boat2 = entries.find((e: any) => e.boat_number === 2);
    const boat3 = entries.find((e: any) => e.boat_number === 3);
    if (!boat1) continue;

    const wo = db.prepare('SELECT odds FROM win_odds WHERE race_id = ? AND boat_number = 1').get(row.race_id) as { odds: number } | undefined;
    if (!wo || wo.odds <= 0) continue;

    const others = entries.filter((e: any) => e.boat_number !== 1);
    const otherWinRates = others.map((e: any) => e.win_rate_all || 0);
    const maxOtherRate = Math.max(...otherWinRates);

    contexts.push({
      raceId: row.race_id,
      boat1Class: boat1.racer_class || '',
      boat1WinRate: boat1.win_rate_all || 0,
      boat1MotorRate: boat1.motor_win_rate || 0,
      boat1LocalRate: boat1.win_rate_local || 0,
      boat1Flying: boat1.flying_count || 0,
      boat1Odds: wo.odds,
      hasOtherA1: others.some((e: any) => e.racer_class === 'A1'),
      otherA1Count: others.filter((e: any) => e.racer_class === 'A1').length,
      maxOtherWinRate: maxOtherRate,
      winRateGap: (boat1.win_rate_all || 0) - maxOtherRate,
      bClassCount: others.filter((e: any) => e.racer_class === 'B1' || e.racer_class === 'B2').length,
      boat2Class: boat2?.racer_class || '',
      boat3Class: boat3?.racer_class || '',
      winner: row.winner,
    });
  }

  return contexts;
}

/**
 * 条件をテストする
 */
function testCondition(
  contexts: RaceContext[],
  name: string,
  conditions: string,
  filter: (c: RaceContext) => boolean,
  minSample: number = 20
): StrategyResult | null {
  const matched = contexts.filter(filter);
  if (matched.length < minSample) return null;

  let wins = 0;
  let totalReturn = 0;
  let totalOdds = 0;

  for (const c of matched) {
    totalOdds += c.boat1Odds;
    if (c.winner === 1) {
      wins++;
      totalReturn += c.boat1Odds * 100;
    }
  }

  return {
    name,
    conditions,
    sampleSize: matched.length,
    hitRate: wins / matched.length,
    returnRate: totalReturn / (matched.length * 100),
    avgOdds: totalOdds / matched.length,
  };
}

/**
 * 全戦略を自動検証してランキングする
 */
export function discoverStrategies(): StrategyResult[] {
  const contexts = buildContexts();
  if (contexts.length < 50) return [];

  console.log(`[戦略発見] ${contexts.length}レースのデータで検証中...`);

  const minSample = Math.max(15, Math.floor(contexts.length * 0.01)); // 最低1%以上のサンプル
  const results: StrategyResult[] = [];

  const addResult = (r: StrategyResult | null) => { if (r) results.push(r); };

  // === 1号艇の級別 × 他A1有無 ===
  for (const cls of ['A1', 'A2']) {
    for (const hasA1 of [true, false]) {
      const label = `1コ${cls}${hasA1 ? '' : ' 他A1なし'}`;
      addResult(testCondition(contexts, label, `boat1=${cls}, otherA1=${hasA1}`,
        c => c.boat1Class === cls && c.hasOtherA1 === hasA1, minSample));

      // オッズ帯
      for (const [lo, hi, olabel] of [[1.0, 1.2, '1.0-1.2'], [1.2, 1.5, '1.2-1.5'], [1.5, 2.0, '1.5-2.0'], [1.3, 99, '1.3+'], [1.5, 99, '1.5+']] as [number, number, string][]) {
        addResult(testCondition(contexts, `${label} オッズ${olabel}`, `${label}, odds=${olabel}`,
          c => c.boat1Class === cls && c.hasOtherA1 === hasA1 && c.boat1Odds >= lo && c.boat1Odds < hi, minSample));
      }

      // モーター
      for (const mMin of [30, 33, 35, 40]) {
        addResult(testCondition(contexts, `${label} モ${mMin}+`, `${label}, motor>=${mMin}`,
          c => c.boat1Class === cls && c.hasOtherA1 === hasA1 && c.boat1MotorRate >= mMin, minSample));
      }

      // B級人数
      for (const bMin of [3, 4]) {
        addResult(testCondition(contexts, `${label} B級${bMin}人+`, `${label}, bClass>=${bMin}`,
          c => c.boat1Class === cls && c.hasOtherA1 === hasA1 && c.bClassCount >= bMin, minSample));
      }

      // 勝率差
      for (const gap of [1.0, 1.5, 2.0]) {
        addResult(testCondition(contexts, `${label} 勝率差${gap}+`, `${label}, gap>=${gap}`,
          c => c.boat1Class === cls && c.hasOtherA1 === hasA1 && c.winRateGap >= gap, minSample));
      }

      // 複合条件
      addResult(testCondition(contexts, `${label} モ33+ B級3+`, `${label}, motor>=33, bClass>=3`,
        c => c.boat1Class === cls && c.hasOtherA1 === hasA1 && c.boat1MotorRate >= 33 && c.bClassCount >= 3, minSample));

      addResult(testCondition(contexts, `${label} モ33+ オッズ1.3+`, `${label}, motor>=33, odds>=1.3`,
        c => c.boat1Class === cls && c.hasOtherA1 === hasA1 && c.boat1MotorRate >= 33 && c.boat1Odds >= 1.3, minSample));

      addResult(testCondition(contexts, `${label} 勝率6+ モ33+`, `${label}, winRate>=6, motor>=33`,
        c => c.boat1Class === cls && c.hasOtherA1 === hasA1 && c.boat1WinRate >= 6 && c.boat1MotorRate >= 33, minSample));

      addResult(testCondition(contexts, `${label} F0 モ33+`, `${label}, F=0, motor>=33`,
        c => c.boat1Class === cls && c.hasOtherA1 === hasA1 && c.boat1Flying === 0 && c.boat1MotorRate >= 33, minSample));
    }
  }

  // B1の条件
  addResult(testCondition(contexts, '1コB1 他A級なし', 'boat1=B1, noA',
    c => c.boat1Class === 'B1' && !c.hasOtherA1 && c.otherA1Count === 0 &&
      !['A1', 'A2'].includes(c.boat2Class) && !['A1', 'A2'].includes(c.boat3Class), minSample));

  // 回収率でソートしてトップを返す
  const profitable = results
    .filter(r => r.returnRate >= 0.95)
    .sort((a, b) => b.returnRate - a.returnRate);

  // ログ出力
  console.log(`\n[戦略発見] 回収率95%以上: ${profitable.length}件`);
  for (const r of profitable.slice(0, 15)) {
    const mark = r.returnRate >= 1.15 ? '<<<最強>>>' : r.returnRate >= 1.05 ? '★★★' : r.returnRate >= 1.0 ? '★★' : '★';
    console.log(`  ${r.name.padEnd(35)} ${r.sampleSize}件 的中${(r.hitRate * 100).toFixed(1)}% 回収${(r.returnRate * 100).toFixed(1)}% ${mark}`);
  }

  return profitable;
}

/**
 * 現在のレースに最適な戦略を返す
 */
export function getBestStrategy(raceId: number): StrategyResult | null {
  // キャッシュされた戦略結果を使う（settingsテーブルに保存）
  const cached = db.prepare("SELECT value FROM settings WHERE key = 'best_strategies'").get() as { value: string } | undefined;
  if (!cached) return null;

  try {
    const strategies: StrategyResult[] = JSON.parse(cached.value);
    if (strategies.length === 0) return null;

    // このレースに該当する最も回収率が高い戦略を返す
    const entries = db.prepare(
      'SELECT boat_number, racer_class, win_rate_all, motor_win_rate, flying_count FROM race_entries WHERE race_id = ? ORDER BY boat_number'
    ).all(raceId) as any[];

    if (entries.length < 6) return null;

    const boat1 = entries.find((e: any) => e.boat_number === 1);
    if (!boat1) return null;

    const wo = db.prepare('SELECT odds FROM win_odds WHERE race_id = ? AND boat_number = 1').get(raceId) as { odds: number } | undefined;
    const others = entries.filter((e: any) => e.boat_number !== 1);

    // 簡易マッチング
    for (const s of strategies) {
      if (s.returnRate < 1.0) continue; // 回収率100%未満はスキップ

      const conds = s.conditions;
      let match = true;

      if (conds.includes('boat1=A2') && boat1.racer_class !== 'A2') match = false;
      if (conds.includes('boat1=A1') && boat1.racer_class !== 'A1') match = false;
      if (conds.includes('otherA1=false') && others.some((e: any) => e.racer_class === 'A1')) match = false;
      if (conds.includes('otherA1=true') && !others.some((e: any) => e.racer_class === 'A1')) match = false;
      if (wo && conds.includes('odds>=1.5') && wo.odds < 1.5) match = false;
      if (wo && conds.includes('odds>=1.3') && wo.odds < 1.3) match = false;
      if (conds.includes('motor>=33') && (boat1.motor_win_rate || 0) < 33) match = false;
      if (conds.includes('motor>=35') && (boat1.motor_win_rate || 0) < 35) match = false;

      if (match) return s;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * 戦略をDBに保存する（定期的に呼ぶ）
 */
export function saveDiscoveredStrategies(): void {
  const strategies = discoverStrategies();
  const profitable = strategies.filter(s => s.returnRate >= 1.0);

  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES ('best_strategies', ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')
  `).run(JSON.stringify(profitable));

  console.log(`[戦略発見] ${profitable.length}件の戦略を保存`);
}
