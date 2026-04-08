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
  exhibition_time: number | null;
  flying_count: number;
}

const DEFAULT_WIN_RATE: Record<number, number> = {
  1: 0.545, 2: 0.145, 3: 0.120, 4: 0.105, 5: 0.055, 6: 0.030,
};
const CLASS_MULT: Record<string, number> = { A1: 1.08, A2: 1.02, B1: 0.94, B2: 0.82 };

function calculateProbabilities(entries: EntryData[]): BoatPrediction[] {
  if (entries.length < 6) return [];

  // 統計ベースの1着率
  const scores = entries.map((e) => {
    const stat = db.prepare('SELECT win_rate FROM course_stats WHERE boat_number = ? AND racer_class = ?')
      .get(e.boat_number, e.racer_class || 'B1') as { win_rate: number } | undefined;
    let score = stat?.win_rate ?? (DEFAULT_WIN_RATE[e.boat_number] || 0.05);
    score *= CLASS_MULT[e.racer_class] || 1.0;

    if (e.win_rate_all != null) {
      score *= (1 + Math.max(-0.10, Math.min(0.10, (e.win_rate_all - 5.0) * 0.02)));
    }
    if (e.motor_win_rate != null) {
      score *= (1 + Math.max(-0.05, Math.min(0.05, (e.motor_win_rate - 33.0) * 0.003)));
    }
    if (e.flying_count > 0) score *= 0.95;

    return { boatNumber: e.boat_number, score: Math.max(score, 0.003) };
  });

  const total = scores.reduce((s, x) => s + x.score, 0);
  const preds: BoatPrediction[] = scores.map(s => ({
    boatNumber: s.boatNumber,
    winProbability: s.score / total,
    placeProbability: 0,
    score: s.score,
  }));

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

  const predictions = calculateProbabilities(entries);

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
