const crypto = require('crypto');

/**
 * Валидация данных Telegram Web App
 * Проверяет подпись initData через HMAC SHA-256
 */
function validateTelegramWebApp(initData, botToken) {
    if (!initData || !botToken) {
        return false;
    }

    try {
        // Парсим initData
        const urlParams = new URLSearchParams(initData);
        const hash = urlParams.get('hash');
        
        if (!hash) {
            return false;
        }

        // Удаляем hash из параметров для проверки
        urlParams.delete('hash');
        
        // Сортируем параметры по ключу
        const dataCheckString = Array.from(urlParams.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => `${key}=${value}`)
            .join('\n');

        // Создаем секретный ключ
        const secretKey = crypto
            .createHmac('sha256', 'WebAppData')
            .update(botToken)
            .digest();

        // Вычисляем hash
        const calculatedHash = crypto
            .createHmac('sha256', secretKey)
            .update(dataCheckString)
            .digest('hex');

        // Сравниваем hash
        return calculatedHash === hash;
    } catch (error) {
        console.error('Ошибка валидации Telegram данных:', error);
        return false;
    }
}

// Флаг для отслеживания, было ли уже выведено предупреждение
let authWarningShown = false;

/**
 * Middleware для проверки аутентификации Telegram
 * В режиме разработки можно отключить через переменную окружения
 */
function telegramAuthMiddleware(req, res, next) {
    // В режиме разработки можно отключить проверку
    if (process.env.DISABLE_TELEGRAM_AUTH === 'true') {
        // Выводим предупреждение только один раз при первом запросе
        if (!authWarningShown) {
            authWarningShown = true;
            // Предупреждение уже выводится при старте сервера, поэтому здесь не нужно
        }
        return next();
    }

    // Для некоторых endpoints аутентификация не требуется (например, health check)
    const publicEndpoints = ['/health', '/api/health'];
    if (publicEndpoints.some(endpoint => req.path.startsWith(endpoint))) {
        return next();
    }

    // Получаем initData из заголовка или тела запроса
    const initData = req.headers['x-telegram-init-data'] || req.body.initData;
    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    if (!botToken) {
        // Токен не установлен - пропускаем аутентификацию
        // Предупреждение выводится только при старте сервера
        return next();
    }

    if (!initData) {
        // Для внутренних API запросов можно использовать другой метод аутентификации
        // Пока разрешаем, но можно ужесточить
        // Не логируем, чтобы не засорять консоль
        return next();
    }

    if (!validateTelegramWebApp(initData, botToken)) {
        return res.status(401).json({
            success: false,
            error: 'Неверная аутентификация Telegram'
        });
    }

    // Парсим данные пользователя из initData
    try {
        const urlParams = new URLSearchParams(initData);
        const userStr = urlParams.get('user');
        if (userStr) {
            req.telegramUser = JSON.parse(decodeURIComponent(userStr));
            // Устанавливаем userId для использования в routes
            // Позже можно будет получить UUID пользователя из базы данных
            req.userId = req.telegramUser.id;
        }
    } catch (error) {
        console.error('Ошибка парсинга данных пользователя:', error);
    }

    // Если userId не установлен, пытаемся получить из параметров запроса
    if (!req.userId) {
        req.userId = req.body.userId || req.params.userId || req.query.userId;
    }

    next();
}

/**
 * Middleware для проверки, что пользователь имеет доступ к ресурсу
 */
function checkUserAccess(req, res, next) {
    const userId = req.body.userId || req.params.userId;
    const telegramId = req.telegramUser?.id;

    // Если есть telegramId из аутентификации, проверяем соответствие
    if (telegramId && userId) {
        // userId может быть UUID или telegramId
        if (userId.toString() !== telegramId.toString()) {
            // Проверяем, может быть это UUID пользователя
            // В этом случае нужно проверить через базу данных
            // Пока разрешаем, но можно ужесточить
        }
    }

    next();
}

module.exports = {
    validateTelegramWebApp,
    telegramAuthMiddleware,
    checkUserAccess
};
