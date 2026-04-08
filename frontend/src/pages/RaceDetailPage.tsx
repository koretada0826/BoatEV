import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Spin, Tag, message } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { fetchRaceDetail } from '../utils/api';
import type { RaceDetail } from '../types';

const BOAT_BADGE: Record<number, { bg: string; text: string }> = {
  1: { bg: '#fff', text: '#333' },
  2: { bg: '#222', text: '#fff' },
  3: { bg: '#d32f2f', text: '#fff' },
  4: { bg: '#1565c0', text: '#fff' },
  5: { bg: '#f9a825', text: '#333' },
  6: { bg: '#2e7d32', text: '#fff' },
};

const ROW_BG: Record<number, string> = {
  1: '#fafafa', 2: '#f5f5f5', 3: '#fff5f5', 4: '#f0f5ff', 5: '#fffbe6', 6: '#f0fff0',
};

export default function RaceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<RaceDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetchRaceDetail(parseInt(id, 10))
      .then(setData)
      .catch(() => message.error('データの取得に失敗しました'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div style={{ textAlign: 'center', padding: 48 }}><Spin /></div>;
  if (!data) return <div style={{ padding: 24, color: '#999' }}>データが見つかりません</div>;

  const isBuy = data.verdict === 'buy';
  const strategies = (data as any).strategies || [];
  const highStrategies = strategies.filter((s: any) => s.confidence === 'high');
  const raceChars = analyzeRace(data);

  return (
    <div>
      {/* ヘッダー */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/')} size="small" />
        <span style={{ fontSize: 15, fontWeight: 600 }}>{data.race.venueName} {data.race.raceNumber}R</span>
        {data.race.deadline && (
          <span style={{ fontSize: 12, color: '#999' }}>
            締切 {new Date(data.race.deadline).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      {/* ===== 判定バナー ===== */}
      <div style={{
        padding: '16px', borderRadius: 8, marginBottom: 16,
        background: isBuy ? '#f6ffed' : '#fafafa',
        border: isBuy ? '2px solid #52c41a' : '1px solid #e8e8e8',
      }}>
        {isBuy ? (
          <div style={{ fontSize: 18, fontWeight: 700, color: '#52c41a' }}>このレースは賭ける価値あり</div>
        ) : (
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#999' }}>このレースは見送り</div>
            <div style={{ fontSize: 13, color: '#999', marginTop: 4 }}>{data.skipReason}</div>
          </div>
        )}
      </div>

      {/* ===== 賭け方カード（購入推奨時のみ） ===== */}
      {highStrategies.length > 0 && highStrategies.map((s: any, i: number) => {
        return (
        <div key={i} style={{
          padding: '20px', borderRadius: 10, marginBottom: 16,
          background: '#f6ffed',
          border: '2px solid #52c41a',
        }}>
          {/* 何を買うか */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>何を買う？</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Tag color="green" style={{ margin: 0, fontSize: 13, padding: '2px 10px' }}>2連単</Tag>
              <BoatBadge number={s.boats[0]} />
              {s.boats[1] && (
                <>
                  <span style={{ color: '#999', fontSize: 14 }}>→</span>
                  <BoatBadge number={s.boats[1]} />
                </>
              )}
              <span style={{ fontSize: 22, fontWeight: 700 }}>{s.label}</span>
            </div>
            <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
              1着と2着を順番通りに当てる。当たりにくいが配当が大きい。
            </div>
          </div>

          {/* 数値3つ */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 0, marginBottom: 16, borderRadius: 8, overflow: 'hidden',
            border: '1px solid #e8e8e8',
          }}>
            <NumberBox
              label="当たる確率"
              value={s.historicalHitRate}
              sub="過去の同条件レースで実際に当たった割合"
              color="#d4380d"
            />
            <NumberBox
              label="回収率"
              value={s.historicalReturnRate}
              sub="100%超え＝儲かる。100円賭けて平均いくら返るか"
              color="#52c41a"
              highlight
            />
            <NumberBox
              label="オッズ"
              value={s.odds > 0 ? `${s.odds}倍` : '未発表'}
              sub={s.odds > 0 ? `当たれば100円が${Math.round(s.odds * 100)}円になる` : 'まだ発表されていません'}
              color="#1677ff"
            />
          </div>

          {/* いくら賭ける？ */}
          <div style={{
            padding: '12px 16px', background: '#fff', borderRadius: 8,
            border: '1px solid #b7eb8f', marginBottom: 12,
          }}>
            <div style={{ fontSize: 11, color: '#999', marginBottom: 2 }}>いくら賭ける？</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#333' }}>{s.suggestedBet}</div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
              数学的に最適な賭け金を計算しています。資金の5%以内に抑えてリスク管理。
            </div>
          </div>

          {/* 期待利益 */}
          <div style={{
            padding: '12px 16px', background: '#fff', borderRadius: 8,
            border: '1px solid #b7eb8f', marginBottom: 12,
          }}>
            <div style={{ fontSize: 11, color: '#999', marginBottom: 2 }}>期待される利益</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#3a7d44' }}>{s.expectedProfit}</div>
          </div>

          {/* なぜこの判断？ */}
          <div>
            <div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>なぜこの判断？</div>
            <div style={{ fontSize: 13, color: '#555', lineHeight: 1.6 }}>{s.reason}</div>
          </div>
        </div>
        );
      })}

      {/* ===== 見送り時の参考情報 ===== */}
      {!isBuy && strategies.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#999', marginBottom: 6 }}>参考（賭けない方がいい理由）</div>
          {strategies.map((s: any, i: number) => (
            <div key={i} style={{
              padding: '10px 14px', background: '#fafafa', borderRadius: 6,
              border: '1px solid #e8e8e8', marginBottom: 6,
            }}>
              <div style={{ fontSize: 13, color: '#666' }}>{s.reason}</div>
            </div>
          ))}
        </div>
      )}

      {/* ===== レースの特徴 ===== */}
      {raceChars.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <SectionTitle>このレースの特徴</SectionTitle>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {raceChars.map((c, i) => (
              <span key={i} style={{
                fontSize: 11, padding: '4px 10px', borderRadius: 4,
                background: c.type === 'positive' ? '#f6ffed' : c.type === 'warning' ? '#fffbe6' : '#f5f5f5',
                color: c.type === 'positive' ? '#3a7d44' : c.type === 'warning' ? '#d48806' : '#666',
                border: `1px solid ${c.type === 'positive' ? '#d9f7be' : c.type === 'warning' ? '#ffe58f' : '#e8e8e8'}`,
              }}>
                {c.text}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ===== 出走表 ===== */}
      <div style={{ marginBottom: 20 }}>
        <SectionTitle>出走する選手</SectionTitle>
        <div style={{ fontSize: 11, color: '#999', marginBottom: 8 }}>
          ボートレースは6艇で競います。1号艇（白）が最も内側で有利。級はA1が最強、B2が最弱。
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e8e8e8' }}>
              <th style={thStyle}>艇</th>
              <th style={{ ...thStyle, textAlign: 'left' }}>選手</th>
              <th style={thStyle}>級</th>
              <th style={thStyle}>勝率</th>
              <th style={thStyle}>モーター</th>
              <th style={thStyle}>予測1着率</th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((entry) => {
              const pred = data.predictions.find(p => p.boatNumber === entry.boatNumber);
              const isTop = pred && pred.winProbability === Math.max(...data.predictions.map(p => p.winProbability));
              return (
                <tr key={entry.boatNumber} style={{
                  borderBottom: '1px solid #f0f0f0', background: ROW_BG[entry.boatNumber],
                }}>
                  <td style={{ ...tdStyle, textAlign: 'center' }}><BoatBadge number={entry.boatNumber} /></td>
                  <td style={{ ...tdStyle, fontWeight: isTop ? 700 : 400 }}>{entry.racerName}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}><ClassBadge cls={entry.racerClass} /></td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>{entry.winRateAll?.toFixed(2) ?? '-'}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>{entry.motorWinRate != null ? `${entry.motorWinRate.toFixed(1)}%` : '-'}</td>
                  <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 600, color: isTop ? '#d4380d' : '#333' }}>
                    {pred ? `${(pred.winProbability * 100).toFixed(1)}%` : '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ fontSize: 10, color: '#bbb', marginTop: 4 }}>
          勝率 = 選手の実力（高いほど強い）/ モーター = エンジンの調子（33%以上が好調）/ 予測1着率 = このレースで1着になる確率の予測
        </div>
      </div>

      {/* ===== 用語説明 ===== */}
      <div style={{
        padding: '12px 16px', background: '#fafafa', borderRadius: 8,
        border: '1px solid #f0f0f0', marginBottom: 16,
      }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 6 }}>用語ガイド</div>
        <div style={{ fontSize: 11, color: '#888', lineHeight: 1.8 }}>
          <b>単勝</b> = 1着を当てる。6艇から1艇選ぶだけ。最もシンプル。<br/>
          <b>オッズ</b> = 当たった時の倍率。2.0倍なら100円→200円。人気が低いほど高くなる。<br/>
          <b>的中率</b> = 過去に同じ条件で実際に当たった割合。高いほど安心。<br/>
          <b>回収率</b> = 100円賭けて平均いくら返るか。100%超えなら長期的にプラス。<br/>
          <b>A1/A2/B1/B2</b> = 選手のランク。A1が最強、B2が最弱。<br/>
          <b>モーター</b> = ボートのエンジン。抽選で割り当て。33%以上なら好調。
        </div>
      </div>
    </div>
  );
}

// ===== 数値ボックス =====
function NumberBox({ label, value, sub, color, highlight }: {
  label: string; value: string; sub: string; color: string; highlight?: boolean;
}) {
  return (
    <div style={{
      textAlign: 'center', padding: '12px 8px',
      background: highlight ? '#f6ffed' : '#fff',
      borderRight: '1px solid #f0f0f0',
    }}>
      <div style={{ fontSize: 10, color: '#999', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color, lineHeight: 1.2 }}>{value}</div>
      <div style={{ fontSize: 10, color: '#bbb', marginTop: 4, lineHeight: 1.3 }}>{sub}</div>
    </div>
  );
}

// ===== レース特徴分析 =====
function analyzeRace(data: RaceDetail) {
  const chars: { text: string; type: 'positive' | 'warning' | 'neutral' }[] = [];
  const entries = data.entries;
  if (!entries.length) return chars;

  const boat1 = entries.find(e => e.boatNumber === 1);
  if (boat1) {
    if (boat1.racerClass === 'A1') chars.push({ text: '1号艇にA1（トップ選手）→ 鉄板レースになりやすい', type: 'positive' });
    else if (boat1.racerClass === 'A2') chars.push({ text: '1号艇にA2（実力者）→ インコースの有利を活かせる', type: 'positive' });
    else if (boat1.racerClass === 'B1' || boat1.racerClass === 'B2') chars.push({ text: '1号艇がB級 → 荒れる可能性あり', type: 'warning' });
  }

  const a1s = entries.filter(e => e.racerClass === 'A1');
  if (a1s.length >= 3) chars.push({ text: `A1選手が${a1s.length}人 → 実力拮抗で予測が難しい`, type: 'warning' });
  else if (a1s.length === 1) chars.push({ text: `A1は${a1s[0].boatNumber}号艇のみ → 軸にしやすい`, type: 'positive' });
  else if (a1s.length === 0) chars.push({ text: 'A1選手がいない → A2の選手が注目', type: 'neutral' });

  const outerA1 = entries.filter(e => e.boatNumber >= 4 && e.racerClass === 'A1');
  if (outerA1.length > 0) chars.push({ text: `外枠(${outerA1.map(e => e.boatNumber + '号艇').join(',')})にA1 → まくりの可能性`, type: 'warning' });

  const goodMotor = entries.filter(e => e.motorWinRate != null && e.motorWinRate >= 40);
  if (goodMotor.length > 0) chars.push({ text: `${goodMotor.map(e => e.boatNumber + '号艇').join(',')}のモーター絶好調`, type: 'positive' });

  return chars;
}

// ===== 共通部品 =====
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 8, borderBottom: '1px solid #eee', paddingBottom: 4 }}>{children}</div>;
}

function BoatBadge({ number }: { number: number }) {
  const { bg, text } = BOAT_BADGE[number] || { bg: '#999', text: '#fff' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 24, height: 24, borderRadius: '50%', background: bg, color: text,
      border: number === 1 ? '1px solid #ccc' : 'none', fontSize: 12, fontWeight: 700,
    }}>{number}</span>
  );
}

function ClassBadge({ cls }: { cls: string }) {
  const colors: Record<string, string> = { A1: '#c41d7f', A2: '#d46b08', B1: '#1677ff', B2: '#8c8c8c' };
  return <span style={{ fontSize: 11, fontWeight: 600, color: colors[cls] || '#999' }}>{cls || '-'}</span>;
}

const thStyle: React.CSSProperties = { textAlign: 'center', padding: '6px 8px', fontWeight: 500, color: '#999', fontSize: 11 };
const tdStyle: React.CSSProperties = { padding: '8px', color: '#333' };
