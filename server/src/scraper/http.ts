import axios from 'axios';
import * as iconv from 'iconv-lite';

const BASE_URL = 'https://www.boatrace.jp';

/**
 * ボートレース公式サイトからHTMLを取得する
 * Content-Typeヘッダーからcharsetを自動判定する
 */
export async function fetchPage(path: string): Promise<string> {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'ja,en;q=0.9',
    },
    timeout: 15000,
  });

  // Content-Typeからcharsetを判定
  const contentType = (response.headers['content-type'] || '').toLowerCase();
  const charsetMatch = contentType.match(/charset=([^\s;]+)/);
  const charset = charsetMatch ? charsetMatch[1].replace(/-/g, '') : '';

  // UTF-8ならそのまま、Shift_JISならデコード
  if (charset === 'utf8' || charset === 'utf-8' || charset === 'UTF8') {
    return Buffer.from(response.data).toString('utf-8');
  }

  // デフォルト: HTML内のmeta charsetも確認
  const rawStr = Buffer.from(response.data).toString('utf-8');
  if (rawStr.includes('charset=utf-8') || rawStr.includes('charset=UTF-8')) {
    return rawStr;
  }

  // Shift_JISとしてデコード
  return iconv.decode(Buffer.from(response.data), 'Shift_JIS');
}

/**
 * JSON APIからデータを取得する（オッズ等）
 */
export async function fetchJson<T>(path: string): Promise<T> {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
  const response = await axios.get<T>(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'application/json',
    },
    timeout: 15000,
  });
  return response.data;
}

export { BASE_URL };
