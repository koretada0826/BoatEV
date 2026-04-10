import { useState, useEffect, useCallback } from 'react';
import { Button, Spin, message, Modal, InputNumber, Input, Switch, Select } from 'antd';
import { PlusOutlined, DeleteOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { fetchBetRecords, createBetRecord, updateBetRecord, deleteBetRecord } from '../utils/api';

interface BetRecord {
  id: number;
  raceId: number | null;
  betDate: string;
  venueName: string;
  raceNumber: number;
  betType: string;
  betCombination: string;
  betAmount: number;
  isHit: boolean;
  payout: number;
  odds: number | null;
  memo: string | null;
  profit: number;
}

interface Summary {
  totalBet: number;
  totalPayout: number;
  profit: number;
  hitCount: number;
  totalRaces: number;
  hitRate: string;
  returnRate: string;
}

interface DailySum {
  date: string;
  bet: number;
  payout: number;
  hit: number;
  total: number;
  profit: number;
}

const VENUES = [
  '桐生','戸田','江戸川','平和島','多摩川','浜名湖','蒲郡','常滑',
  '津','三国','びわこ','住之江','尼崎','鳴門','丸亀','児島',
  '宮島','徳山','下関','若松','芦屋','福岡','唐津','大村',
];

export default function ProfitPage() {
  const [month, setMonth] = useState(dayjs().format('YYYY-MM'));
  const [data, setData] = useState<{ summary: Summary; daily: DailySum[]; records: BetRecord[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  // 新規入力フォーム
  const [form, setForm] = useState({
    betDate: dayjs().format('YYYY-MM-DD'),
    venueName: '',
    raceNumber: 1,
    betCombination: '',
    betAmount: 100,
    isHit: false,
    payout: 0,
    odds: 0,
    memo: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchBetRecords(month);
      setData(result);
    } catch {
      message.error('データの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { load(); }, [load]);

  const prevMonth = () => setMonth(dayjs(month + '-01').subtract(1, 'month').format('YYYY-MM'));
  const nextMonth = () => setMonth(dayjs(month + '-01').add(1, 'month').format('YYYY-MM'));

  const handleAdd = async () => {
    if (!form.venueName || !form.betCombination) {
      message.warning('会場と買い目を入力してください');
      return;
    }
    try {
      await createBetRecord({
        betDate: form.betDate,
        venueName: form.venueName,
        raceNumber: form.raceNumber,
        betCombination: form.betCombination,
        betAmount: form.betAmount,
        isHit: form.isHit,
        payout: form.isHit ? form.payout : 0,
        odds: form.odds || undefined,
        memo: form.memo || undefined,
      });
      message.success('記録しました');
      setModalOpen(false);
      setForm({ betDate: dayjs().format('YYYY-MM-DD'), venueName: '', raceNumber: 1, betCombination: '', betAmount: 100, isHit: false, payout: 0, odds: 0, memo: '' });
      load();
    } catch {
      message.error('保存に失敗しました');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteBetRecord(id);
      message.success('削除しました');
      load();
    } catch {
      message.error('削除に失敗しました');
    }
  };

  const handleToggleHit = async (record: BetRecord) => {
    const newHit = !record.isHit;
    const newPayout = newHit && record.odds ? Math.round(record.odds * record.betAmount) : 0;
    try {
      await updateBetRecord(record.id, { isHit: newHit, payout: newPayout });
      load();
    } catch {
      message.error('更新に失敗しました');
    }
  };

  if (loading && !data) return <div style={{ textAlign: 'center', padding: 48 }}><Spin /></div>;

  const summary = data?.summary;
  const daily = data?.daily || [];
  const records = data?.records || [];

  // 累計損益の推移（日別）
  let cumProfit = 0;
  const cumData = daily.map(d => {
    cumProfit += d.profit;
    return { ...d, cumProfit };
  });

  return (
    <div>
      {/* ヘッダー */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button icon={<LeftOutlined />} size="small" onClick={prevMonth} />
          <span style={{ fontSize: 18, fontWeight: 700 }}>{dayjs(month + '-01').format('YYYY年M月')}</span>
          <Button icon={<RightOutlined />} size="small" onClick={nextMonth} />
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
          記録する
        </Button>
      </div>

      {/* 月間サマリー */}
      {summary && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 20,
        }}>
          <SummaryCard
            label="月間損益"
            value={`${summary.profit >= 0 ? '+' : ''}${summary.profit.toLocaleString()}円`}
            color={summary.profit >= 0 ? '#52c41a' : '#ff4d4f'}
            large
          />
          <SummaryCard
            label="回収率"
            value={`${summary.returnRate}%`}
            color={parseFloat(summary.returnRate) >= 100 ? '#52c41a' : '#ff4d4f'}
            large
          />
          <SummaryCard label="投資額" value={`${summary.totalBet.toLocaleString()}円`} color="#333" />
          <SummaryCard label="回収額" value={`${summary.totalPayout.toLocaleString()}円`} color="#1677ff" />
          <SummaryCard label="的中率" value={`${summary.hitRate}%`} color="#d4380d" />
          <SummaryCard label="レース数" value={`${summary.hitCount}的中 / ${summary.totalRaces}レース`} color="#666" />
        </div>
      )}

      {/* 累計損益グラフ（簡易バー表示） */}
      {cumData.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 8 }}>日別の累計損益</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {cumData.map(d => {
              const maxAbs = Math.max(...cumData.map(x => Math.abs(x.cumProfit)), 1);
              const width = Math.abs(d.cumProfit) / maxAbs * 50;
              const isPositive = d.cumProfit >= 0;
              return (
                <div key={d.date} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                  <span style={{ width: 45, color: '#999' }}>{dayjs(d.date).format('M/D')}</span>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
                    <div style={{
                      width: `${Math.max(width, 2)}%`,
                      height: 16, borderRadius: 3,
                      background: isPositive ? '#52c41a' : '#ff4d4f',
                    }} />
                    <span style={{
                      marginLeft: 6, fontSize: 11, fontWeight: 600,
                      color: isPositive ? '#52c41a' : '#ff4d4f',
                    }}>
                      {isPositive ? '+' : ''}{d.cumProfit.toLocaleString()}円
                    </span>
                  </div>
                  <span style={{ width: 60, textAlign: 'right', color: '#999' }}>
                    {d.hit}/{d.total}的中
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* レース別明細 */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 8 }}>レース別明細</div>
        {records.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#bbb', background: '#fafafa', borderRadius: 8 }}>
            まだ記録がありません。「記録する」ボタンから追加してください。
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {records.map(r => (
              <div key={r.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 14px', borderRadius: 8,
                background: r.isHit ? '#f6ffed' : '#fff',
                border: `1px solid ${r.isHit ? '#b7eb8f' : '#f0f0f0'}`,
              }}>
                {/* 的中/ハズレ */}
                <div
                  onClick={() => handleToggleHit(r)}
                  style={{
                    width: 36, height: 36, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: r.isHit ? '#52c41a' : '#f5f5f5',
                    color: r.isHit ? '#fff' : '#bbb',
                    fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    border: r.isHit ? 'none' : '2px solid #e8e8e8',
                  }}
                >
                  {r.isHit ? '的中' : '---'}
                </div>

                {/* レース情報 */}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {r.venueName} {r.raceNumber}R
                    <span style={{ fontSize: 11, color: '#888', marginLeft: 6 }}>{r.betType} {r.betCombination}</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#999' }}>
                    {dayjs(r.betDate).format('M/D')}
                    {r.odds ? ` / ${r.odds}倍` : ''}
                    {r.memo ? ` / ${r.memo}` : ''}
                  </div>
                </div>

                {/* 金額 */}
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 11, color: '#999' }}>投資 {r.betAmount.toLocaleString()}円</div>
                  <div style={{
                    fontSize: 14, fontWeight: 700,
                    color: r.profit >= 0 ? '#52c41a' : '#ff4d4f',
                  }}>
                    {r.profit >= 0 ? '+' : ''}{r.profit.toLocaleString()}円
                  </div>
                </div>

                {/* 削除 */}
                <Button
                  type="text" size="small" danger
                  icon={<DeleteOutlined />}
                  onClick={() => handleDelete(r.id)}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 新規記録モーダル */}
      <Modal
        title="収支を記録する"
        open={modalOpen}
        onOk={handleAdd}
        onCancel={() => setModalOpen(false)}
        okText="記録する"
        cancelText="キャンセル"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={labelStyle}>日付</label>
            <Input type="date" value={form.betDate} onChange={e => setForm({ ...form, betDate: e.target.value })} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 8 }}>
            <div>
              <label style={labelStyle}>会場</label>
              <Select
                style={{ width: '100%' }}
                value={form.venueName || undefined}
                placeholder="会場を選択"
                onChange={v => setForm({ ...form, venueName: v })}
                options={VENUES.map(v => ({ value: v, label: v }))}
              />
            </div>
            <div>
              <label style={labelStyle}>R</label>
              <InputNumber min={1} max={12} value={form.raceNumber} onChange={v => setForm({ ...form, raceNumber: v || 1 })} style={{ width: '100%' }} />
            </div>
          </div>
          <div>
            <label style={labelStyle}>買い目（例: 1-3）</label>
            <Input placeholder="1-3" value={form.betCombination} onChange={e => setForm({ ...form, betCombination: e.target.value })} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={labelStyle}>賭け金（円）</label>
              <InputNumber min={100} step={100} value={form.betAmount} onChange={v => setForm({ ...form, betAmount: v || 100 })} style={{ width: '100%' }} />
            </div>
            <div>
              <label style={labelStyle}>オッズ</label>
              <InputNumber min={1} step={0.1} value={form.odds} onChange={v => setForm({ ...form, odds: v || 0 })} style={{ width: '100%' }} />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <label style={labelStyle}>的中？</label>
            <Switch checked={form.isHit} onChange={v => {
              const payout = v && form.odds ? Math.round(form.odds * form.betAmount) : 0;
              setForm({ ...form, isHit: v, payout });
            }} />
            {form.isHit && (
              <div>
                <label style={{ ...labelStyle, marginLeft: 12 }}>払戻金</label>
                <InputNumber min={0} step={100} value={form.payout} onChange={v => setForm({ ...form, payout: v || 0 })} style={{ width: 120 }} />
              </div>
            )}
          </div>
          <div>
            <label style={labelStyle}>メモ</label>
            <Input placeholder="任意" value={form.memo} onChange={e => setForm({ ...form, memo: e.target.value })} />
          </div>
        </div>
      </Modal>
    </div>
  );
}

function SummaryCard({ label, value, color, large }: { label: string; value: string; color: string; large?: boolean }) {
  return (
    <div style={{
      padding: large ? '16px' : '12px', borderRadius: 8,
      background: '#fff', border: '1px solid #f0f0f0',
    }}>
      <div style={{ fontSize: 11, color: '#999', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: large ? 24 : 16, fontWeight: 800, color }}>{value}</div>
    </div>
  );
}

const labelStyle: React.CSSProperties = { fontSize: 12, color: '#666', display: 'block', marginBottom: 4 };
