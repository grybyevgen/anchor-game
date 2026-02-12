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
  },
  gameUrl: process.env.GAME_URL || '',
  sessionSecret: process.env.SESSION_SECRET || '',
};
