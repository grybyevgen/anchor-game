const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');
const UserEarnings = require('../models/UserEarnings');
const User = require('../models/User');

// Получение рейтинга
router.get('/', asyncHandler(async (req, res) => {
    const { type = 'total', limit = 20, userId: queryUserId } = req.query;
    
    // Получаем userId из запроса или из middleware
    let userId = queryUserId || req.userId;
    
    // Если userId - это telegramId (число), нужно найти пользователя в базе
    if (userId && String(userId).match(/^[0-9]+$/)) {
        const user = await User.findOne({ telegramId: parseInt(userId) });
        if (user) {
            userId = user.id;
        }
    }

    if (!['total', 'weekly', 'friends'].includes(type)) {
        return res.status(400).json({
            success: false,
            error: 'Неверный тип рейтинга. Допустимые значения: total, weekly, friends'
        });
    }

    let players = [];
    
    if (type === 'friends') {
        if (!userId) {
            return res.status(400).json({
                success: false,
                error: 'Необходимо указать userId для рейтинга друзей'
            });
        }
        players = await UserEarnings.getFriendsRating(userId, parseInt(limit));
    } else {
        players = await UserEarnings.getTopPlayers(type, parseInt(limit), userId);
    }

    // Получаем данные текущего пользователя
    let myEarnings = { totalEarnings: 0, weeklyEarnings: 0 };
    if (userId) {
        try {
            const userEarnings = await UserEarnings.findOrCreate(userId);
            myEarnings = {
                totalEarnings: userEarnings.totalEarnings,
                weeklyEarnings: userEarnings.weeklyEarnings
            };
        } catch (error) {
            console.error('Ошибка получения заработка пользователя:', error);
        }
    }

    // Добавляем позиции
    const playersWithPositions = players.map((player, index) => ({
        ...player,
        position: index + 1
    }));

    res.json({
        success: true,
        type,
        players: playersWithPositions,
        myEarnings
    });
}));

// Получение заработка текущего пользователя
router.get('/my-earnings', asyncHandler(async (req, res) => {
    let userId = req.query.userId || req.userId;
    
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
        const userEarnings = await UserEarnings.findOrCreate(userId);
        res.json({
            success: true,
            totalEarnings: userEarnings.totalEarnings,
            weeklyEarnings: userEarnings.weeklyEarnings
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Ошибка получения заработка'
        });
    }
}));

module.exports = router;
