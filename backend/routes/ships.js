const express = require('express');
const router = express.Router();
const Ship = require('../models/Ship');
const User = require('../models/User');
const Port = require('../models/Port');
const gameConfig = require('../config/gameConfig');
const { sendShipToPort, loadCargo, unloadCargo, repairShip, refuelShip, towShip, towShipToMaterials, checkAndCompleteTravels, checkShipTravel, upgradeShip, getTowInfo, getTowInfoToMaterials, getRefuelInfo, getTripPreview } = require('../game-logic/shipManager');
const { asyncHandler, handleSupabaseError } = require('../middleware/errorHandler');
const { validateBuyShip, validateTravel, validateLoadCargo, validateUUID } = require('../middleware/validation');
const { idempotency } = require('../middleware/idempotency');

// Получить все судна пользователя
router.get('/user/:userId', asyncHandler(async (req, res) => {
    const { userId } = req.params;
    
    let user;
    // Преобразуем userId в строку для проверки
    const userIdStr = String(userId);
    if (userIdStr.match(/^[0-9]+$/)) {
        user = await User.findOne({ telegramId: parseInt(userIdStr) });
    } else {
        user = await User.findById(userIdStr);
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
    // Преобразуем userId в строку для проверки
    const userIdStr = String(userId);
    if (userIdStr.match(/^[0-9]+$/)) {
        user = await User.findOne({ telegramId: parseInt(userIdStr) });
    } else {
        user = await User.findById(userIdStr);
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
    // Преобразуем userId в строку для проверки
    const userIdStr = String(userId);
    if (userIdStr.match(/^[0-9]+$/)) {
        user = await User.findOne({ telegramId: parseInt(userIdStr) });
    } else {
        user = await User.findById(userIdStr);
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
    
    // Получаем порты и определяем стартовый порт в зависимости от типа судна:
    // - Танкер (нефть) → Порт "Нефтяной завод" (генерирует нефть)
    // - Грузовое (материалы) → Порт "Завод Материалов" (генерирует материалы)
    // - Снабженец (провизия) → Порт "Провизионный завод" (генерирует провизию)
    const ports = await Port.findAll();
    if (ports.length === 0) {
        return res.status(500).json({ success: false, error: 'Порты не инициализированы' });
    }

    let startPort = null;
    if (type === 'tanker') {
        startPort = ports.find(p => p.name === 'Порт "Нефтяной завод"');
    } else if (type === 'cargo') {
        startPort = ports.find(p => p.name === 'Порт "Завод Материалов"');
    } else if (type === 'supply') {
        startPort = ports.find(p => p.name === 'Порт "Провизионный завод"');
    }

    // Если по каким-то причинам нужный порт не найден — используем первый как запасной вариант
    if (!startPort) {
        startPort = ports[0];
    }
    
    try {
        // Создаем судно
        const newShip = await Ship.create({
            userId: user.id,
            type,
            name: `${gameConfig.shipNames[type]} #${Date.now()}`,
            currentPortId: startPort.id,
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
router.post('/:shipId/load', validateLoadCargo, idempotency({ ttlMs: 60_000 }), asyncHandler(async (req, res) => {
    const { shipId } = req.params;
    const { cargoType, amount } = req.body;
    
    // Проверяем завершенные путешествия перед загрузкой
    await checkShipTravel(shipId);
    
    const result = await loadCargo(shipId, cargoType, amount);
    res.json(result);
}));

// Выгрузить груз
router.post('/:shipId/unload', validateUUID('shipId'), idempotency({ ttlMs: 60_000 }), asyncHandler(async (req, res) => {
    const { shipId } = req.params;
    const { destination } = req.body; // Всегда 'port' (рынок удален)
    
    // Проверяем завершенные путешествия перед выгрузкой
    try {
        await checkShipTravel(shipId);
    } catch (error) {
        // Игнорируем ошибки проверки путешествий - это не критично для выгрузки
        const { isConnectionError } = require('../middleware/errorHandler');
        if (!isConnectionError(error)) {
            console.error('Ошибка при проверке путешествий перед выгрузкой:', error);
        }
    }
    
    const result = await unloadCargo(shipId, destination || 'port');
    res.json(result);
}));

// Получить данные для буксировки (стоимость) — расчёт только на backend
router.get('/:shipId/tow-info', validateUUID('shipId'), asyncHandler(async (req, res) => {
    const { shipId } = req.params;
    const result = await getTowInfo(shipId);
    if (!result.success) return res.status(404).json(result);
    res.json(result);
}));

// Буксировка в Завод Материалов (для ремонта)
router.get('/:shipId/tow-materials-info', validateUUID('shipId'), asyncHandler(async (req, res) => {
    const { shipId } = req.params;
    const result = await getTowInfoToMaterials(shipId);
    if (!result.success) return res.status(404).json(result);
    res.json(result);
}));

// Получить данные для заправки (цена, макс. объём, стоимость) — расчёт только на backend. ?amount=N — стоимость для N единиц
router.get('/:shipId/refuel-info', validateUUID('shipId'), asyncHandler(async (req, res) => {
    const { shipId } = req.params;
    const amount = req.query.amount != null ? parseInt(req.query.amount, 10) : null;
    const result = await getRefuelInfo(shipId, amount);
    if (!result.success) return res.status(404).json(result);
    res.json(result);
}));

// Превью рейса: расстояние, расход топлива, towCost если нужно — расчёт только на backend
router.get('/:shipId/trip-preview', validateUUID('shipId'), asyncHandler(async (req, res) => {
    const { shipId } = req.params;
    const destinationPortId = req.query.destinationPortId;
    if (!destinationPortId) {
        return res.status(400).json({ success: false, error: 'Необходим параметр destinationPortId' });
    }
    const result = await getTripPreview(shipId, destinationPortId);
    if (!result.success) return res.status(400).json(result);
    res.json(result);
}));

// Получить данные для ремонта (материалы порта: 1 материал = 1 HP, стоимость = цена материалов в порту)
router.get('/:shipId/repair-info', validateUUID('shipId'), asyncHandler(async (req, res) => {
    const { shipId } = req.params;
    const ship = await Ship.findById(shipId);
    if (!ship) {
        return res.status(404).json({ success: false, error: 'Судно не найдено' });
    }
    const port = await Port.findById(ship.currentPortId);
    const maxHealth = ship.maxHealth ?? 100;
    const inMaterialsPort = port && port.name && String(port.name).includes('Материалов');
    const canRepair = !ship.isTraveling && inMaterialsPort && ship.health < maxHealth;
    if (!canRepair) {
        return res.json({ success: true, canRepair: false });
    }
    const materialsCargo = port.getCargo('materials');
    const materialsPrice = typeof materialsCargo?.price === 'number' ? materialsCargo.price : 0;
    const materialsAvailable = Math.floor(materialsCargo?.amount ?? 0);
    const healthNeeded = maxHealth - ship.health;
    const maxRepairAmount = Math.min(healthNeeded, materialsAvailable);
    if (maxRepairAmount <= 0) {
        return res.json({
            success: true,
            canRepair: false,
            maxHealth,
            currentHealth: ship.health,
            error: materialsAvailable <= 0 ? 'В порту нет материалов для ремонта' : 'Судно уже полностью исправно'
        });
    }
    const amountParam = req.query.amount != null ? parseInt(req.query.amount, 10) : null;
    const repairAmount = amountParam != null
        ? Math.min(Math.max(1, amountParam), maxRepairAmount)
        : maxRepairAmount;
    const repairCost = Math.round(repairAmount * materialsPrice);
    res.json({
        success: true,
        canRepair: true,
        repairAmount,
        repairCost,
        maxRepairAmount,
        materialsPrice,
        maxHealth,
        currentHealth: ship.health
    });
}));

// Починить судно. body.amount — опционально, сколько единиц здоровья восстановить (иначе полный ремонт)
router.post('/:shipId/repair', validateUUID('shipId'), asyncHandler(async (req, res) => {
    const { shipId } = req.params;
    const amount = req.body && req.body.amount != null ? parseInt(req.body.amount, 10) : null;
    await checkShipTravel(shipId);
    const result = await repairShip(shipId, amount);
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
    try {
        await checkShipTravel(shipId);
    } catch (error) {
        // Игнорируем ошибки проверки путешествий - это не критично для заправки
        const { isConnectionError } = require('../middleware/errorHandler');
        if (!isConnectionError(error)) {
            console.error('Ошибка при проверке путешествий перед заправкой:', error);
        }
    }
    
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

// Повысить уровень судна
router.post('/:shipId/upgrade', validateUUID('shipId'), asyncHandler(async (req, res) => {
    const { shipId } = req.params;
    const result = await upgradeShip(shipId);
    res.json(result);
}));

// Отбуксировать судно в порт "Нефтяной завод" (когда закончилось топливо)
router.post('/:shipId/tow', validateUUID('shipId'), asyncHandler(async (req, res) => {
    const { shipId } = req.params;
    
    console.log(`[POST /ships/:shipId/tow] Запрос на буксировку судна: ${shipId}`);
    
    // Проверяем завершенные путешествия перед буксировкой
    // Игнорируем ошибки - это не критично для буксировки
    try {
        await checkShipTravel(shipId);
    } catch (error) {
        // Тихая обработка - не логируем временные ошибки подключения
        const { isConnectionError } = require('../middleware/errorHandler');
        if (!isConnectionError(error)) {
            // Логируем только не-сетевые ошибки, и то не как критичные
            console.warn('[POST /ships/:shipId/tow] Предупреждение при проверке путешествий (не критично):', error.message);
        }
        // Продолжаем выполнение - буксировка может быть выполнена даже если проверка не удалась
    }
    
    try {
        const result = await towShip(shipId);
        console.log(`[POST /ships/:shipId/tow] Результат буксировки:`, result.success ? 'Успешно' : 'Ошибка');
        res.json(result);
    } catch (error) {
        console.error(`[POST /ships/:shipId/tow] Исключение при буксировке:`, error);
        throw error; // Пробрасываем для обработки в asyncHandler
    }
}));

// Отбуксировать судно в порт "Завод Материалов" (для ремонта)
router.post('/:shipId/tow-materials', validateUUID('shipId'), asyncHandler(async (req, res) => {
    const { shipId } = req.params;
    try {
        await checkShipTravel(shipId);
    } catch (e) {
        const { isConnectionError } = require('../middleware/errorHandler');
        if (!isConnectionError(e)) console.warn('[POST /ships/:shipId/tow-materials] checkShipTravel:', e.message);
    }
    const result = await towShipToMaterials(shipId);
    res.json(result);
}));

module.exports = router;
