import { useState } from 'react';
import { InputNumber, Button } from 'antd';

export default function StrategyPage() {
  const [budget, setBudget] = useState<number>(30000);
  const [target, setTarget] = useState<number>(50000);
  const [result, setResult] = useState<string | null>(null);

  const generate = () => {
    const monthlyRaces = 30;
    const hitRate = 0.22;
    const returnRate = 6.5;

    const betPerRace = Math.max(100, Math.round(budget / monthlyRaces / 100) * 100);
    const maxBet = Math.max(Math.round(budget * 0.03 / 100) * 100, 100);
    const safeBet = Math.min(betPerRace, maxBet);

    const totalInvest = safeBet * monthlyRaces;
    const totalReturn = totalInvest * returnRate;
    const totalProfit = totalReturn - totalInvest;

    const achievable = totalProfit >= target;
    const needBet = Math.ceil(target / (returnRate - 1) / monthlyRaces / 100) * 100;
    const noHitProb = Math.pow(1 - hitRate, monthlyRaces);
    const expectedHits = Math.round(monthlyRaces * hitRate);

    let t = '';
    t += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    t += `  今月の作戦【2連単特化】\n`;
    t += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    t += `月の予算: ${budget.toLocaleString()}円\n`;
    t += `目標利益: ${target.toLocaleString()}円\n\n`;

    t += `【賭け方】\n\n`;
    t += `  2連単のみ\n`;
    t += `  1回の賭け金: ${safeBet.toLocaleString()}円\n`;
    t += `  月のレース数: 約${monthlyRaces}回\n`;
    t += `  月の投資合計: ${totalInvest.toLocaleString()}円\n\n`;

    t += `【期待される結果】\n\n`;
    t += `  的中回数: 月${expectedHits}〜${expectedHits + 2}回（${monthlyRaces}回中）\n`;
    t += `  期待回収: ${Math.round(totalReturn).toLocaleString()}円\n`;
    t += `  期待利益: +${Math.round(totalProfit).toLocaleString()}円\n`;
    t += `  回収率: ${Math.round(returnRate * 100)}%\n\n`;

    if (achievable) {
      t += `  → 目標${target.toLocaleString()}円は達成見込みあり!\n\n`;
    } else {
      t += `  → 目標${target.toLocaleString()}円に届かせるには\n`;
      t += `    1回の賭け金を${needBet.toLocaleString()}円に上げる必要あり。\n`;
      t += needBet <= budget * 0.05
        ? `    予算の${(needBet / budget * 100).toFixed(1)}%なので実行可能。\n\n`
        : `    リスクが高い。まず予算を増やしてから。\n\n`;
    }

    t += `【リスク】\n\n`;
    t += `  最悪（全部外れ）: -${totalInvest.toLocaleString()}円\n`;
    t += `  全部外れる確率: ${(noHitProb * 100).toFixed(2)}%\n`;
    t += `  1回の賭け金: 予算の${(safeBet / budget * 100).toFixed(1)}%\n\n`;

    t += `【鉄のルール】\n\n`;
    t += `  1. ツールが「賭ける」と出したレースだけに賭ける\n`;
    t += `  2. 「見送り」は絶対に賭けない\n`;
    t += `  3. 1回の賭け金は予算の3%以内\n`;
    t += `  4. 資金が増えたら賭け金も比例して上げてOK\n`;
    t += `  5. 熱くならない。感情で賭けない。ツールに従う\n`;
    t += `  6. 連敗しても作戦を変えない（統計は長期で効く）\n`;

    setResult(t);
  };

  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>今月の作戦を立てる</div>

      <div style={{ padding: 20, background: '#fafafa', borderRadius: 8, border: '1px solid #e8e8e8', marginBottom: 16 }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>今月の予算（賭けられる金額）</div>
          <InputNumber
            value={budget} onChange={(v) => v && setBudget(v)}
            min={1000} step={5000}
            formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
            addonAfter="円" style={{ width: 200 }} size="large"
          />
          <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>最悪なくなっても大丈夫な金額を入れてください</div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>今月の目標利益</div>
          <InputNumber
            value={target} onChange={(v) => v && setTarget(v)}
            min={1000} step={10000}
            formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
            addonAfter="円" style={{ width: 200 }} size="large"
          />
        </div>

        <Button type="primary" size="large" onClick={generate} style={{ width: '100%' }}>
          作戦を立てる
        </Button>
      </div>

      {result && (
        <pre style={{
          padding: 20, background: '#fff', borderRadius: 8,
          border: '2px solid #52c41a', fontSize: 13, lineHeight: 1.8,
          whiteSpace: 'pre-wrap', fontFamily: 'inherit',
        }}>
          {result}
        </pre>
      )}
    </div>
  );
}
