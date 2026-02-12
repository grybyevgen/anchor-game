import { Router, Request, Response } from 'express';
import { supabase } from '../db/supabase.js';
import {
  LEVEL_REQUIREMENTS,
  REVENUE_BONUS,
  STARTING_COINS,
  COMPANY_SETUP_BONUS,
} from '../types/index.js';
import { config } from '../config.js';
import { validateTelegramWebAppInitData, getTelegramUserIdFromInitData } from '../services/telegramAuth.js';

const router = Router();

/**
 * POST /api/companies
 * Create company (name). Grants STARTING_COINS + COMPANY_SETUP_BONUS.
 * Body: { name: string }
 * Returns: company + levelRequirements
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name } = req.body as { name?: string };
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Company name is required' });
      return;
    }
    const trimmed = name.trim().slice(0, 30);

    const { data: company, error } = await supabase
      .from('companies')
      .insert({
        name: trimmed,
        level: 1,
        coins: STARTING_COINS + COMPANY_SETUP_BONUS,
        completed_trips: 0,
        total_cargo_units: 0,
      })
      .select()
      .single();

    if (error) {
      console.error('Create company error:', error);
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(201).json({
      company: {
        id: company.id,
        name: company.name,
        level: company.level,
        coins: company.coins,
        completedTrips: company.completed_trips,
        totalCargoUnits: company.total_cargo_units,
      },
      levelRequirements: LEVEL_REQUIREMENTS,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/companies/me
 * Get current company. Header: X-Company-Id
 */
router.get('/me', async (req: Request & { companyId?: string }, res: Response) => {
  try {
    const companyId = req.companyId;
    if (!companyId) {
      res.status(401).json({ error: 'Missing X-Company-Id' });
      return;
    }

    const { data: company, error } = await supabase
      .from('companies')
      .select('id, name, level, coins, completed_trips, total_cargo_units')
      .eq('id', companyId)
      .single();

    if (error || !company) {
      res.status(404).json({ error: 'Company not found' });
      return;
    }

    res.json({
      id: company.id,
      name: company.name,
      level: company.level,
      coins: company.coins,
      completedTrips: company.completed_trips,
      totalCargoUnits: company.total_cargo_units,
      levelRequirements: LEVEL_REQUIREMENTS,
      revenueBonus: REVENUE_BONUS[company.level] ?? 0,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/companies/me/level-up
 * Level up if requirements met. Body: none. Deducts coins and increments level.
 */
router.patch('/me/level-up', async (req: Request & { companyId?: string }, res: Response) => {
  try {
    const companyId = req.companyId;
    if (!companyId) {
      res.status(401).json({ error: 'Missing X-Company-Id' });
      return;
    }

    const { data: company, error: fetchErr } = await supabase
      .from('companies')
      .select('level, coins, completed_trips')
      .eq('id', companyId)
      .single();

    if (fetchErr || !company) {
      res.status(404).json({ error: 'Company not found' });
      return;
    }

    if (company.level >= 5) {
      res.status(400).json({ error: 'Already max level' });
      return;
    }

    const nextReq = LEVEL_REQUIREMENTS[company.level];
    if (!nextReq) {
      res.status(400).json({ error: 'Invalid level' });
      return;
    }
    if (company.completed_trips < nextReq.trips_required || company.coins < nextReq.coins_required) {
      res.status(400).json({
        error: 'Requirements not met',
        required: nextReq,
        current: { trips: company.completed_trips, coins: company.coins },
      });
      return;
    }

    const newLevel = company.level + 1;
    const { data: updated, error: updateErr } = await supabase
      .from('companies')
      .update({
        level: newLevel,
        coins: company.coins - nextReq.coins_required,
      })
      .eq('id', companyId)
      .select()
      .single();

    if (updateErr) {
      res.status(500).json({ error: updateErr.message });
      return;
    }

    res.json({
      company: {
        id: updated.id,
        name: updated.name,
        level: updated.level,
        coins: updated.coins,
        completedTrips: updated.completed_trips,
      },
      levelRequirements: LEVEL_REQUIREMENTS,
      revenueBonus: REVENUE_BONUS[newLevel] ?? 0,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/companies/telegram-auth
 * Авторизация по Telegram Mini App: передать initData, получить companyId если уже привязан.
 * Body: { initData: string }
 */
router.post('/telegram-auth', async (req: Request, res: Response) => {
  try {
    const { initData } = req.body as { initData?: string };
    if (!initData || typeof initData !== 'string') {
      res.status(400).json({ error: 'initData required' });
      return;
    }
    const botToken = config.telegram.botToken;
    if (!botToken) {
      res.status(503).json({ error: 'Telegram auth not configured' });
      return;
    }
    if (!validateTelegramWebAppInitData(initData, botToken)) {
      res.status(401).json({ error: 'Invalid init data' });
      return;
    }
    const telegramUserId = getTelegramUserIdFromInitData(initData);
    if (telegramUserId == null) {
      res.status(400).json({ error: 'User not in init data' });
      return;
    }
    const { data: company, error } = await supabase
      .from('companies')
      .select('id, name, level, coins, completed_trips')
      .eq('telegram_user_id', telegramUserId)
      .single();
    if (error || !company) {
      res.status(404).json({ error: 'No company linked to this Telegram user' });
      return;
    }
    res.json({
      companyId: company.id,
      company: {
        id: company.id,
        name: company.name,
        level: company.level,
        coins: company.coins,
        completedTrips: company.completed_trips,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/companies/link-telegram
 * Привязать текущую компанию к Telegram пользователю. Header: X-Company-Id. Body: { initData: string }
 */
router.post('/link-telegram', async (req: Request & { companyId?: string }, res: Response) => {
  try {
    const companyId = req.companyId;
    if (!companyId) {
      res.status(401).json({ error: 'Missing X-Company-Id' });
      return;
    }
    const { initData } = req.body as { initData?: string };
    if (!initData || typeof initData !== 'string') {
      res.status(400).json({ error: 'initData required' });
      return;
    }
    const botToken = config.telegram.botToken;
    if (!botToken) {
      res.status(503).json({ error: 'Telegram not configured' });
      return;
    }
    if (!validateTelegramWebAppInitData(initData, botToken)) {
      res.status(401).json({ error: 'Invalid init data' });
      return;
    }
    const telegramUserId = getTelegramUserIdFromInitData(initData);
    if (telegramUserId == null) {
      res.status(400).json({ error: 'User not in init data' });
      return;
    }
    const { error } = await supabase
      .from('companies')
      .update({ telegram_user_id: telegramUserId })
      .eq('id', companyId);
    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ error: 'This Telegram account is already linked to another company' });
        return;
      }
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
