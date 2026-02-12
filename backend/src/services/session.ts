/**
 * Сессионный токен после успешной авторизации через Telegram.
 * Подписывается секретом, фронт не хранит ничего постоянного — только токен в памяти.
 */

import crypto from 'crypto';

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 дней
const SEP = '.';

export interface SessionPayload {
  companyId: string;
  telegramUserId: number;
  exp: number;
}

export function createSessionToken(
  companyId: string,
  telegramUserId: number,
  secret: string
): string {
  if (!secret) throw new Error('SESSION_SECRET required');
  const exp = Date.now() + TOKEN_TTL_MS;
  const payload: SessionPayload = { companyId, telegramUserId, exp };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}${SEP}${sig}`;
}

export function verifySessionToken(token: string, secret: string): SessionPayload | null {
  if (!token || !secret) return null;
  const i = token.lastIndexOf(SEP);
  if (i <= 0) return null;
  const payloadB64 = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  if (sig !== expectedSig) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8')
    ) as SessionPayload;
    if (typeof payload.companyId !== 'string' || typeof payload.telegramUserId !== 'number' || typeof payload.exp !== 'number') return null;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
