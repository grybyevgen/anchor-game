const express = require('express');
const router = express.Router();
const Ship = require('../models/Ship');
const User = require('../models/User');
const Port = require('../models/Port');
const { sendShipToPort, loadCargo, unloadCargo, repairShip } = require('../game-logic/shipManager');

// Получить все судна пользователя
router.get('/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        let user;
        if (userId.match(/^[0-9]+$/)) {
            user = await User.findOne({ telegramId: parseInt(userId) });
        } else {
            user = await User.findById(userId);
        }
        
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        const ships = await Ship.find({ userId: user.id });
        res.json(ships);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Купить судно
router.post('/buy', async (req, res) => {
    try {
        const { userId, type } = req.body;
        
        if (!userId || !type) {
            return res.json({ success: false, error: 'Не указаны userId и type' });
        }
        
        const shipPrices = {
            'tanker': 1000,
            'cargo': 1500,
            'supply': 1200
        };
        
        const price = shipPrices[type];
        if (!price) {
            return res.json({ success: false, error: 'Неверный тип судна' });
        }
        
        // Находим пользователя
        let user;
        if (userId.match(/^[0-9]+$/)) {
            user = await User.findOne({ telegramId: parseInt(userId) });
        } else {
            user = await User.findById(userId);
        }
        
        if (!user) {
            return res.json({ success: false, error: 'Пользователь не найден' });
        }
        
        // Проверяем баланс
        if (user.coins < price) {
            return res.json({ success: false, error: 'Недостаточно монет' });
        }
        
        // Получаем стартовый порт
        const ports = await Port.findAll();
        if (ports.length === 0) {
            return res.json({ success: false, error: 'Порты не инициализированы' });
        }
        
        // Создаем судно
        const shipNames = {
            'tanker': 'Танкер',
            'cargo': 'Грузовое судно',
            'supply': 'Снабженец'
        };
        
        const newShip = await Ship.create({
            userId: user.id,
            type,
            name: `${shipNames[type]} #${Date.now()}`,
            currentPortId: ports[0].id,
            fuel: 100,
            maxFuel: 100,
            health: 100,
            maxHealth: 100,
            crewLevel: 1
        });
        
        // Списываем монеты
        await user.spendCoins(price);
        
        res.json({ success: true, ship: newShip });
    } catch (error) {
        console.error('Ошибка покупки судна:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Отправить судно в порт
router.post('/:shipId/travel', async (req, res) => {
    try {
        const { shipId } = req.params;
        const { portId } = req.body;
        
        const result = await sendShipToPort(shipId, portId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Загрузить груз
router.post('/:shipId/load', async (req, res) => {
    try {
        const { shipId } = req.params;
        const { cargoType, amount } = req.body;
        
        const result = await loadCargo(shipId, cargoType, amount);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Выгрузить груз
router.post('/:shipId/unload', async (req, res) => {
    try {
        const { shipId } = req.params;
        
        const result = await unloadCargo(shipId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Починить судно
router.post('/:shipId/repair', async (req, res) => {
    try {
        const { shipId } = req.params;
        
        const result = await repairShip(shipId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
