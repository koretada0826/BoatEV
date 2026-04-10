import db from '../db/database';
import { applyStrategies, StrategyBet } from './strategy';

export interface RacePredictionResult {
  raceId: number;
  verdict: 'buy' | 'skip';
  skipReason: string | null;
  boatPredictions: BoatPrediction[];
  recommendations: StrategyBet[];
}

interface BoatPrediction {
  boatNumber: number;
  winProbability: number;
  placeProbability: number;
  score: number;
}

interface EntryData {
  boat_number: number;
  racer_name: string;
  racer_class: string;
  win_rate_all: number | null;
  win_rate_local: number | null;
  motor_win_rate: number | null;
  boat_win_rate: number | null;
  exhibition_time: number | null;
  start_timing: number | null;
  weight: number | null;
  flying_count: number;
  late_count: number;
}

interface RaceWeather {
  wind_direction: string | null;
  wind_speed: number | null;
  wave_height: number | null;
}

const DEFAULT_WIN_RATE: Record<number, number> = {
  1: 0.545, 2: 0.145, 3: 0.120, 4: 0.105, 5: 0.055, 6: 0.030,
};
const CLASS_MULT: Record<string, number> = { A1: 1.08, A2: 1.02, B1: 0.94, B2: 0.82 };

/**
 * 風向きと枠番から有利/不利の補正を返す
 * 追い風 → イン有利（1-3コース）
 * 向かい風 → アウト有利（4-6コース）、特にまくり/差し
 */
function getWindAdjustment(boatNumber: number, windDirection: string | null, windSpeed: number | null): number {
  if (!windDirection || windSpeed == null || windSpeed === 0) return 0;

  // 追い風判定: 「北」「北東」「北西」（スタンド側からの風）
  // 向かい風判定: 「南」「南東」「南西」（バック側からの風）
  // ※一般的にボートレースでは「ホーム→バック」方向がスタート方向
  const isChase = ['追', '追い風'].includes(windDirection) ||
    /北/.test(windDirection);  // 場によるが一般化
  const isHead = ['向', '向かい風'].includes(windDirection) ||
    /南/.test(windDirection);

  const strength = Math.min(windSpeed, 8); // 8m以上は飽和

  if (isChase) {
    // 追い風: インが有利（スロー勢がスタート決まりやすい）
    if (strength >= 5) {
      // 強い追い風: イン圧倒的有利
      const innerBonus = [0.08, 0.04, 0.02, -0.02, -0.04, -0.06];
      return innerBonus[boatNumber - 1] || 0;
    } else if (strength >= 3) {
      const innerBonus = [0.04, 0.02, 0.01, -0.01, -0.02, -0.03];
      return innerBonus[boatNumber - 1] || 0;
    }
    const innerBonus = [0.02, 0.01, 0, 0, -0.01, -0.01];
    return innerBonus[boatNumber - 1] || 0;
  }

  if (isHead) {
    // 向かい風: アウトが有利（まくり・差しが決まりやすい）
    if (strength >= 5) {
      const outerBonus = [-0.06, -0.02, 0.01, 0.03, 0.04, 0.05];
      return outerBonus[boatNumber - 1] || 0;
    } else if (strength >= 3) {
      const outerBonus = [-0.03, -0.01, 0, 0.01, 0.02, 0.03];
      return outerBonus[boatNumber - 1] || 0;
    }
    const outerBonus = [-0.01, 0, 0, 0, 0.01, 0.01];
    return outerBonus[boatNumber - 1] || 0;
  }

  return 0;
}

/**
 * 波高による補正
 * 高波 → 技術力が重要（A1有利、内が不安定になる）
 */
function getWaveAdjustment(boatNumber: number, racerClass: string, waveHeight: number | null): number {
  if (waveHeight == null || waveHeight <= 3) return 0;

  // 高波はインの安定性を下げ、技術力が高い選手を有利にする
  const classBonus: Record<string, number> = { A1: 0.03, A2: 0.01, B1: -0.01, B2: -0.03 };
  let adj = classBonus[racerClass] || 0;

  // 高波でインがやや不利
  if (waveHeight >= 5) {
    const posAdj = [-.03, -.01, 0, 0.01, 0.01, 0.01];
    adj += posAdj[boatNumber - 1] || 0;
  }

  return adj;
}

function calculateProbabilities(entries: EntryData[], weather: RaceWeather | null): BoatPrediction[] {
  if (entries.length < 6) return [];

  // 全艇の展示タイム平均を計算（相対評価用）
  const exhTimes = entries.map(e => e.exhibition_time).filter((t): t is number => t != null && t > 0);
  const avgExhTime = exhTimes.length > 0 ? exhTimes.reduce((a, b) => a + b, 0) / exhTimes.length : 6.80;

  // 全艇のSTタイミング平均
  const stTimings = entries.map(e => e.start_timing).filter((t): t is number => t != null);
  const avgST = stTimings.length > 0 ? stTimings.reduce((a, b) => a + b, 0) / stTimings.length : 0.15;

  const scores = entries.map((e) => {
    const stat = db.prepare('SELECT win_rate FROM course_stats WHERE boat_number = ? AND racer_class = ?')
      .get(e.boat_number, e.racer_class || 'B1') as { win_rate: number } | undefined;
    let score = stat?.win_rate ?? (DEFAULT_WIN_RATE[e.boat_number] || 0.05);

    // === 1. 選手クラス ===
    score *= CLASS_MULT[e.racer_class] || 1.0;

    // === 2. 全国勝率（既存） ===
    if (e.win_rate_all != null) {
      score *= (1 + Math.max(-0.10, Math.min(0.10, (e.win_rate_all - 5.0) * 0.02)));
    }

    // === 3. 当地勝率【NEW】===
    // 全国勝率との差がプラスなら当地に合っている
    if (e.win_rate_local != null && e.win_rate_all != null) {
      const localDiff = e.win_rate_local - e.win_rate_all;
      // 当地が全国より高い → その会場に合っている
      score *= (1 + Math.max(-0.05, Math.min(0.05, localDiff * 0.015)));
    } else if (e.win_rate_local != null) {
      score *= (1 + Math.max(-0.05, Math.min(0.05, (e.win_rate_local - 5.0) * 0.01)));
    }

    // === 4. モーター性能（既存・調整） ===
    if (e.motor_win_rate != null) {
      score *= (1 + Math.max(-0.06, Math.min(0.06, (e.motor_win_rate - 33.0) * 0.004)));
    }

    // === 5. ボート性能【NEW】===
    if (e.boat_win_rate != null) {
      score *= (1 + Math.max(-0.04, Math.min(0.04, (e.boat_win_rate - 33.0) * 0.003)));
    }

    // === 6. 展示タイム【NEW】===
    // 展示タイムは小さいほど良い（6.7秒 > 6.9秒）
    if (e.exhibition_time != null && e.exhibition_time > 0) {
      const diff = avgExhTime - e.exhibition_time; // プラスなら平均より速い
      score *= (1 + Math.max(-0.06, Math.min(0.06, diff * 0.8)));
    }

    // === 7. 展示STタイミング【NEW】===
    // STが小さいほどスタートが速い（0.10 > 0.20）
    if (e.start_timing != null) {
      const stDiff = avgST - e.start_timing; // プラスなら平均より速い
      score *= (1 + Math.max(-0.05, Math.min(0.05, stDiff * 3.0)));
    }

    // === 8. 事故歴ペナルティ（強化） ===
    if (e.flying_count > 0) score *= 0.92; // 0.95 → 0.92に強化
    if (e.late_count > 0) score *= 0.96;   // 遅刻歴も考慮【NEW】

    // === 9. 体重【NEW】===
    // 軽い選手はわずかに有利（標準52kg基準）
    if (e.weight != null && e.weight > 0) {
      const weightDiff = 52.0 - e.weight;
      score *= (1 + Math.max(-0.02, Math.min(0.02, weightDiff * 0.003)));
    }

    // === 10. 天候・風速補正【NEW】===
    if (weather) {
      score *= (1 + getWindAdjustment(e.boat_number, weather.wind_direction, weather.wind_speed));
      score *= (1 + getWaveAdjustment(e.boat_number, e.racer_class, weather.wave_height));
    }

    return { boatNumber: e.boat_number, score: Math.max(score, 0.003) };
  });

  const total = scores.reduce((s, x) => s + x.score, 0);
  const preds: BoatPrediction[] = scores.map(s => ({
    boatNumber: s.boatNumber,
    winProbability: s.score / total,
    placeProbability: 0,
    score: s.score,
  }));

  // 2着確率の計算（条件付き確率）
  for (const p of preds) {
    let pp = 0;
    for (const o of preds) {
      if (o.boatNumber === p.boatNumber) continue;
      pp += o.winProbability * (p.score / (total - o.score));
    }
    p.placeProbability = pp;
  }
  return preds;
}

/**
 * メイン予測: 実績戦略に合致するかどうかで判定
 */
export function predictRace(raceId: number): RacePredictionResult {
  const entries = db.prepare(
    'SELECT * FROM race_entries WHERE race_id = ? ORDER BY boat_number'
  ).all(raceId) as EntryData[];

  if (entries.length < 6) {
    return { raceId, verdict: 'skip', skipReason: '出走表データ不足', boatPredictions: [], recommendations: [] };
  }

  // 天候データを取得
  const raceRow = db.prepare(
    'SELECT wind_direction, wind_speed, wave_height FROM races WHERE id = ?'
  ).get(raceId) as RaceWeather | undefined;

  const predictions = calculateProbabilities(entries, raceRow || null);

  // 実績ベース戦略を適用
  const strategies = applyStrategies(raceId);

  // 高信頼の戦略があれば購入推奨
  const highConfidence = strategies.filter(s => s.confidence === 'high');

  if (highConfidence.length > 0) {
    return {
      raceId,
      verdict: 'buy',
      skipReason: null,
      boatPredictions: predictions,
      recommendations: highConfidence, // 回収率100%超えの戦略のみ
    };
  }

  // 中信頼のみ or オッズなし → 全て見送り。期待値マイナスは一切推奨しない。
  if (strategies.length > 0 && strategies.every(s => s.confidence !== 'high')) {
    return {
      raceId,
      verdict: 'skip',
      skipReason: '条件が揃わないため見送り',
      boatPredictions: predictions,
      recommendations: [], // 期待値マイナスは表示しない
    };
  }

  // 戦略に合致しない → 見送り
  const boat1 = entries.find(e => e.boat_number === 1);
  let reason = '実績ベースの勝ち条件に合致しない';
  if (boat1?.racer_class === 'A1') reason = '1号艇A1だがオッズが低く回収率マイナスの可能性';
  else if (boat1?.racer_class === 'B1' || boat1?.racer_class === 'B2') reason = '1号艇がB級で予測精度が低い';
  else if (entries.some(e => e.boat_number !== 1 && e.racer_class === 'A1')) reason = '外枠にA1がいて波乱の可能性';

  return {
    raceId,
    verdict: 'skip',
    skipReason: reason,
    boatPredictions: predictions,
    recommendations: [],
  };
}

export function savePrediction(result: RacePredictionResult): void {
  const run = db.transaction(() => {
    const upsertPred = db.prepare(`
      INSERT INTO predictions (race_id, boat_number, win_probability, place_probability)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(race_id, boat_number)
      DO UPDATE SET win_probability=excluded.win_probability, place_probability=excluded.place_probability, calculated_at=datetime('now')
    `);
    for (const p of result.boatPredictions) {
      upsertPred.run(result.raceId, p.boatNumber, p.winProbability, p.placeProbability);
    }

    const existingRec = db.prepare('SELECT id FROM buy_recommendations WHERE race_id = ?').get(result.raceId) as { id: number } | undefined;
    if (existingRec) {
      db.prepare('DELETE FROM buy_recommendation_details WHERE recommendation_id = ?').run(existingRec.id);
      db.prepare('DELETE FROM buy_recommendations WHERE id = ?').run(existingRec.id);
    }

    const recResult = db.prepare(
      'INSERT INTO buy_recommendations (race_id, verdict, skip_reason) VALUES (?, ?, ?)'
    ).run(result.raceId, result.verdict, result.skipReason);
    const recId = recResult.lastInsertRowid;

    const insertDetail = db.prepare(`
      INSERT INTO buy_recommendation_details
      (recommendation_id, rank, first_place, second_place, probability, odds, expected_value, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (let i = 0; i < result.recommendations.length; i++) {
      const r = result.recommendations[i];
      insertDetail.run(recId, i + 1, r.boats[0], r.boats[1] || 0, 0, 0, 0,
        `[2連単] ${r.reason}`);
    }
  });
  run();
}
