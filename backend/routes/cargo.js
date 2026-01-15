const express = require('express');
const router = express.Router();
const Cargo = require('../models/Cargo');

// Получить все грузы на рынке
router.get('/', async (req, res) => {
    try {
        const cargo = await Cargo.findMarketCargo();
        res.json(cargo);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Купить груз с рынка
router.post('/:cargoId/buy', async (req, res) => {
    try {
        const { cargoId } = req.params;
        const { userId } = req.body;
        
        if (!userId) {
            return res.json({ success: false, error: 'userId обязателен' });
        }
        
        const result = await Cargo.buyFromMarket(cargoId, userId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
