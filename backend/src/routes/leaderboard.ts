import { Router, Request, Response } from 'express';
import { supabase } from '../db/supabase.js';
import { optionalCompanyId } from '../middleware/auth.js';

const router = Router();
router.use(optionalCompanyId);

/**
 * GET /api/leaderboard
 * List companies by coins (net profit) for leaderboard.
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
    const list = (companies || []).map((c, i) => ({
      id: c.id,
      rank: offset + i + 1,
      playerName: 'Капитан',
      companyName: c.name,
      companyLevel: c.level,
      netProfit: c.coins,
      isCurrentUser: currentCompanyId ? c.id === currentCompanyId : false,
    }));

    res.json({ leaderboard: list });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
