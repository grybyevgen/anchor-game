import 'dotenv/config';

export const config = {
  supabase: {
    url: process.env.SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  },
  port: parseInt(process.env.PORT || '3000', 10),
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    webhookUrl: process.env.WEBHOOK_URL,
    botUsername: process.env.TELEGRAM_BOT_USERNAME || '',
    appShortName: process.env.TELEGRAM_APP_SHORT_NAME || 'anchor',
  },
  gameUrl: process.env.GAME_URL || '',
  sessionSecret: process.env.SESSION_SECRET || '',
};
