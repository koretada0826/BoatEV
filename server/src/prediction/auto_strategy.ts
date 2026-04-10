import db from '../db/database';

/**
 * データドリブン戦略発見エンジン（強化版）
 *
 * 過去データから自動的に回収率100%超えの条件を探し出す。
 * データが増えるほど精度が上がり、新しい戦略が見つかる。
 *
 * 【強化ポイント】
 * - 展示タイム帯の条件追加
 * - 天候・風速帯の条件追加
 * - ボート性能の条件追加
 * - 当地勝率の条件追加
 * - 2着候補の精度向上用データ
 */

interface RaceContext {
  raceId: number;
  boat1Class: string;
  boat1WinRate: number;
  boat1MotorRate: number;
  boat1LocalRate: number;
  boat1BoatRate: number;
  boat1Flying: number;
  boat1Odds: number;
  boat1ExhTime: number;
  boat1ExhRank: number; // 展示タイム6艇中の順位（1=最速）
  boat1ST: number;
  hasOtherA1: boolean;
  otherA1Count: number;
  maxOtherWinRate: number;
  winRateGap: number;
  bClassCount: number;
  boat2Class: string;
  boat3Class: string;
  windSpeed: number;
  isHeadWind: boolean;
  waveHeight: number;
  localRateGap: number; // 当地勝率 - 全国勝率
  winner: number;
  second: number; // 2着艇番
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
 * 全レースのコンテキストデータを構築（拡張版）
 */
function buildContexts(): RaceContext[] {
  const rows = db.prepare(`
    SELECT r.id as race_id,
      r.wind_speed, r.wind_direction, r.wave_height,
      (SELECT res.boat_number FROM results res WHERE res.race_id = r.id AND res.place = 1) as winner,
      (SELECT res.boat_number FROM results res WHERE res.race_id = r.id AND res.place = 2) as second
    FROM races r
    JOIN results res2 ON res2.race_id = r.id AND res2.place = 1
    JOIN win_odds wo ON wo.race_id = r.id AND wo.boat_number = 1
  `).all() as { race_id: number; winner: number; second: number; wind_speed: number | null; wind_direction: string | null; wave_height: number | null }[];

  const contexts: RaceContext[] = [];

  for (const row of rows) {
    const entries = db.prepare(
      `SELECT boat_number, racer_class, win_rate_all, win_rate_local, motor_win_rate,
              boat_win_rate, exhibition_time, start_timing, flying_count
       FROM race_entries WHERE race_id = ? ORDER BY boat_number`
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

    // 展示タイム順位を計算
    const exhTimes = entries
      .filter((e: any) => e.exhibition_time != null && e.exhibition_time > 0)
      .sort((a: any, b: any) => a.exhibition_time - b.exhibition_time);
    const boat1ExhRank = exhTimes.findIndex((e: any) => e.boat_number === 1) + 1;

    contexts.push({
      raceId: row.race_id,
      boat1Class: boat1.racer_class || '',
      boat1WinRate: boat1.win_rate_all || 0,
      boat1MotorRate: boat1.motor_win_rate || 0,
      boat1LocalRate: boat1.win_rate_local || 0,
      boat1BoatRate: boat1.boat_win_rate || 0,
      boat1Flying: boat1.flying_count || 0,
      boat1Odds: wo.odds,
      boat1ExhTime: boat1.exhibition_time || 0,
      boat1ExhRank: boat1ExhRank || 0,
      boat1ST: boat1.start_timing || 0,
      hasOtherA1: others.some((e: any) => e.racer_class === 'A1'),
      otherA1Count: others.filter((e: any) => e.racer_class === 'A1').length,
      maxOtherWinRate: maxOtherRate,
      winRateGap: (boat1.win_rate_all || 0) - maxOtherRate,
      bClassCount: others.filter((e: any) => e.racer_class === 'B1' || e.racer_class === 'B2').length,
      boat2Class: boat2?.racer_class || '',
      boat3Class: boat3?.racer_class || '',
      windSpeed: row.wind_speed || 0,
      isHeadWind: row.wind_direction ? /南/.test(row.wind_direction) : false,
      waveHeight: row.wave_height || 0,
      localRateGap: (boat1.win_rate_local || 0) - (boat1.win_rate_all || 0),
      winner: row.winner,
      second: row.second || 0,
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
 * 全戦略を自動検証してランキングする（拡張版）
 */
export function discoverStrategies(): StrategyResult[] {
  const contexts = buildContexts();
  if (contexts.length < 50) return [];

  console.log(`[戦略発見] ${contexts.length}レースのデータで検証中...`);

  const minSample = Math.max(15, Math.floor(contexts.length * 0.01));
  const results: StrategyResult[] = [];

  const addResult = (r: StrategyResult | null) => { if (r) results.push(r); };

  // === 1号艇の級別 × 他A1有無 ===
  for (const cls of ['A1', 'A2']) {
    for (const hasA1 of [true, false]) {
      const label = `1コ${cls}${hasA1 ? '' : ' 他A1なし'}`;
      const baseFilter = (c: RaceContext) => c.boat1Class === cls && c.hasOtherA1 === hasA1;

      addResult(testCondition(contexts, label, `boat1=${cls}, otherA1=${hasA1}`, baseFilter, minSample));

      // オッズ帯
      for (const [lo, hi, olabel] of [[1.0, 1.2, '1.0-1.2'], [1.2, 1.5, '1.2-1.5'], [1.5, 2.0, '1.5-2.0'], [1.3, 99, '1.3+'], [1.5, 99, '1.5+']] as [number, number, string][]) {
        addResult(testCondition(contexts, `${label} オッズ${olabel}`, `${label}, odds=${olabel}`,
          c => baseFilter(c) && c.boat1Odds >= lo && c.boat1Odds < hi, minSample));
      }

      // モーター
      for (const mMin of [30, 33, 35, 40]) {
        addResult(testCondition(contexts, `${label} モ${mMin}+`, `${label}, motor>=${mMin}`,
          c => baseFilter(c) && c.boat1MotorRate >= mMin, minSample));
      }

      // B級人数
      for (const bMin of [3, 4]) {
        addResult(testCondition(contexts, `${label} B級${bMin}人+`, `${label}, bClass>=${bMin}`,
          c => baseFilter(c) && c.bClassCount >= bMin, minSample));
      }

      // 勝率差
      for (const gap of [1.0, 1.5, 2.0]) {
        addResult(testCondition(contexts, `${label} 勝率差${gap}+`, `${label}, gap>=${gap}`,
          c => baseFilter(c) && c.winRateGap >= gap, minSample));
      }

      // === 【NEW】展示タイム条件 ===
      // 展示タイム1位（最速）
      addResult(testCondition(contexts, `${label} 展示1位`, `${label}, exhRank=1`,
        c => baseFilter(c) && c.boat1ExhRank === 1, minSample));

      // 展示タイム上位（1-2位）
      addResult(testCondition(contexts, `${label} 展示上位`, `${label}, exhRank<=2`,
        c => baseFilter(c) && c.boat1ExhRank >= 1 && c.boat1ExhRank <= 2, minSample));

      // 展示タイム下位（4-6位）→ 見送り判定用
      addResult(testCondition(contexts, `${label} 展示下位`, `${label}, exhRank>=4`,
        c => baseFilter(c) && c.boat1ExhRank >= 4, minSample));

      // === 【NEW】風速条件 ===
      // 無風〜弱風（0-2m）: インが安定
      addResult(testCondition(contexts, `${label} 弱風`, `${label}, wind<=2`,
        c => baseFilter(c) && c.windSpeed <= 2, minSample));

      // 中風（3-4m）
      addResult(testCondition(contexts, `${label} 中風`, `${label}, wind=3-4`,
        c => baseFilter(c) && c.windSpeed >= 3 && c.windSpeed <= 4, minSample));

      // 強風（5m+）
      addResult(testCondition(contexts, `${label} 強風`, `${label}, wind>=5`,
        c => baseFilter(c) && c.windSpeed >= 5, minSample));

      // 向かい風
      addResult(testCondition(contexts, `${label} 向風`, `${label}, headWind=true`,
        c => baseFilter(c) && c.isHeadWind, minSample));

      // 向かい風+強風（最悪条件）
      addResult(testCondition(contexts, `${label} 向強風`, `${label}, headWind=true, wind>=4`,
        c => baseFilter(c) && c.isHeadWind && c.windSpeed >= 4, minSample));

      // === 【NEW】波高条件 ===
      addResult(testCondition(contexts, `${label} 静水`, `${label}, wave<=3`,
        c => baseFilter(c) && c.waveHeight <= 3, minSample));

      addResult(testCondition(contexts, `${label} 高波`, `${label}, wave>=5`,
        c => baseFilter(c) && c.waveHeight >= 5, minSample));

      // === 【NEW】当地勝率条件 ===
      // 当地勝率が全国より高い（得意な水面）
      addResult(testCondition(contexts, `${label} 当地得意`, `${label}, localGap>=0.5`,
        c => baseFilter(c) && c.localRateGap >= 0.5, minSample));

      addResult(testCondition(contexts, `${label} 当地苦手`, `${label}, localGap<=-0.5`,
        c => baseFilter(c) && c.localRateGap <= -0.5, minSample));

      // === 【NEW】ボート性能条件 ===
      for (const bRate of [33, 35, 40]) {
        addResult(testCondition(contexts, `${label} ボ${bRate}+`, `${label}, boatRate>=${bRate}`,
          c => baseFilter(c) && c.boat1BoatRate >= bRate, minSample));
      }

      // === 複合条件（既存+新規） ===
      addResult(testCondition(contexts, `${label} モ33+ B級3+`, `${label}, motor>=33, bClass>=3`,
        c => baseFilter(c) && c.boat1MotorRate >= 33 && c.bClassCount >= 3, minSample));

      addResult(testCondition(contexts, `${label} モ33+ オッズ1.3+`, `${label}, motor>=33, odds>=1.3`,
        c => baseFilter(c) && c.boat1MotorRate >= 33 && c.boat1Odds >= 1.3, minSample));

      addResult(testCondition(contexts, `${label} 勝率6+ モ33+`, `${label}, winRate>=6, motor>=33`,
        c => baseFilter(c) && c.boat1WinRate >= 6 && c.boat1MotorRate >= 33, minSample));

      addResult(testCondition(contexts, `${label} F0 モ33+`, `${label}, F=0, motor>=33`,
        c => baseFilter(c) && c.boat1Flying === 0 && c.boat1MotorRate >= 33, minSample));

      // === 【NEW】展示+機力 複合 ===
      addResult(testCondition(contexts, `${label} 展示1位+モ33+`, `${label}, exhRank=1, motor>=33`,
        c => baseFilter(c) && c.boat1ExhRank === 1 && c.boat1MotorRate >= 33, minSample));

      addResult(testCondition(contexts, `${label} 展示上位+勝率7+`, `${label}, exhRank<=2, winRate>=7`,
        c => baseFilter(c) && c.boat1ExhRank >= 1 && c.boat1ExhRank <= 2 && c.boat1WinRate >= 7, minSample));

      // === 【NEW】天候+実力 複合 ===
      addResult(testCondition(contexts, `${label} 弱風+勝率7+`, `${label}, wind<=2, winRate>=7`,
        c => baseFilter(c) && c.windSpeed <= 2 && c.boat1WinRate >= 7, minSample));

      addResult(testCondition(contexts, `${label} 弱風+展示1位`, `${label}, wind<=2, exhRank=1`,
        c => baseFilter(c) && c.windSpeed <= 2 && c.boat1ExhRank === 1, minSample));

      addResult(testCondition(contexts, `${label} 静水+モ35+`, `${label}, wave<=3, motor>=35`,
        c => baseFilter(c) && c.waveHeight <= 3 && c.boat1MotorRate >= 35, minSample));

      // === 【NEW】当地得意+好機力 ===
      addResult(testCondition(contexts, `${label} 当地得意+モ33+`, `${label}, localGap>=0.5, motor>=33`,
        c => baseFilter(c) && c.localRateGap >= 0.5 && c.boat1MotorRate >= 33, minSample));

      // === 【NEW】3条件複合（最強パターン探索）===
      addResult(testCondition(contexts, `${label} 勝率7+ 展示上位 弱風`, `${label}, winRate>=7, exhRank<=2, wind<=2`,
        c => baseFilter(c) && c.boat1WinRate >= 7 && c.boat1ExhRank >= 1 && c.boat1ExhRank <= 2 && c.windSpeed <= 2, minSample));

      addResult(testCondition(contexts, `${label} 勝率7+ モ35+ F0`, `${label}, winRate>=7, motor>=35, F=0`,
        c => baseFilter(c) && c.boat1WinRate >= 7 && c.boat1MotorRate >= 35 && c.boat1Flying === 0, minSample));

      addResult(testCondition(contexts, `${label} 展示1位 モ35+ 弱風`, `${label}, exhRank=1, motor>=35, wind<=2`,
        c => baseFilter(c) && c.boat1ExhRank === 1 && c.boat1MotorRate >= 35 && c.windSpeed <= 2, minSample));

      addResult(testCondition(contexts, `${label} 当地得意 展示上位 F0`, `${label}, localGap>=0.5, exhRank<=2, F=0`,
        c => baseFilter(c) && c.localRateGap >= 0.5 && c.boat1ExhRank >= 1 && c.boat1ExhRank <= 2 && c.boat1Flying === 0, minSample));
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
  for (const r of profitable.slice(0, 20)) {
    const mark = r.returnRate >= 1.15 ? '<<<最強>>>' : r.returnRate >= 1.05 ? '★★★' : r.returnRate >= 1.0 ? '★★' : '★';
    console.log(`  ${r.name.padEnd(40)} ${r.sampleSize}件 的中${(r.hitRate * 100).toFixed(1)}% 回収${(r.returnRate * 100).toFixed(1)}% ${mark}`);
  }

  return profitable;
}

/**
 * 現在のレースに最適な戦略を返す
 */
export function getBestStrategy(raceId: number): StrategyResult | null {
  const cached = db.prepare("SELECT value FROM settings WHERE key = 'best_strategies'").get() as { value: string } | undefined;
  if (!cached) return null;

  try {
    const strategies: StrategyResult[] = JSON.parse(cached.value);
    if (strategies.length === 0) return null;

    const entries = db.prepare(
      `SELECT boat_number, racer_class, win_rate_all, win_rate_local, motor_win_rate,
              boat_win_rate, exhibition_time, flying_count FROM race_entries
       WHERE race_id = ? ORDER BY boat_number`
    ).all(raceId) as any[];

    if (entries.length < 6) return null;

    const boat1 = entries.find((e: any) => e.boat_number === 1);
    if (!boat1) return null;

    const wo = db.prepare('SELECT odds FROM win_odds WHERE race_id = ? AND boat_number = 1').get(raceId) as { odds: number } | undefined;
    const others = entries.filter((e: any) => e.boat_number !== 1);

    const raceRow = db.prepare('SELECT wind_speed, wind_direction, wave_height FROM races WHERE id = ?').get(raceId) as any;

    // 展示タイム順位
    const exhSorted = entries
      .filter((e: any) => e.exhibition_time != null && e.exhibition_time > 0)
      .sort((a: any, b: any) => a.exhibition_time - b.exhibition_time);
    const exhRank = exhSorted.findIndex((e: any) => e.boat_number === 1) + 1;

    for (const s of strategies) {
      if (s.returnRate < 1.0) continue;

      const conds = s.conditions;
      let match = true;

      // 既存条件
      if (conds.includes('boat1=A2') && boat1.racer_class !== 'A2') match = false;
      if (conds.includes('boat1=A1') && boat1.racer_class !== 'A1') match = false;
      if (conds.includes('otherA1=false') && others.some((e: any) => e.racer_class === 'A1')) match = false;
      if (conds.includes('otherA1=true') && !others.some((e: any) => e.racer_class === 'A1')) match = false;
      if (wo && conds.includes('odds>=1.5') && wo.odds < 1.5) match = false;
      if (wo && conds.includes('odds>=1.3') && wo.odds < 1.3) match = false;
      if (conds.includes('motor>=33') && (boat1.motor_win_rate || 0) < 33) match = false;
      if (conds.includes('motor>=35') && (boat1.motor_win_rate || 0) < 35) match = false;

      // 【NEW】新条件のマッチング
      if (conds.includes('exhRank=1') && exhRank !== 1) match = false;
      if (conds.includes('exhRank<=2') && (exhRank < 1 || exhRank > 2)) match = false;
      if (conds.includes('exhRank>=4') && exhRank < 4) match = false;
      if (conds.includes('wind<=2') && (raceRow?.wind_speed || 0) > 2) match = false;
      if (conds.includes('wind=3-4') && ((raceRow?.wind_speed || 0) < 3 || (raceRow?.wind_speed || 0) > 4)) match = false;
      if (conds.includes('wind>=5') && (raceRow?.wind_speed || 0) < 5) match = false;
      if (conds.includes('headWind=true') && !(raceRow?.wind_direction && /南/.test(raceRow.wind_direction))) match = false;
      if (conds.includes('wave<=3') && (raceRow?.wave_height || 0) > 3) match = false;
      if (conds.includes('wave>=5') && (raceRow?.wave_height || 0) < 5) match = false;
      if (conds.includes('localGap>=0.5') && ((boat1.win_rate_local || 0) - (boat1.win_rate_all || 0)) < 0.5) match = false;
      if (conds.includes('localGap<=-0.5') && ((boat1.win_rate_local || 0) - (boat1.win_rate_all || 0)) > -0.5) match = false;
      if (conds.includes('boatRate>=33') && (boat1.boat_win_rate || 0) < 33) match = false;
      if (conds.includes('boatRate>=35') && (boat1.boat_win_rate || 0) < 35) match = false;
      if (conds.includes('boatRate>=40') && (boat1.boat_win_rate || 0) < 40) match = false;
      if (conds.includes('winRate>=7') && (boat1.win_rate_all || 0) < 7) match = false;
      if (conds.includes('winRate>=6') && (boat1.win_rate_all || 0) < 6) match = false;
      if (conds.includes('F=0') && (boat1.flying_count || 0) !== 0) match = false;
      if (conds.includes('bClass>=3') && others.filter((e: any) => e.racer_class === 'B1' || e.racer_class === 'B2').length < 3) match = false;

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
