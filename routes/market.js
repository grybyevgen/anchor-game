const express = require('express');
const router = express.Router();
const Cargo = require('../models/Cargo');
const { asyncHandler, handleSupabaseError } = require('../middleware/errorHandler');
const { validateBuyCargo } = require('../middleware/validation');

// Получить все грузы на рынке
router.get('/', asyncHandler(async (req, res) => {
    const cargo = await Cargo.findMarketCargo();
    res.json({ success: true, cargo });
}));

// Купить груз с рынка
router.post('/:cargoId/buy', validateBuyCargo, asyncHandler(async (req, res) => {
    const { cargoId } = req.params;
    const { userId, amount } = req.body;
    
    try {
        const result = await Cargo.buyFromMarket(cargoId, userId, amount);
        res.json(result);
    } catch (error) {
        const handledError = handleSupabaseError(error);
        throw handledError || error;
    }
}));

module.exports = router;