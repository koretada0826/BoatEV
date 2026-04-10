import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { DatePicker, Button, Spin, Tag, message } from 'antd';
import { ReloadOutlined, SyncOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { fetchRaces, triggerRefresh, fetchStatus } from '../utils/api';
import type { RaceSummary } from '../types';

const AUTO_REFRESH_MS = 60 * 1000; // 60秒ごとに自動更新

function groupByVenue(races: RaceSummary[]): Map<string, RaceSummary[]> {
  const map = new Map<string, RaceSummary[]>();
  for (const race of races) {
    const key = race.venueName;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(race);
  }
  return map;
}

export default function RaceListPage() {
  const [date, setDate] = useState<Dayjs>(dayjs());
  const [races, setRaces] = useState<RaceSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [nextRefresh, setNextRefresh] = useState<number>(AUTO_REFRESH_MS / 1000);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const navigate = useNavigate();

  const isToday = date.format('YYYY-MM-DD') === dayjs().format('YYYY-MM-DD');

  // データ読み込み
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchRaces(date.format('YYYY-MM-DD'));
      setRaces(result.races);

      // 最終更新時刻を取得
      try {
        const status = await fetchStatus();
        if (status.lastOddsUpdate) {
          setLastUpdate(dayjs(status.lastOddsUpdate).format('HH:mm:ss'));
        }
      } catch {}
    } catch {
      message.error('データの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  // 今日の場合、3分ごとに自動リロード
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);

    if (isToday) {
      setNextRefresh(AUTO_REFRESH_MS / 1000);

      countdownRef.current = setInterval(() => {
        setNextRefresh((prev) => Math.max(0, prev - 1));
      }, 1000);

      timerRef.current = setInterval(() => {
        load();
        setNextRefresh(AUTO_REFRESH_MS / 1000);
      }, AUTO_REFRESH_MS);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [isToday, load]);

  // 手動更新（オッズ再取得+予測更新）
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const result = await triggerRefresh();
      message.success(result.message);
      await load();
      setNextRefresh(AUTO_REFRESH_MS / 1000);
    } catch {
      message.error('更新に失敗しました');
    } finally {
      setRefreshing(false);
    }
  };

  const grouped = groupByVenue(races);
  const buyCount = races.filter((r) => r.verdict === 'buy').length;
  const skipCount = races.filter((r) => r.verdict === 'skip').length;

  return (
    <div>
      {/* ヘッダー */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <DatePicker
          value={date}
          onChange={(d) => d && setDate(d)}
          allowClear={false}
          size="small"
          style={{ width: 130 }}
        />
        <Button size="small" icon={<ReloadOutlined />} onClick={load} loading={loading}>
          表示更新
        </Button>
        <Button
          size="small"
          type="primary"
          icon={<SyncOutlined spin={refreshing} />}
          onClick={handleRefresh}
          loading={refreshing}
        >
          オッズ再取得
        </Button>
      </div>

      {/* ステータスバー */}
      {races.length > 0 && (
        <div style={{
          padding: '14px 16px', background: buyCount > 0 ? '#f6ffed' : '#fafafa',
          borderRadius: 8, marginBottom: 12,
          border: buyCount > 0 ? '2px solid #52c41a' : '1px solid #f0f0f0',
        }}>
          {buyCount > 0 ? (
            <>
              <div style={{ fontSize: 15, marginBottom: 6 }}>
                今日は <strong style={{ color: '#52c41a', fontSize: 22 }}>{buyCount}レース</strong> に賭ける価値あり
              </div>
              <div style={{ fontSize: 12, color: '#555', marginBottom: 4 }}>
                各レースに単勝1点ずつ、合計{buyCount}点。緑のレースをタップして詳細を確認。
              </div>
              <div style={{ fontSize: 11, color: '#999' }}>
                {skipCount}レースは見送り（賭けない方が得）
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 15, color: '#999' }}>今日は賭ける価値のあるレースがありません</div>
              <div style={{ fontSize: 12, color: '#bbb', marginTop: 4 }}>見送りが正解。無理に賭けない = 資金を守る。</div>
            </>
          )}
          <div style={{ fontSize: 10, color: '#bbb', marginTop: 6 }}>
            {lastUpdate && `最終更新 ${lastUpdate}`}
            {isToday && ` / ${Math.floor(nextRefresh / 60)}:${String(nextRefresh % 60).padStart(2, '0')}後に自動更新`}
          </div>
        </div>
      )}

      {loading && races.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin tip="データ取得中..." />
        </div>
      ) : races.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#999' }}>
          <p>レースデータがありません。</p>
          <p style={{ fontSize: 12 }}>サーバー起動時に自動取得されます。「オッズ再取得」で手動更新もできます。</p>
        </div>
      ) : (
        <div>
          {Array.from(grouped.entries()).map(([venueName, venueRaces]) => (
            <div key={venueName} style={{ marginBottom: 20 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#555',
                  marginBottom: 6,
                  borderBottom: '1px solid #eee',
                  paddingBottom: 4,
                }}
              >
                {venueName}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {venueRaces.map((race) => (
                  <RaceRow key={race.id} race={race} onClick={() => navigate(`/race/${race.id}`)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RaceRow({ race, onClick }: { race: RaceSummary; onClick: () => void }) {
  const isBuy = race.verdict === 'buy';

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '7px 10px',
        cursor: 'pointer',
        borderRadius: 4,
        background: isBuy ? '#f6ffed' : '#fff',
        border: isBuy ? '1px solid #b7eb8f' : '1px solid transparent',
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = isBuy ? '#e6ffe0' : '#fafafa';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = isBuy ? '#f6ffed' : '#fff';
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 600, color: '#333', width: 32, flexShrink: 0 }}>
        {race.raceNumber}R
      </span>

      <span style={{ width: 72, flexShrink: 0 }}>
        {isBuy ? (
          <Tag color="green" style={{ margin: 0, fontSize: 11 }}>賭ける</Tag>
        ) : (
          <Tag color="default" style={{ margin: 0, fontSize: 11, color: '#bbb' }}>見送り</Tag>
        )}
      </span>

      <span style={{ width: 50, flexShrink: 0 }}>
        {isBuy ? <Tag color="green" style={{ margin: 0, fontSize: 10 }}>2連単</Tag> : null}
      </span>

      <span style={{ fontSize: 11, color: '#bbb', marginLeft: 'auto' }}>
        {race.deadline ? dayjs(race.deadline).format('HH:mm') : ''}
      </span>
    </div>
  );
}
