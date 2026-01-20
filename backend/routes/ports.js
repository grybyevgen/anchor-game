const express = require('express');
const router = express.Router();
const Port = require('../models/Port');
const { PORT_GENERATION_RULES } = require('../game-logic/portManager');
const { asyncHandler, handleSupabaseError } = require('../middleware/errorHandler');
const { validateUUID } = require('../middleware/validation');

// Получить все порты
router.get('/', asyncHandler(async (req, res) => {
    const ports = await Port.findAll();
    res.json({ success: true, ports });
}));

// Получить правила генерации ресурсов для портов
router.get('/generation-rules', asyncHandler(async (req, res) => {
    res.json({ success: true, rules: PORT_GENERATION_RULES });
}));

// Получить порт по ID
router.get('/:portId', validateUUID('portId'), asyncHandler(async (req, res) => {
    const { portId } = req.params;
    const port = await Port.findById(portId);
    
    if (!port) {
        return res.status(404).json({ 
            success: false,
            error: 'Порт не найден' 
        });
    }
    
    res.json({ success: true, port });
}));

module.exports = router;