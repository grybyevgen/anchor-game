const express = require('express');
const router = express.Router();
const Port = require('../models/Port');

// Получить все порты
router.get('/', async (req, res) => {
    try {
        const ports = await Port.findAll();
        res.json(ports);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Получить порт по ID
router.get('/:portId', async (req, res) => {
    try {
        const { portId } = req.params;
        const port = await Port.findById(portId);
        res.json(port);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;