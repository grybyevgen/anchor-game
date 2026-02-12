import { Router, Request, Response } from 'express';
import { config } from '../config.js';

const router = Router();

/**
 * GET /api/telegram/webhook
 * Set webhook (call once with Telegram API).
 */
router.get('/webhook', (_req: Request, res: Response) => {
  res.json({ ok: true, message: 'Use POST to set webhook via Telegram API' });
});

/**
 * POST /api/telegram/webhook
 * Telegram sends updates here. Echo or handle commands.
 */
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const body = req.body as { message?: { text?: string; chat?: { id: number } }; update_id?: number };
    res.status(200).send(); // Always 200 to Telegram

    if (!config.telegram.botToken) return;

    const text = body.message?.text?.trim();
    const chatId = body.message?.chat?.id;
    if (!text || chatId == null) return;

    if (text === '/start') {
      const gameUrl = config.gameUrl || 'https://grybyevgen.github.io/anchor-frontend/';
      await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: `⛵ Добро пожаловать в ANCHOR!\n\nИграть: ${gameUrl}`,
        }),
      });
    }
  } catch (_e) {
    // Already responded 200
  }
});

export default router;
