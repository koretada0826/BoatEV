// レース一覧の各レース
export interface RaceSummary {
  id: number;
  date: string;
  venueId: number;
  venueName: string;
  venueShortName: string;
  raceNumber: number;
  raceName: string;
  deadline: string | null;
  status: string;
  verdict: 'buy' | 'skip' | 'pending';
  skipReason: string | null;
  topPick: string | null;
  topEv: number | null;
}

// レース詳細
export interface RaceDetail {
  race: {
    id: number;
    date: string;
    venueId: number;
    venueName: string;
    raceNumber: number;
    raceName: string;
    deadline: string | null;
    status: string;
  };
  entries: EntryInfo[];
  predictions: PredictionInfo[];
  verdict: 'buy' | 'skip' | 'pending';
  skipReason: string | null;
  calculatedAt: string | null;
  recommendations: RecommendationInfo[];
  odds: OddsInfo[];
}

export interface EntryInfo {
  boatNumber: number;
  racerName: string;
  racerClass: string;
  winRateAll: number | null;
  winRateLocal: number | null;
  motorWinRate: number | null;
  exhibitionTime: number | null;
  startTiming: number | null;
}

export interface PredictionInfo {
  boatNumber: number;
  winProbability: number;
  placeProbability: number;
}

export interface RecommendationInfo {
  rank: number;
  bet: string;
  firstPlace: number;
  secondPlace: number;
  probability: number;
  odds: number;
  ev: number;
  reason: string;
}

export interface OddsInfo {
  bet: string;
  odds: number;
  popularity: number;
}
