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

function formatPlayerName(firstName?: string | null, lastName?: string | null): string {
  const first = (firstName ?? '').trim();
  const last = (lastName ?? '').trim();
  const name = [first, last].filter(Boolean).join(' ').trim();
  return name || 'Капитан';
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
      .select('id, name, level, coins, telegram_first_name, telegram_last_name')
      .order('coins', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const currentCompanyId = req.companyId;
    const list = (companies || []).map((c: { id: string; name: string; level: number; coins: number; telegram_first_name?: string | null; telegram_last_name?: string | null }, i: number) => {
      const earnedCoins = Math.max(0, c.coins - INITIAL_BALANCE);
      return {
        id: c.id,
        rank: offset + i + 1,
        playerName: formatPlayerName(c.telegram_first_name, c.telegram_last_name),
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
        companies:company_id (id, name, level, telegram_first_name, telegram_last_name)
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
    type Company = { id: string; name: string; level: number; telegram_first_name?: string | null; telegram_last_name?: string | null };
    type Row = { weekly_earnings: number; companies: Company | Company[] | null };
    const list = (earnings || []).map((e: Row, i: number) => {
      const raw = e.companies;
      const c = Array.isArray(raw) ? raw[0] ?? null : raw;
      return {
        id: c?.id ?? '',
        rank: offset + i + 1,
        playerName: c ? formatPlayerName(c.telegram_first_name, c.telegram_last_name) : 'Капитан',
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

/**
 * GET /api/leaderboard/friends
 * Друзья = компании, приглашённые текущим пользователем (referred_by_company_id = current).
 * Сортировка по заработанным монетам.
 */
router.get('/friends', async (req: Request & { companyId?: string }, res: Response) => {
  try {
    const currentCompanyId = req.companyId;
    if (!currentCompanyId) {
      res.json({ leaderboard: [] });
      return;
    }

    const { data: companies, error } = await supabase
      .from('companies')
      .select('id, name, level, coins, telegram_first_name, telegram_last_name')
      .eq('referred_by_company_id', currentCompanyId)
      .order('coins', { ascending: false });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const list = (companies || []).map((c: { id: string; name: string; level: number; coins: number; telegram_first_name?: string | null; telegram_last_name?: string | null }, i: number) => {
      const earnedCoins = Math.max(0, c.coins - INITIAL_BALANCE);
      return {
        id: c.id,
        rank: i + 1,
        playerName: formatPlayerName(c.telegram_first_name, c.telegram_last_name),
        companyName: c.name,
        companyLevel: c.level,
        netProfit: earnedCoins,
        isCurrentUser: false,
        isFriend: true,
      };
    });

    res.json({ leaderboard: list });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
