const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');
const User = require('../models/User');
const { getSupabase, withRetry } = require('../config/database');

// Получение реферальной ссылки пользователя
router.get('/link', asyncHandler(async (req, res) => {
    let userId = req.query.userId || req.userId;
    
    if (!userId) {
        return res.status(400).json({
            success: false,
            error: 'Необходимо указать userId'
        });
    }

    // Если userId - это telegramId (число), нужно найти пользователя в базе
    let user;
    if (String(userId).match(/^[0-9]+$/)) {
        user = await User.findOne({ telegramId: parseInt(userId) });
    } else {
        user = await User.findById(userId);
    }

    if (!user) {
        return res.status(404).json({
            success: false,
            error: 'Пользователь не найден'
        });
    }

    // Если у пользователя еще нет реферального кода, создаем его
    if (!user.referralCode) {
        user.referralCode = User.generateReferralCode(user.telegramId);
        await user.save();
    }

    // Формируем реферальную ссылку
    const botUsername = process.env.TELEGRAM_BOT_USERNAME || 'seashipping_bot';
    const referralLink = `https://t.me/${botUsername}?start=${user.referralCode}`;

    res.json({
        success: true,
        referralCode: user.referralCode,
        referralLink
    });
}));

// Получение статистики рефералов
router.get('/stats', asyncHandler(async (req, res) => {
    let userId = req.query.userId || req.userId;
    const supabase = getSupabase();

    if (!userId) {
        return res.status(400).json({
            success: false,
            error: 'Необходимо указать userId'
        });
    }

    // Если userId - это telegramId (число), нужно найти пользователя в базе
    if (String(userId).match(/^[0-9]+$/)) {
        const user = await User.findOne({ telegramId: parseInt(userId) });
        if (user) {
            userId = user.id;
        } else {
            return res.status(404).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
    }

    try {
        // Получаем количество рефералов
        const { data: referrals, error: refError } = await withRetry(async () => {
            return await supabase
                .from('referrals')
                .select('id')
                .eq('referrer_id', userId);
        });

        if (refError) {
            throw refError;
        }

        const referralCount = referrals ? referrals.length : 0;

        res.json({
            success: true,
            referralCount,
            bonusPerReferral: 100
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Ошибка получения статистики рефералов'
        });
    }
}));

module.exports = router;
