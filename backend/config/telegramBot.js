/**
 * Конфигурация Telegram-бота.
 * Username берётся из TELEGRAM_BOT_USERNAME или из getMe по токену.
 */

let _cachedUsername = null;

/**
 * Возвращает username бота для реферальных ссылок (без @).
 * Сначала проверяет TELEGRAM_BOT_USERNAME, иначе запрашивает getMe.
 * @returns {Promise<string>}
 */
async function getBotUsername() {
    const fromEnv = process.env.TELEGRAM_BOT_USERNAME?.trim();
    if (fromEnv) {
        return fromEnv.replace(/^@/, '');
    }

    if (_cachedUsername) {
        return _cachedUsername;
    }

    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
        console.warn('⚠️  TELEGRAM_BOT_TOKEN не задан, реферальная ссылка будет с seashipping_bot');
        return 'seashipping_bot';
    }

    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
        const data = await res.json();
        if (data?.ok && data?.result?.username) {
            _cachedUsername = data.result.username;
            console.log('✅ Username бота для реферальных ссылок:', _cachedUsername);
            return _cachedUsername;
        }
    } catch (e) {
        console.warn('⚠️  Не удалось получить username бота через getMe:', e.message);
    }

    console.warn('⚠️  Используем fallback seashipping_bot для реферальной ссылки');
    return 'seashipping_bot';
}

/**
 * Синхронно возвращает закэшированный username или fallback.
 * Используйте getBotUsername() при первой инициализации.
 */
function getBotUsernameSync() {
    const fromEnv = process.env.TELEGRAM_BOT_USERNAME?.trim();
    if (fromEnv) return fromEnv.replace(/^@/, '');
    return _cachedUsername || 'seashipping_bot';
}

function setCachedUsername(username) {
    _cachedUsername = username ? username.replace(/^@/, '') : null;
}

module.exports = {
    getBotUsername,
    getBotUsernameSync,
    setCachedUsername
};
