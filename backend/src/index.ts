import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import companiesRouter from './routes/companies.js';
import portsRouter from './routes/ports.js';
import shipsRouter from './routes/ships.js';
import tasksRouter from './routes/tasks.js';
import leaderboardRouter from './routes/leaderboard.js';
import telegramRouter from './routes/telegram.js';
import { optionalCompanyId } from './middleware/auth.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api/companies', optionalCompanyId, companiesRouter);
app.use('/api/ports', portsRouter);
app.use('/api/ships', shipsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/leaderboard', leaderboardRouter);
app.use('/api/telegram', telegramRouter);

app.listen(config.port, () => {
  console.log(`Anchor backend listening on port ${config.port}`);
});
