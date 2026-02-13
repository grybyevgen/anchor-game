/**
 * Валидация initData от Telegram Web App.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */

import crypto from 'crypto';

export function validateTelegramWebAppInitData(initData: string, botToken: string): boolean {
  if (!initData || !botToken) return false;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return false;
  params.delete('hash');
  const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = sorted.map(([k, v]) => `${k}=${v}`).join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  return computedHash === hash;
}

export function getTelegramUserIdFromInitData(initData: string): number | null {
  try {
    const params = new URLSearchParams(initData);
    const userStr = params.get('user');
    if (!userStr) return null;
    const user = JSON.parse(userStr) as { id?: number };
    return typeof user?.id === 'number' ? user.id : null;
  } catch {
    return null;
  }
}

/** Данные пользователя из initData (first_name, last_name, username). */
export function getTelegramUserFromInitData(
  initData: string
): { id: number; first_name?: string; last_name?: string; username?: string } | null {
  try {
    const params = new URLSearchParams(initData);
    const userStr = params.get('user');
    if (!userStr) return null;
    const user = JSON.parse(userStr) as { id?: number; first_name?: string; last_name?: string; username?: string };
    if (typeof user?.id !== 'number') return null;
    return {
      id: user.id,
      first_name: typeof user.first_name === 'string' ? user.first_name : undefined,
      last_name: typeof user.last_name === 'string' ? user.last_name : undefined,
      username: typeof user.username === 'string' ? user.username : undefined,
    };
  } catch {
    return null;
  }
}

/** start_param из initData (при открытии Mini App через ?startapp=REFERRER_ID). */
export function getStartParamFromInitData(initData: string): string | null {
  try {
    const params = new URLSearchParams(initData);
    const startParam = params.get('start_param');
    return startParam && startParam.trim().length > 0 ? startParam.trim() : null;
  } catch {
    return null;
  }
}
