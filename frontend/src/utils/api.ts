import axios from 'axios';
import type { RaceSummary, RaceDetail } from '../types';

const api = axios.create({
  baseURL: '/api',
  timeout: 60000,
});

export async function fetchRaces(date: string): Promise<{ date: string; races: RaceSummary[] }> {
  const { data } = await api.get('/races', { params: { date } });
  return data;
}

export async function fetchRaceDetail(id: number): Promise<RaceDetail> {
  const { data } = await api.get(`/races/${id}`);
  return data;
}

export async function triggerRefresh(): Promise<{ buy: number; skip: number; updated: number; message: string }> {
  const { data } = await api.post('/refresh');
  return data;
}

export async function fetchStatus(): Promise<{
  lastOddsUpdate: string | null;
  lastRaceUpdate: string | null;
  autoRefreshInterval: string;
}> {
  const { data } = await api.get('/status');
  return data;
}

export async function fetchSettings(): Promise<Record<string, any>> {
  const { data } = await api.get('/settings');
  return data;
}

export async function updateSettings(settings: Record<string, any>): Promise<void> {
  await api.put('/settings', settings);
}
