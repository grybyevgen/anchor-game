const express = require('express');
const router = express.Router();
const Ship = require('../models/Ship');
const User = require('../models/User');
const Port = require('../models/Port');
const gameConfig = require('../config/gameConfig');
const { sendShipToPort, loadCargo, unloadCargo, repairShip, refuelShip, checkAndCompleteTravels, checkShipTravel } = require('../game-logic/shipManager');
const { asyncHandler, handleSupabaseError } = require('../middleware/errorHandler');
const { validateBuyShip, validateTravel, validateLoadCargo, validateUUID } = require('../middleware/validation');

// Получить все судна пользователя
router.get('/user/:userId', asyncHandler(async (req, res) => {
    const { userId } = req.params;
    
    let user;
    if (userId.match(/^[0-9]+$/)) {
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
    
    // Проверяем завершенные путешествия перед загрузкой
    await checkAndCompleteTravels();
    
    const ships = await Ship.find({ userId: user.id });
    res.json({ success: true, ships });
}));

// Купить судно
router.post('/buy', validateBuyShip, asyncHandler(async (req, res) => {
    const { userId, type } = req.body;
    
    const price = gameConfig.shipPrices[type];
    if (!price) {
        return res.status(400).json({ success: false, error: 'Неверный тип судна' });
    }
    
    // Находим пользователя
    let user;
    if (userId.match(/^[0-9]+$/)) {
        user = await User.findOne({ telegramId: parseInt(userId) });
    } else {
        user = await User.findById(userId);
    }
    
    if (!user) {
        return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }
    
    // Проверяем баланс
    if (user.coins < price) {
        return res.status(400).json({ success: false, error: 'Недостаточно монет' });
    }
    
    // Получаем стартовый порт
    const ports = await Port.findAll();
    if (ports.length === 0) {
        return res.status(500).json({ success: false, error: 'Порты не инициализированы' });
    }
    
    try {
        // Создаем судно
        const newShip = await Ship.create({
            userId: user.id,
            type,
            name: `${gameConfig.shipNames[type]} #${Date.now()}`,
            currentPortId: ports[0].id,
            fuel: gameConfig.initial.shipFuel,
            maxFuel: gameConfig.initial.shipMaxFuel,
            health: gameConfig.initial.shipHealth,
            maxHealth: gameConfig.initial.shipMaxHealth,
            crewLevel: gameConfig.initial.shipCrewLevel
        });
        
        // Списываем монеты
        await user.spendCoins(price);
        
        res.json({ success: true, ship: newShip });
    } catch (error) {
        const handledError = handleSupabaseError(error);
        throw handledError || error;
    }
}));

// Отправить судно в порт
router.post('/:shipId/travel', validateTravel, asyncHandler(async (req, res) => {
    const { shipId } = req.params;
    const { portId } = req.body;
    
    // Проверяем завершенные путешествия перед отправкой
    await checkAndCompleteTravels();
    
    const result = await sendShipToPort(shipId, portId);
    res.json(result);
}));

// Загрузить груз
router.post('/:shipId/load', validateLoadCargo, asyncHandler(async (req, res) => {
    const { shipId } = req.params;
    const { cargoType, amount } = req.body;
    
    // Проверяем завершенные путешествия перед загрузкой
    await checkShipTravel(shipId);
    
    const result = await loadCargo(shipId, cargoType, amount);
    res.json(result);
}));

// Выгрузить груз
router.post('/:shipId/unload', validateUUID('shipId'), asyncHandler(async (req, res) => {
    const { shipId } = req.params;
    
    // Проверяем завершенные путешествия перед выгрузкой
    await checkShipTravel(shipId);
    
    const result = await unloadCargo(shipId);
    res.json(result);
}));

// Починить судно
router.post('/:shipId/repair', validateUUID('shipId'), asyncHandler(async (req, res) => {
    const { shipId } = req.params;
    
    // Проверяем завершенные путешествия перед ремонтом
    await checkShipTravel(shipId);
    
    const result = await repairShip(shipId);
    res.json(result);
}));

// Заправить судно (бункеровка)
router.post('/:shipId/refuel', validateUUID('shipId'), asyncHandler(async (req, res) => {
    const { shipId } = req.params;
    const { cargoId, amount } = req.body;
    
    if (!cargoId) {
        return res.status(400).json({ success: false, error: 'cargoId обязателен' });
    }
    
    if (!amount || amount <= 0) {
        return res.status(400).json({ success: false, error: 'amount должен быть больше 0' });
    }
    
    // Проверяем завершенные путешествия перед заправкой
    await checkShipTravel(shipId);
    
    const result = await refuelShip(shipId, cargoId, amount);
    res.json(result);
}));

// Проверить завершенные путешествия (для всех судов)
router.post('/check-travels', asyncHandler(async (req, res) => {
    const result = await checkAndCompleteTravels();
    res.json({ success: true, ...result });
}));

// Проверить конкретное судно
router.get('/:shipId/check-travel', validateUUID('shipId'), asyncHandler(async (req, res) => {
    const { shipId } = req.params;
    const result = await checkShipTravel(shipId);
    res.json(result);
}));

module.exports = router;
