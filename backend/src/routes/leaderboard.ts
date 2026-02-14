import { Router, Request, Response } from 'express';
import { supabase } from '../db/supabase.js';
import { optionalCompanyId } from '../middleware/auth.js';

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
 * Overall: companies by total_earned (кумулятивный заработок, как total_earnings в anchor).
 * Query: ?limit=20&offset=0
 */
router.get('/', async (req: Request & { companyId?: string }, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const { data: companies, error } = await supabase
      .from('companies')
      .select('id, name, level, total_earned, telegram_first_name, telegram_last_name')
      .order('total_earned', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const currentCompanyId = req.companyId;
    type CompanyRow = { id: string; name: string; level: number; total_earned?: number; telegram_first_name?: string | null; telegram_last_name?: string | null };
    const list = (companies || []).map((c: CompanyRow, i: number) => ({
      id: c.id,
      rank: offset + i + 1,
      playerName: formatPlayerName(c.telegram_first_name, c.telegram_last_name),
      companyName: c.name,
      companyLevel: c.level,
      netProfit: c.total_earned ?? 0,
      isCurrentUser: currentCompanyId ? c.id === currentCompanyId : false,
    }));

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
 * Друзья = текущий пользователь + приглашённые им + пригласивший его (как в anchor).
 * Сортировка по weekly_earnings за текущую неделю.
 */
router.get('/friends', async (req: Request & { companyId?: string }, res: Response) => {
  try {
    const currentCompanyId = req.companyId;
    if (!currentCompanyId) {
      res.json({ leaderboard: [] });
      return;
    }

    const weekStartDate = getWeekStartDate();

    // Собираем ID друзей: текущий + приглашённые + пригласивший
    const friendIds = new Set<string>([currentCompanyId]);

    const { data: referred } = await supabase
      .from('companies')
      .select('id')
      .eq('referred_by_company_id', currentCompanyId);
    (referred || []).forEach((r: { id: string }) => friendIds.add(r.id));

    const { data: currentCompany } = await supabase
      .from('companies')
      .select('referred_by_company_id')
      .eq('id', currentCompanyId)
      .single();
    if (currentCompany?.referred_by_company_id) {
      friendIds.add(currentCompany.referred_by_company_id);
    }

    if (friendIds.size === 0) {
      res.json({ leaderboard: [] });
      return;
    }

    const { data: earnings, error } = await supabase
      .from('company_earnings')
      .select(`
        weekly_earnings,
        companies:company_id (id, name, level, telegram_first_name, telegram_last_name)
      `)
      .in('company_id', Array.from(friendIds))
      .eq('week_start_date', weekStartDate)
      .order('weekly_earnings', { ascending: false });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    type Company = { id: string; name: string; level: number; telegram_first_name?: string | null; telegram_last_name?: string | null };
    type Row = { weekly_earnings: number; companies: Company | Company[] | null };
    let list = (earnings || []).map((e: Row, i: number) => {
      const raw = e.companies;
      const c = Array.isArray(raw) ? raw[0] ?? null : raw;
      return {
        id: c?.id ?? '',
        rank: i + 1,
        playerName: c ? formatPlayerName(c.telegram_first_name, c.telegram_last_name) : 'Капитан',
        companyName: c?.name ?? '',
        companyLevel: c?.level ?? 1,
        netProfit: e.weekly_earnings ?? 0,
        isCurrentUser: c?.id === currentCompanyId,
        isFriend: c?.id !== currentCompanyId,
      };
    });

    // Добавляем текущего пользователя, если его нет (нет записи в company_earnings за эту неделю)
    const currentInList = list.some((p: { id: string }) => p.id === currentCompanyId);
    if (!currentInList) {
      const { data: curCompany } = await supabase
        .from('companies')
        .select('id, name, level, telegram_first_name, telegram_last_name')
        .eq('id', currentCompanyId)
        .single();
      if (curCompany) {
        list.push({
          id: curCompany.id,
          rank: list.length + 1,
          playerName: formatPlayerName(curCompany.telegram_first_name, curCompany.telegram_last_name),
          companyName: curCompany.name,
          companyLevel: curCompany.level,
          netProfit: 0,
          isCurrentUser: true,
          isFriend: false,
        });
        list.sort((a: { netProfit: number }, b: { netProfit: number }) => b.netProfit - a.netProfit);
        list = list.map((p, i) => ({ ...p, rank: i + 1 }));
      }
    }

    res.json({ leaderboard: list });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
