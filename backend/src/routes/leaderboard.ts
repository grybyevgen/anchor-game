import { Router, Request, Response } from 'express';
import { supabase } from '../db/supabase.js';
import { optionalCompanyId } from '../middleware/auth.js';
import { STARTING_COINS, COMPANY_SETUP_BONUS } from '../types/index.js';

const INITIAL_BALANCE = STARTING_COINS + COMPANY_SETUP_BONUS;

function getWeekStartDate(): string {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - diff);
  weekStart.setHours(0, 0, 0, 0);
  return weekStart.toISOString().split('T')[0];
}

const router = Router();
router.use(optionalCompanyId);

/**
 * GET /api/leaderboard
 * Overall: companies by EARNED coins (coins minus initial balance).
 * Query: ?limit=20&offset=0
 */
router.get('/', async (req: Request & { companyId?: string }, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const { data: companies, error } = await supabase
      .from('companies')
      .select('id, name, level, coins')
      .order('coins', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const currentCompanyId = req.companyId;
    const list = (companies || []).map((c, i) => {
      const earnedCoins = Math.max(0, c.coins - INITIAL_BALANCE);
      return {
        id: c.id,
        rank: offset + i + 1,
        playerName: 'Капитан',
        companyName: c.name,
        companyLevel: c.level,
        netProfit: earnedCoins,
        isCurrentUser: currentCompanyId ? c.id === currentCompanyId : false,
      };
    });

    res.json({ leaderboard: list });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/leaderboard/weekly
 * Weekly: из company_earnings по week_start_date (как в anchor). Cron не нужен.
 * Query: ?limit=20&offset=0
 */
router.get('/weekly', async (req: Request & { companyId?: string }, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const weekStartDate = getWeekStartDate();

    const { data: earnings, error } = await supabase
      .from('company_earnings')
      .select(
        `
        weekly_earnings,
        companies:company_id (id, name, level)
      `
      )
      .eq('week_start_date', weekStartDate)
      .order('weekly_earnings', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const currentCompanyId = req.companyId;
    type Row = { weekly_earnings: number; companies: { id: string; name: string; level: number } | { id: string; name: string; level: number }[] | null };
    const list = (earnings || []).map((e: Row, i: number) => {
      const raw = e.companies;
      const c = Array.isArray(raw) ? raw[0] ?? null : raw;
      return {
        id: c?.id ?? '',
        rank: offset + i + 1,
        playerName: 'Капитан',
        companyName: c?.name ?? '',
        companyLevel: c?.level ?? 1,
        netProfit: e.weekly_earnings ?? 0,
        isCurrentUser: currentCompanyId ? c?.id === currentCompanyId : false,
      };
    });

    res.json({ leaderboard: list });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
