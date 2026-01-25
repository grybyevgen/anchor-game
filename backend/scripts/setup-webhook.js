/**
 * Скрипт для автоматической настройки webhook для Telegram бота
 * 
 * Использование:
 *   node scripts/setup-webhook.js
 *   или
 *   node scripts/setup-webhook.js https://your-backend-url.com
 */

require('dotenv').config();
const crypto = require('crypto');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_URL = process.argv[2] || process.env.WEBHOOK_URL;
const WEBHOOK_SECRET_TOKEN = process.env.WEBHOOK_SECRET_TOKEN || crypto.randomBytes(16).toString('hex');

if (!TELEGRAM_BOT_TOKEN) {
    console.error('❌ Ошибка: TELEGRAM_BOT_TOKEN не установлен в .env файле');
    process.exit(1);
}

if (!WEBHOOK_URL) {
    console.error('❌ Ошибка: WEBHOOK_URL не установлен');
    console.error('   Установите в .env файле или передайте как аргумент:');
    console.error('   node scripts/setup-webhook.js https://your-backend-url.com');
    process.exit(1);
}

async function setupWebhook() {
    const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
    
    console.log('🔧 Настройка webhook для Telegram бота...');
    console.log(`📡 URL: ${WEBHOOK_URL}`);
    
    if (WEBHOOK_SECRET_TOKEN) {
        console.log(`🔐 Секретный токен: ${WEBHOOK_SECRET_TOKEN}`);
    }

    try {
        const payload = {
            url: WEBHOOK_URL
        };

        if (WEBHOOK_SECRET_TOKEN) {
            payload.secret_token = WEBHOOK_SECRET_TOKEN;
        }

        const response = await fetch(`${TELEGRAM_API_URL}/setWebhook`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (data.ok) {
            console.log('✅ Webhook успешно установлен!');
            console.log(`📋 Информация:`, JSON.stringify(data.result, null, 2));
            
            if (!process.env.WEBHOOK_SECRET_TOKEN && WEBHOOK_SECRET_TOKEN) {
                console.log('\n⚠️  ВАЖНО: Добавьте в ваш .env файл:');
                console.log(`WEBHOOK_SECRET_TOKEN=${WEBHOOK_SECRET_TOKEN}`);
            }
        } else {
            console.error('❌ Ошибка установки webhook:', data.description);
            process.exit(1);
        }
    } catch (error) {
        console.error('❌ Ошибка при установке webhook:', error.message);
        process.exit(1);
    }
}

async function checkWebhook() {
    const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
    
    try {
        const response = await fetch(`${TELEGRAM_API_URL}/getWebhookInfo`);
        const data = await response.json();

        if (data.ok) {
            console.log('\n📊 Текущая информация о webhook:');
            console.log(JSON.stringify(data.result, null, 2));
        }
    } catch (error) {
        console.error('⚠️  Не удалось получить информацию о webhook:', error.message);
    }
}

async function main() {
    await setupWebhook();
    await checkWebhook();
}

main();
