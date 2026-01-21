const express = require('express');
const router = express.Router();
const Ship = require('../models/Ship');
const User = require('../models/User');
const Port = require('../models/Port');
const gameConfig = require('../config/gameConfig');
const { sendShipToPort, loadCargo, unloadCargo, repairShip, refuelShip, towShip, checkAndCompleteTravels, checkShipTravel } = require('../game-logic/shipManager');
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

// Получить цену судна для пользователя (без покупки)
router.get('/price/:userId/:type', asyncHandler(async (req, res) => {
    const { userId, type } = req.params;
    
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

    const basePrice = gameConfig.shipPrices[type];
    if (!basePrice) {
        return res.status(400).json({ success: false, error: 'Неверный тип судна' });
    }

    // Считаем количество судов данного типа
    const existingShips = await Ship.find({ userId: user.id });
    const shipsOfType = existingShips.filter(ship => ship.type === type);
    const shipsCount = shipsOfType.length;

    // Рассчитываем прогрессивную цену: базовая_цена × 10^количество
    const price = basePrice * Math.pow(10, shipsCount);
    
    res.json({
        success: true,
        type,
        typeName: gameConfig.shipNames[type],
        basePrice,
        currentPrice: price,
        existingShipsCount: shipsCount,
        nextShipNumber: shipsCount + 1
    });
}));

// Купить судно
router.post('/buy', validateBuyShip, asyncHandler(async (req, res) => {
    const { userId, type } = req.body;
    
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

    // Получаем базовую цену из конфига
    const basePrice = gameConfig.shipPrices[type];
    if (!basePrice) {
        return res.status(400).json({ success: false, error: 'Неверный тип судна' });
    }

    // Считаем количество судов данного типа у пользователя
    const existingShips = await Ship.find({ userId: user.id });
    const shipsOfType = existingShips.filter(ship => ship.type === type);
    const shipsCount = shipsOfType.length;

    // Рассчитываем прогрессивную цену: базовая_цена × 10^количество
    const price = basePrice * Math.pow(10, shipsCount);
    
    // Проверяем баланс
    if (user.coins < price) {
        return res.status(400).json({ 
            success: false, 
            error: `Недостаточно монет. Требуется: ${price} монет (${shipsCount + 1}-е судно типа "${gameConfig.shipNames[type]}")` 
        });
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
            crewLevel: gameConfig.initial.shipCrewLevel,
            purchasePrice: price
        });
        
        // Списываем монеты
        await user.spendCoins(price);
        
        res.json({ 
            success: true, 
            ship: newShip,
            price: price,
            basePrice: basePrice,
            shipNumber: shipsCount + 1  // Номер покупаемого судна
        });
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
    const { destination } = req.body; // Всегда 'port' (рынок удален)
    
    // Проверяем завершенные путешествия перед выгрузкой
    await checkShipTravel(shipId);
    
    const result = await unloadCargo(shipId, destination || 'port');
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

// Заправить судно (бункеровка) - теперь из порта
router.post('/:shipId/refuel', validateUUID('shipId'), asyncHandler(async (req, res) => {
    const { shipId } = req.params;
    const { cargoType, amount } = req.body; // cargoType должен быть 'oil', amount - количество
    
    if (!cargoType || cargoType !== 'oil') {
        return res.status(400).json({ success: false, error: 'cargoType должен быть "oil"' });
    }
    
    if (!amount || amount <= 0) {
        return res.status(400).json({ success: false, error: 'amount должен быть больше 0' });
    }
    
    // Проверяем завершенные путешествия перед заправкой
    await checkShipTravel(shipId);
    
    const result = await refuelShip(shipId, cargoType, amount);
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

// Отбуксировать судно во Владивосток (когда закончилось топливо)
router.post('/:shipId/tow', validateUUID('shipId'), asyncHandler(async (req, res) => {
    const { shipId } = req.params;
    
    // Проверяем завершенные путешествия перед буксировкой
    await checkShipTravel(shipId);
    
    const result = await towShip(shipId);
    res.json(result);
}));

module.exports = router;
