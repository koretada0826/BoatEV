import * as cheerio from 'cheerio';
import dayjs from 'dayjs';
import { fetchPage } from './http';
import db from '../db/database';

interface RaceInfo {
  raceDate: string;
  venueId: number;
  raceNumber: number;
  raceName: string;
  deadline: string | null;
}

interface EntryInfo {
  boatNumber: number;
  racerName: string;
  racerId: number | null;
  racerClass: string;
  racerBranch: string;
  winRateAll: number | null;
  winRateLocal: number | null;
  motorNumber: number | null;
  motorWinRate: number | null;
  boatNumberAssigned: number | null;
  boatWinRate: number | null;
  weight: number | null;
  flyingCount: number;
  lateCount: number;
}

/**
 * 当日の開催場一覧を取得する
 */
export async function fetchTodayVenues(date: string): Promise<number[]> {
  const dateStr = date.replace(/-/g, '');
  const html = await fetchPage(`/owpc/pc/race/index?hd=${dateStr}`);
  const $ = cheerio.load(html);

  const venueIds: number[] = [];

  $('a[href*="raceindex"], a[href*="jcd="]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const match = href.match(/jcd=(\d{2})/);
    if (match) {
      const id = parseInt(match[1], 10);
      if (id >= 1 && id <= 24 && !venueIds.includes(id)) venueIds.push(id);
    }
  });

  return venueIds;
}

/**
 * 会場の全レースの締切時刻を取得する
 */
export async function fetchRaceDeadlines(date: string, venueId: number): Promise<Map<number, string>> {
  const dateStr = date.replace(/-/g, '');
  const jcd = String(venueId).padStart(2, '0');
  const result = new Map<number, string>();

  try {
    const html = await fetchPage(`/owpc/pc/race/raceindex?jcd=${jcd}&hd=${dateStr}`);
    const $ = cheerio.load(html);

    const times: string[] = [];
    $('td').each((_, td) => {
      const text = $(td).text().trim();
      if (text.match(/^\d{1,2}:\d{2}$/)) {
        times.push(text);
      }
    });

    // 最初の12個が1R〜12Rの締切時刻
    for (let i = 0; i < Math.min(12, times.length); i++) {
      const deadline = `${date}T${times[i].padStart(5, '0')}:00`;
      result.set(i + 1, deadline);
    }
  } catch {}

  return result;
}

/**
 * 締切時刻をDBに保存する
 */
export function saveDeadlines(date: string, venueId: number, deadlines: Map<number, string>): void {
  const update = db.prepare('UPDATE races SET deadline = ? WHERE race_date = ? AND venue_id = ? AND race_number = ?');
  db.transaction(() => {
    for (const [rno, deadline] of deadlines) {
      update.run(deadline, date, venueId, rno);
    }
  })();
}

/**
 * 出走表ページからレース情報と選手情報を取得する
 */
export async function fetchRaceCard(
  date: string,
  venueId: number,
  raceNumber: number
): Promise<{ race: RaceInfo; entries: EntryInfo[] }> {
  const dateStr = date.replace(/-/g, '');
  const jcd = String(venueId).padStart(2, '0');
  const rno = String(raceNumber).padStart(2, '0');

  const html = await fetchPage(
    `/owpc/pc/race/racelist?rno=${rno}&jcd=${jcd}&hd=${dateStr}`
  );
  const $ = cheerio.load(html);

  const raceName = $('.heading2_title').text().trim() || `${raceNumber}R`;

  const deadlineText = $('.heading2_deadline').text().trim();
  let deadline: string | null = null;
  const timeMatch = deadlineText.match(/(\d{1,2}):(\d{2})/);
  if (timeMatch) {
    deadline = dayjs(`${date} ${timeMatch[1]}:${timeMatch[2]}`).toISOString();
  }

  const entries: EntryInfo[] = [];

  // 出走表テーブルは 20セル以上の行が6行あるテーブル
  // Table 1（27行）内の24セル行が選手データ
  let boatIdx = 0;
  $('table').eq(1).find('tr').each((_, row) => {
    const tds = $(row).find('td');
    if (tds.length < 20) return;
    boatIdx++;
    if (boatIdx > 6) return;

    const boat = boatIdx;

    // セル内に複数行のデータがある（例: "27 34.19 49.03"）
    // nth=0で1番目、nth=1で2番目の数値を取る
    const parseNthNum = (idx: number, nth: number = 0): number | null => {
      const el = tds.eq(idx);
      if (!el.length) return null;
      const text = el.text().trim();
      const matches = text.match(/[\d.]+/g);
      if (!matches || matches.length <= nth) return null;
      const v = parseFloat(matches[nth]);
      return isNaN(v) ? null : v;
    };

    // 名前と登録番号（3列目）
    const nameCell = tds.eq(2);
    const nameLink = nameCell.find('a').first();
    const racerName = nameLink.text().trim();

    let racerId: number | null = null;
    const href = nameLink.attr('href') || '';
    const racerMatch = href.match(/toban=(\d+)/);
    if (racerMatch) racerId = parseInt(racerMatch[1], 10);

    // 級別
    const fullText = nameCell.text();
    const classMatch = fullText.match(/(A1|A2|B1|B2)/);
    const racerClass = classMatch ? classMatch[1] : '';

    // 支部
    const branchMatch = fullText.match(/(東京|埼玉|群馬|茨城|千葉|静岡|愛知|三重|福井|滋賀|京都|大阪|兵庫|奈良|岡山|広島|山口|香川|徳島|愛媛|高知|福岡|佐賀|長崎|熊本|大分|宮崎|鹿児島)/);
    const racerBranch = branchMatch ? branchMatch[1] : '';

    // 体重（"47.3kg"のような形式）
    const weightMatch = fullText.match(/([\d.]+)kg/);
    const weight = weightMatch ? parseFloat(weightMatch[1]) : null;

    // F/L（4列目: "F1\nL0\n0.22" のようなフォーマット）
    const flText = tds.eq(3).text().trim();
    const fMatch = flText.match(/F(\d)/);
    const lMatch = flText.match(/L(\d)/);
    const flyingCount = fMatch ? parseInt(fMatch[1], 10) : 0;
    const lateCount = lMatch ? parseInt(lMatch[1], 10) : 0;

    // td[4]: "4.47 19.74 44.74" → 勝率, 1着率, 連対率
    // td[5]: "4.79 31.03 48.28" → 当地勝率, 当地1着率, 当地連対率
    const winRateAll = parseNthNum(4, 0);
    const winRateLocal = parseNthNum(5, 0);

    // td[6]: "27 34.19 49.03" → モーター番号, モーター2連率%, モーター3連率%
    const motorNumber = parseNthNum(6, 0) != null ? Math.round(parseNthNum(6, 0)!) : null;
    const motorWinRate = parseNthNum(6, 1); // モーター2連率

    // td[7]: "45 26.76 44.37" → ボート番号, ボート2連率%, ボート3連率%
    const boatNumAssigned = parseNthNum(7, 0) != null ? Math.round(parseNthNum(7, 0)!) : null;
    const boatWinRate = parseNthNum(7, 1); // ボート2連率

    if (racerName) {
      entries.push({
        boatNumber: boat,
        racerName,
        racerId,
        racerClass,
        racerBranch,
        winRateAll,
        winRateLocal,
        motorNumber,
        motorWinRate,
        boatNumberAssigned: boatNumAssigned,
        boatWinRate,
        weight,
        flyingCount,
        lateCount,
      });
    }
  });

  return {
    race: { raceDate: date, venueId, raceNumber, raceName, deadline },
    entries,
  };
}

export interface WeatherData {
  weather: string | null;
  windDirection: string | null;
  windSpeed: number | null;
  waveHeight: number | null;
  temperature: number | null;
  waterTemperature: number | null;
}

export interface ExhibitionResult {
  entries: Map<number, { exhibitionTime: number | null; startTiming: number | null }>;
  weather: WeatherData;
}

/**
 * 展示情報 + 天候データを取得する
 */
export async function fetchExhibitionData(
  date: string,
  venueId: number,
  raceNumber: number
): Promise<ExhibitionResult> {
  const dateStr = date.replace(/-/g, '');
  const jcd = String(venueId).padStart(2, '0');
  const rno = String(raceNumber).padStart(2, '0');
  const entries = new Map<number, { exhibitionTime: number | null; startTiming: number | null }>();
  const weather: WeatherData = {
    weather: null, windDirection: null, windSpeed: null,
    waveHeight: null, temperature: null, waterTemperature: null,
  };

  try {
    const html = await fetchPage(
      `/owpc/pc/race/beforeinfo?rno=${rno}&jcd=${jcd}&hd=${dateStr}`
    );
    const $ = cheerio.load(html);

    // === 天候データ取得 ===
    const bodyText = $('body').text();

    // 天候: "晴" "曇り" "雨" "雪" "霧" など
    const weatherMatch = bodyText.match(/天候\s*[:\s]*(\S+)/);
    if (weatherMatch) weather.weather = weatherMatch[1];

    // 風向: "北" "南西" など
    const windDirMatch = bodyText.match(/風向\s*[:\s]*(\S+)/);
    if (windDirMatch) weather.windDirection = windDirMatch[1];

    // 風速: "3m" のような形式
    const windMatch = bodyText.match(/風速\s*[:\s]*([\d.]+)\s*m/);
    if (windMatch) weather.windSpeed = parseFloat(windMatch[1]);

    // 波高: "3cm" のような形式
    const waveMatch = bodyText.match(/波高\s*[:\s]*([\d.]+)\s*cm/);
    if (waveMatch) weather.waveHeight = parseFloat(waveMatch[1]);

    // 気温
    const tempMatch = bodyText.match(/気温\s*[:\s]*([\d.]+)\s*℃/);
    if (tempMatch) weather.temperature = parseFloat(tempMatch[1]);

    // 水温
    const waterTempMatch = bodyText.match(/水温\s*[:\s]*([\d.]+)\s*℃/);
    if (waterTempMatch) weather.waterTemperature = parseFloat(waterTempMatch[1]);

    // is-weather系クラスからも天候を取得（フォールバック）
    if (!weather.weather) {
      const weatherEl = $('.weather1_bodyUnit .weather1_bodyUnitLabelData').first();
      if (weatherEl.length) weather.weather = weatherEl.text().trim();
    }

    // テーブルのヘッダーに"風速""波高"が含まれるセルからも取得
    $('div, span, p').each((_, el) => {
      const text = $(el).text().trim();
      if (!weather.windSpeed) {
        const m = text.match(/^(\d+)m$/);
        const prev = $(el).prev().text().trim();
        if (m && prev.includes('風')) weather.windSpeed = parseFloat(m[1]);
      }
      if (!weather.waveHeight) {
        const m = text.match(/^(\d+)cm$/);
        const prev = $(el).prev().text().trim();
        if (m && prev.includes('波')) weather.waveHeight = parseFloat(m[1]);
      }
    });

    // === 展示タイム + STタイミング取得 ===
    // スタート展示テーブル: 各艇のSTタイミング
    // コース/艇番/ST の並びのテーブルを探す
    const stTimings = new Map<number, number>();

    // スタート展示情報: "is-boatColor" を含むtd → その行からSTタイミングを取得
    $('table').each((_, table) => {
      const headerText = $(table).prev().text() + $(table).find('th').text();
      // スタート展示テーブルを判別
      $(table).find('tr').each((_, row) => {
        const tds = $(row).find('td');
        if (tds.length < 2) return;

        for (let boat = 1; boat <= 6; boat++) {
          const boatTd = $(row).find(`td.is-boatColor${boat}`);
          if (!boatTd.length) continue;

          // STタイミング: .xx形式（0.xx秒）の数値を探す
          tds.each((_, td) => {
            const text = $(td).text().trim();
            // STタイミングは通常 .xx形式（例: .12, .08, -.03）
            const stMatch = text.match(/^[F]?\s*(-?\.\d{2})$/);
            if (stMatch) {
              const st = parseFloat(stMatch[1]);
              if (Math.abs(st) < 1.0) {
                stTimings.set(boat, st);
              }
            }
            // F.xx形式（フライング展示）
            const fMatch = text.match(/^F\s*(\.?\d{2})$/);
            if (fMatch) {
              stTimings.set(boat, -parseFloat('0.' + fMatch[1].replace('.', '')));
            }
          });
        }
      });
    });

    // 展示タイムテーブル
    for (let boat = 1; boat <= 6; boat++) {
      const boatTd = $(`td.is-boatColor${boat}`).first();
      if (!boatTd.length) {
        entries.set(boat, { exhibitionTime: null, startTiming: stTimings.get(boat) || null });
        continue;
      }

      const row = boatTd.closest('tr');
      const tds = row.find('td');

      let exhTime: number | null = null;
      tds.each((_, td) => {
        const text = $(td).text().trim();
        const val = parseFloat(text);
        if (!isNaN(val) && val > 6.0 && val < 8.0) {
          exhTime = val;
        }
      });

      entries.set(boat, {
        exhibitionTime: exhTime,
        startTiming: stTimings.get(boat) || null,
      });
    }
  } catch {
    console.warn(`展示情報取得失敗: venue=${venueId}, race=${raceNumber}`);
  }

  return { entries, weather };
}

/**
 * レース情報をDBに保存する
 */
export function saveRaceData(
  race: RaceInfo,
  entries: EntryInfo[],
  exhibition: ExhibitionResult | Map<number, { exhibitionTime: number | null; startTiming: number | null }>
): number {
  // 後方互換: 旧形式のMapも受け付ける
  const exhEntries = exhibition instanceof Map ? exhibition : exhibition.entries;
  const weatherData = exhibition instanceof Map ? null : exhibition.weather;

  const upsertRace = db.prepare(`
    INSERT INTO races (race_date, venue_id, race_number, race_name, deadline, status,
      weather, wind_direction, wind_speed, wave_height, temperature, water_temperature)
    VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(race_date, venue_id, race_number)
    DO UPDATE SET race_name=excluded.race_name, deadline=excluded.deadline,
      weather=COALESCE(excluded.weather, races.weather),
      wind_direction=COALESCE(excluded.wind_direction, races.wind_direction),
      wind_speed=COALESCE(excluded.wind_speed, races.wind_speed),
      wave_height=COALESCE(excluded.wave_height, races.wave_height),
      temperature=COALESCE(excluded.temperature, races.temperature),
      water_temperature=COALESCE(excluded.water_temperature, races.water_temperature),
      updated_at=datetime('now')
  `);
  upsertRace.run(
    race.raceDate, race.venueId, race.raceNumber, race.raceName, race.deadline,
    weatherData?.weather || null, weatherData?.windDirection || null,
    weatherData?.windSpeed || null, weatherData?.waveHeight || null,
    weatherData?.temperature || null, weatherData?.waterTemperature || null,
  );

  const row = db.prepare(
    'SELECT id FROM races WHERE race_date=? AND venue_id=? AND race_number=?'
  ).get(race.raceDate, race.venueId, race.raceNumber) as { id: number };
  const raceId = row.id;

  const upsertEntry = db.prepare(`
    INSERT INTO race_entries (
      race_id, boat_number, racer_id, racer_name, racer_class, racer_branch,
      win_rate_all, win_rate_local, motor_number, motor_win_rate,
      boat_number_assigned, boat_win_rate, exhibition_time, start_timing,
      weight, flying_count, late_count
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(race_id, boat_number)
    DO UPDATE SET
      racer_name=excluded.racer_name, racer_class=excluded.racer_class,
      win_rate_all=excluded.win_rate_all, win_rate_local=excluded.win_rate_local,
      motor_win_rate=excluded.motor_win_rate, exhibition_time=excluded.exhibition_time,
      start_timing=excluded.start_timing
  `);

  const insertAll = db.transaction(() => {
    for (const entry of entries) {
      const exh = exhEntries.get(entry.boatNumber);
      upsertEntry.run(
        raceId, entry.boatNumber, entry.racerId, entry.racerName,
        entry.racerClass, entry.racerBranch, entry.winRateAll, entry.winRateLocal,
        entry.motorNumber, entry.motorWinRate, entry.boatNumberAssigned,
        entry.boatWinRate, exh?.exhibitionTime ?? null, exh?.startTiming ?? null,
        entry.weight, entry.flyingCount, entry.lateCount
      );
    }
  });
  insertAll();

  return raceId;
}
