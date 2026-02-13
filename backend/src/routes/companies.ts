import { Router, Request, Response } from 'express';
import { supabase } from '../db/supabase.js';
import {
  LEVEL_REQUIREMENTS,
  REVENUE_BONUS,
  STARTING_COINS,
  COMPANY_SETUP_BONUS,
  REFERRAL_REWARD_COINS,
} from '../types/index.js';
import { config } from '../config.js';
import { validateTelegramWebAppInitData, getTelegramUserIdFromInitData, getTelegramUserFromInitData, getStartParamFromInitData } from '../services/telegramAuth.js';
import { addWeeklyEarnings } from '../services/companyEarnings.js';
import { createSessionToken } from '../services/session.js';
import { requireSessionToken } from '../middleware/auth.js';

const router = Router();

/**
 * POST /api/companies
 * Создание компании только с валидным Telegram initData. Сразу привязка к пользователю.
 * Body: { name: string, initData: string }
 * Returns: company + levelRequirements + sessionToken
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, initData } = req.body as { name?: string; initData?: string };
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Company name is required' });
      return;
    }
    if (!initData || typeof initData !== 'string') {
      res.status(400).json({ error: 'initData required. Open the game in Telegram.' });
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
    const tgUser = getTelegramUserFromInitData(initData);
    if (!tgUser) {
      res.status(400).json({ error: 'User not in init data' });
      return;
    }
    const trimmed = name.trim().slice(0, 30);
    const tgFirstName = tgUser.first_name?.trim().slice(0, 64) ?? null;
    const tgLastName = tgUser.last_name?.trim().slice(0, 64) ?? null;

    const referrerId = getStartParamFromInitData(initData);
    let referredByCompanyId: string | null = null;
    if (referrerId && referrerId.trim() && referrerId !== '') {
      const { data: referrer } = await supabase.from('companies').select('id').eq('id', referrerId).single();
      if (referrer) referredByCompanyId = referrer.id;
    }

    const { data: company, error } = await supabase
      .from('companies')
      .insert({
        name: trimmed,
        level: 1,
        coins: STARTING_COINS + COMPANY_SETUP_BONUS,
        completed_trips: 0,
        total_cargo_units: 0,
        telegram_user_id: tgUser.id,
        telegram_first_name: tgFirstName,
        telegram_last_name: tgLastName,
        referred_by_company_id: referredByCompanyId,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ error: 'This Telegram account is already linked to another company' });
        return;
      }
      console.error('Create company error:', error);
      res.status(500).json({ error: error.message });
      return;
    }

    // Реферальная награда: +500 монет пригласившему (как в anchor)
    if (referredByCompanyId && referredByCompanyId !== company.id) {
      const { data: referrer } = await supabase
        .from('companies')
        .select('id, coins')
        .eq('id', referredByCompanyId)
        .single();
      if (referrer) {
        await supabase
          .from('companies')
          .update({ coins: referrer.coins + REFERRAL_REWARD_COINS })
          .eq('id', referredByCompanyId);
        await addWeeklyEarnings(referredByCompanyId, REFERRAL_REWARD_COINS);
      }
    }

    const sessionSecret = config.sessionSecret;
    if (!sessionSecret) {
      res.status(503).json({ error: 'Session not configured' });
      return;
    }
    const sessionToken = createSessionToken(company.id, tgUser.id, sessionSecret);

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
      sessionToken,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/companies/telegram-auth
 * Авторизация по Telegram Mini App. Возвращает sessionToken для последующих запросов.
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
    const sessionSecret = config.sessionSecret;
    if (!sessionSecret) {
      res.status(503).json({ error: 'Session not configured' });
      return;
    }
    const sessionToken = createSessionToken(company.id, telegramUserId, sessionSecret);
    res.json({
      companyId: company.id,
      company: {
        id: company.id,
        name: company.name,
        level: company.level,
        coins: company.coins,
        completedTrips: company.completed_trips,
      },
      sessionToken,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

async function fetchTelegramAvatarByUserId(tgUserId: number, botToken: string, res: Response): Promise<boolean> {
  const photosRes = await fetch(
    `https://api.telegram.org/bot${botToken}/getUserProfilePhotos?user_id=${tgUserId}&limit=1`
  );
  const photosData = (await photosRes.json()) as { ok?: boolean; result?: { photos?: { file_id: string }[][] } };
  if (!photosData?.ok || !photosData.result?.photos?.length) return false;
  const fileId = photosData.result.photos[0][0]?.file_id;
  if (!fileId) return false;
  const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
  const fileData = (await fileRes.json()) as { ok?: boolean; result?: { file_path?: string } };
  if (!fileData?.ok || !fileData.result?.file_path) return false;
  const imageUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;
  const imageRes = await fetch(imageUrl);
  if (!imageRes.ok) return false;
  const contentType = imageRes.headers.get('content-type') || 'image/jpeg';
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  const buffer = Buffer.from(await imageRes.arrayBuffer());
  res.send(buffer);
  return true;
}

/**
 * GET /api/companies/:id/avatar
 * Фото профиля Telegram компании (для рейтинга). Публичный.
 */
router.get('/:id/avatar', async (req: Request, res: Response) => {
  try {
    const companyId = req.params.id;
    const botToken = config.telegram.botToken;
    if (!botToken) {
      res.status(503).send();
      return;
    }
    const { data: company, error } = await supabase
      .from('companies')
      .select('telegram_user_id')
      .eq('id', companyId)
      .single();
    if (error || !company?.telegram_user_id) {
      res.status(404).send();
      return;
    }
    const ok = await fetchTelegramAvatarByUserId(company.telegram_user_id as number, botToken, res);
    if (!ok) res.status(404).send();
  } catch (e) {
    console.error(e);
    res.status(500).send();
  }
});

/**
 * GET /api/companies/me/telegram-photo
 * Фото профиля Telegram текущего пользователя (прокси, чтобы не светить bot token).
 */
router.get('/me/telegram-photo', requireSessionToken, async (req: Request & { companyId?: string }, res: Response) => {
  try {
    const companyId = req.companyId!;
    const botToken = config.telegram.botToken;
    if (!botToken) {
      res.status(503).json({ error: 'Telegram not configured' });
      return;
    }
    const { data: company, error } = await supabase
      .from('companies')
      .select('telegram_user_id')
      .eq('id', companyId)
      .single();
    if (error || !company?.telegram_user_id) {
      res.status(404).send();
      return;
    }
    const ok = await fetchTelegramAvatarByUserId(company.telegram_user_id as number, botToken, res);
    if (!ok) res.status(404).send();
  } catch (e) {
    console.error(e);
    res.status(500).send();
  }
});

/**
 * GET /api/companies/me/referral-link
 * Реферальная ссылка (как в anchor). Backend собирает ссылку — на фронте не нужны env.
 */
router.get('/me/referral-link', requireSessionToken, async (req: Request & { companyId?: string }, res: Response) => {
  try {
    const companyId = req.companyId!;
    const botUsername = config.telegram.botUsername;
    const appShortName = config.telegram.appShortName;
    const gameUrl = config.gameUrl || 'https://anchor-game.com';

    const referralLink =
      botUsername && appShortName
        ? `https://t.me/${botUsername}/${appShortName}?startapp=${companyId}`
        : `${gameUrl.replace(/\/$/, '')}/ref/${companyId}`;

    res.json({ referralLink, referralCode: companyId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/companies/me
 * Текущая компания по сессионному токену (только через Telegram).
 */
router.get('/me', requireSessionToken, async (req: Request & { companyId?: string }, res: Response) => {
  try {
    const companyId = req.companyId!;

    const { getWeeklyEarnings } = await import('../services/companyEarnings.js');
    const { data: company, error } = await supabase
      .from('companies')
      .select('id, name, level, coins, completed_trips, total_cargo_units')
      .eq('id', companyId)
      .single();

    if (error || !company) {
      res.status(404).json({ error: 'Company not found' });
      return;
    }

    const weeklyEarned = await getWeeklyEarnings(companyId);

    res.json({
      id: company.id,
      name: company.name,
      level: company.level,
      coins: company.coins,
      completedTrips: company.completed_trips,
      totalCargoUnits: company.total_cargo_units,
      weeklyEarned,
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
 * Level up if requirements met. Требуется сессия (Telegram).
 */
router.patch('/me/level-up', requireSessionToken, async (req: Request & { companyId?: string }, res: Response) => {
  try {
    const companyId = req.companyId!;

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
 * POST /api/companies/link-telegram
 * Привязать текущую компанию (по сессии) к Telegram. Требуется сессия.
 */
router.post('/link-telegram', requireSessionToken, async (req: Request & { companyId?: string }, res: Response) => {
  try {
    const companyId = req.companyId!;
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
    const tgUser = getTelegramUserFromInitData(initData);
    if (!tgUser) {
      res.status(400).json({ error: 'User not in init data' });
      return;
    }
    const tgFirstName = tgUser.first_name?.trim().slice(0, 64) ?? null;
    const tgLastName = tgUser.last_name?.trim().slice(0, 64) ?? null;
    const { error } = await supabase
      .from('companies')
      .update({
        telegram_user_id: tgUser.id,
        telegram_first_name: tgFirstName,
        telegram_last_name: tgLastName,
      })
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
