const express = require('express');
const router = express.Router();
const Port = require('../models/Port');
const { PORT_GENERATION_RULES } = require('../game-logic/portManager');
const { asyncHandler, handleSupabaseError } = require('../middleware/errorHandler');
const { validateUUID } = require('../middleware/validation');

// Получить все порты
router.get('/', asyncHandler(async (req, res) => {
    try {
        const { withRetry } = require('../config/database');
        const ports = await withRetry(async () => {
            return await Port.findAll();
        });
        res.json({ success: true, ports });
    } catch (error) {
        // Обработка ошибок подключения к базе данных
        const { isConnectionError } = require('../middleware/errorHandler');
        if (isConnectionError(error)) {
            return res.status(503).json({
                success: false,
                error: 'Временная ошибка подключения к базе данных. Попробуйте еще раз через несколько секунд.',
                code: 'DATABASE_CONNECTION_ERROR'
            });
        }
        throw error;
    }
}));

// Получить правила генерации ресурсов для портов
router.get('/generation-rules', asyncHandler(async (req, res) => {
    res.json({ success: true, rules: PORT_GENERATION_RULES });
}));

// Получить расстояние между портами
router.get('/distance', asyncHandler(async (req, res) => {
    // Декодируем параметры из URL (они могут быть URL-encoded)
    const from = req.query.from ? decodeURIComponent(String(req.query.from)) : null;
    const to = req.query.to ? decodeURIComponent(String(req.query.to)) : null;
    
    if (!from || !to) {
        return res.status(400).json({ 
            success: false,
            error: 'Необходимо указать параметры from и to (названия портов)' 
        });
    }
    
    try {
        // Находим порты по названиям с retry при ошибках подключения
        const { withRetry } = require('../config/database');
        let ports;
        
        try {
            ports = await withRetry(async () => {
                return await Port.findAll();
            });
        } catch (error) {
            // Обработка ошибок подключения к базе данных
            const { isConnectionError } = require('../middleware/errorHandler');
            if (isConnectionError(error)) {
                return res.status(503).json({
                    success: false,
                    error: 'Временная ошибка подключения к базе данных. Попробуйте еще раз через несколько секунд.',
                    code: 'DATABASE_CONNECTION_ERROR'
                });
            }
            throw error;
        }
        
        const fromPort = ports.find(p => p.name === from);
        const toPort = ports.find(p => p.name === to);
        
        if (!fromPort) {
            return res.status(404).json({ 
                success: false,
                error: `Порт "${from}" не найден` 
            });
        }
        
        if (!toPort) {
            return res.status(404).json({ 
                success: false,
                error: `Порт "${to}" не найден` 
            });
        }
        
        // Рассчитываем расстояние
        const distance = Port.calculateDistance(fromPort, toPort);
        
        res.json({ 
            success: true, 
            distance: distance,
            from: fromPort.name,
            to: toPort.name
        });
    } catch (error) {
        const handledError = handleSupabaseError(error);
        throw handledError || error;
    }
}));

// Получить порт по ID
router.get('/:portId', validateUUID('portId'), asyncHandler(async (req, res) => {
    const { portId } = req.params;
    
    try {
        const { withRetry } = require('../config/database');
        const port = await withRetry(async () => {
            return await Port.findById(portId);
        });
        
        if (!port) {
            return res.status(404).json({ 
                success: false,
                error: 'Порт не найден' 
            });
        }
        
        res.json({ success: true, port });
    } catch (error) {
        // Обработка ошибок подключения к базе данных
        const { isConnectionError } = require('../middleware/errorHandler');
        if (isConnectionError(error)) {
            return res.status(503).json({
                success: false,
                error: 'Временная ошибка подключения к базе данных. Попробуйте еще раз через несколько секунд.',
                code: 'DATABASE_CONNECTION_ERROR'
            });
        }
        throw error;
    }
}));

module.exports = router;