const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');
const User = require('../models/User');
const gameConfig = require('../config/gameConfig');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const GAME_URL = process.env.GAME_URL || 'https://grybyevgen.github.io/anchor-frontend/';

/**
 * Отправка сообщения через Telegram Bot API
 */
async function sendTelegramMessage(chatId, text, replyMarkup = null) {
    if (!TELEGRAM_BOT_TOKEN) {
        console.warn('⚠️  TELEGRAM_BOT_TOKEN не установлен, невозможно отправить сообщение');
        return null;
    }

    try {
        const response = await fetch(`${TELEGRAM_API_URL}/sendMessage`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                chat_id: chatId,
                text: text,
                reply_markup: replyMarkup,
                parse_mode: 'HTML'
            })
        });

        const data = await response.json();
        if (!data.ok) {
            console.error('Ошибка отправки сообщения в Telegram:', data);
            return null;
        }
        return data;
    } catch (error) {
        console.error('Ошибка при отправке сообщения в Telegram:', error);
        return null;
    }
}

/**
 * Валидация webhook через секретный токен (опционально)
 */
function validateWebhook(req, res, next) {
    const secretToken = process.env.WEBHOOK_SECRET_TOKEN;
    
    // Если секретный токен не установлен, пропускаем валидацию
    if (!secretToken) {
        return next();
    }

    const providedToken = req.headers['x-telegram-bot-api-secret-token'];
    
    if (providedToken !== secretToken) {
        return res.status(401).json({
            success: false,
            error: 'Неверный секретный токен'
        });
    }

    next();
}

/**
 * Обработка команды /start
 */
router.post('/webhook', validateWebhook, express.json(), asyncHandler(async (req, res) => {
    const update = req.body;

    // Отвечаем сразу, чтобы Telegram не повторял запрос
    res.status(200).json({ ok: true });

    // Обрабатываем только сообщения
    if (!update.message) {
        return;
    }

    const message = update.message;
    const chatId = message.chat.id;
    const text = message.text || '';
    const user = message.from;

    // Обработка команды /start
    if (text.startsWith('/start')) {
        // Извлекаем реферальный код из команды /start ref_xxx
        const parts = text.split(' ');
        const referralCode = parts.length > 1 ? parts[1] : null;

        // Создаем или обновляем пользователя
        let dbUser = await User.findOne({ telegramId: user.id });
        
        if (!dbUser) {
            // Создаем нового пользователя
            dbUser = await User.create({
                telegramId: user.id,
                username: user.username || user.first_name || 'Игрок',
                firstName: user.first_name,
                lastName: user.last_name,
                coins: gameConfig.initial.userCoins,
                referralCode: referralCode // Сохраняем реферальный код, если есть
            });
        } else {
            // Обновляем информацию о пользователе
            dbUser.username = user.username || dbUser.username;
            dbUser.firstName = user.first_name || dbUser.firstName;
            dbUser.lastName = user.last_name || dbUser.lastName;
            dbUser.lastActive = new Date().toISOString();
            
            // Если у пользователя нет referral_code, создаем его
            if (!dbUser.referralCode) {
                dbUser.referralCode = User.generateReferralCode(dbUser.telegramId);
            }
            
            await dbUser.save();
        }

        // Отправляем приветственное сообщение с кнопкой для открытия игры
        const welcomeText = `🎮 <b>Добро пожаловать в Anchor Game!</b>

🚢 Управляйте своими кораблями, торгуйте товарами и зарабатывайте монеты!

Нажмите кнопку ниже, чтобы начать игру:`;

        const keyboard = {
            inline_keyboard: [[
                {
                    text: '🎮 Открыть игру',
                    web_app: { url: GAME_URL }
                }
            ]]
        };

        await sendTelegramMessage(chatId, welcomeText, keyboard);
    }
}));

/**
 * Установка webhook для Telegram бота
 */
router.post('/set-webhook', asyncHandler(async (req, res) => {
    if (!TELEGRAM_BOT_TOKEN) {
        return res.status(400).json({
            success: false,
            error: 'TELEGRAM_BOT_TOKEN не установлен'
        });
    }

    const webhookUrl = req.body.url || process.env.WEBHOOK_URL;
    if (!webhookUrl) {
        return res.status(400).json({
            success: false,
            error: 'URL webhook не указан. Укажите в body.url или в переменной окружения WEBHOOK_URL'
        });
    }

    try {
        const response = await fetch(`${TELEGRAM_API_URL}/setWebhook`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                url: webhookUrl
            })
        });

        const data = await response.json();
        
        if (data.ok) {
            res.json({
                success: true,
                message: 'Webhook успешно установлен',
                webhookInfo: data.result
            });
        } else {
            res.status(400).json({
                success: false,
                error: data.description || 'Ошибка установки webhook'
            });
        }
    } catch (error) {
        console.error('Ошибка установки webhook:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при установке webhook: ' + error.message
        });
    }
}));

/**
 * Получение информации о webhook
 */
router.get('/webhook-info', asyncHandler(async (req, res) => {
    if (!TELEGRAM_BOT_TOKEN) {
        return res.status(400).json({
            success: false,
            error: 'TELEGRAM_BOT_TOKEN не установлен'
        });
    }

    try {
        const response = await fetch(`${TELEGRAM_API_URL}/getWebhookInfo`);
        const data = await response.json();
        
        res.json({
            success: data.ok,
            webhookInfo: data.result
        });
    } catch (error) {
        console.error('Ошибка получения информации о webhook:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при получении информации о webhook: ' + error.message
        });
    }
}));

module.exports = router;
