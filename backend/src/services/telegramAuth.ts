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
