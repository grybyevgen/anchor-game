import { Request, Response, NextFunction } from 'express';
import { verifySessionToken } from '../services/session.js';
import { config } from '../config.js';

export type CompanyIdLocals = { companyId?: string };

/**
 * Require valid session token (issued after Telegram auth).
 * Reads Authorization: Bearer <token> or X-Session-Token.
 * Игра доступна только через Telegram — без токена запрос отклоняется.
 */
export function requireSessionToken(
  req: Request & { companyId?: string },
  res: Response,
  next: NextFunction
): void {
  const secret = config.sessionSecret;
  if (!secret) {
    res.status(503).json({ error: 'Session not configured' });
    return;
  }
  const raw =
    (req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null) ?? (req.headers['x-session-token'] as string | undefined);
  const payload = raw ? verifySessionToken(raw, secret) : null;
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired session. Open the game in Telegram.' });
    return;
  }
  req.companyId = payload.companyId;
  next();
}

/**
 * Resolve company from header X-Company-Id (legacy / optional).
 * @deprecated Use requireSessionToken for game endpoints.
 */
export function requireCompanyId(
  req: Request & { companyId?: string },
  res: Response,
  next: NextFunction
): void {
  const companyId = req.headers['x-company-id'] as string | undefined;
  if (!companyId) {
    res.status(401).json({ error: 'Missing X-Company-Id header' });
    return;
  }
  req.companyId = companyId;
  next();
}

/**
 * Optional: resolve company from session token or X-Company-Id (for leaderboard current user).
 */
export function optionalCompanyId(
  req: Request & { companyId?: string },
  _res: Response,
  next: NextFunction
): void {
  const secret = config.sessionSecret;
  const raw =
    (req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null) ?? (req.headers['x-session-token'] as string | undefined);
  const payload = raw && secret ? verifySessionToken(raw, secret) : null;
  req.companyId = payload?.companyId ?? (req.headers['x-company-id'] as string | undefined);
  next();
}
