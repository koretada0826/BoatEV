import express from 'express';
import cors from 'cors';
import { initializeDatabase } from './db/database';
import apiRoutes from './api/routes';
import { startScheduler } from './scheduler';

// DB初期化
initializeDatabase();

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

app.use(cors());
app.use(express.json());

app.use('/api', apiRoutes);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);

  // サーバー起動後にスケジューラーを開始
  // （初回のデータ取得をバックグラウンドで実行）
  startScheduler().catch(e => console.error('Scheduler error:', e));
});
