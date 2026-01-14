const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const { initDatabase } = require('./config/database');
const shipRoutes = require('./routes/ships');
const portRoutes = require('./routes/ports');
const cargoRoutes = require('./routes/cargo');
const marketRoutes = require('./routes/market');
const User = require('./models/User');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Инициализация базы данных
initDatabase();

// Routes
app.use('/api/ships', shipRoutes);
app.use('/api/ports', portRoutes);
app.use('/api/cargo', cargoRoutes);
app.use('/api/market', marketRoutes);

// Инициализация пользователя
app.post('/api/users/init', async (req, res) => {
    try {
        const { telegramId, username, firstName, lastName } = req.body;
        
        if (!telegramId) {
            return res.status(400).json({ error: 'telegramId обязателен' });
        }
        
        let user = await User.findOne({ telegramId });
        
        if (!user) {
            user = await User.create({
                telegramId,
                username: username || 'Игрок',
                firstName,
                lastName,
                coins: 1000
            });
        } else {
            // Обновляем последнюю активность
            user.username = username || user.username;
            user.lastActive = new Date().toISOString();
            await user.save();
        }
        
        res.json({
            success: true,
            userId: user.id,
            coins: user.coins
        });
    } catch (error) {
        console.error('Ошибка инициализации пользователя:', error);
        res.status(500).json({ error: error.message });
    }
});

// Получение данных пользователя
app.get('/api/users/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        let user;
        if (userId.match(/^[0-9]+$/)) {
            // Это telegramId (число)
            user = await User.findOne({ telegramId: parseInt(userId) });
        } else {
            // Это UUID
            user = await User.findById(userId);
        }
        
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        // Загружаем судна пользователя
        const Ship = require('./models/Ship');
        const ships = await Ship.find({ userId: user.id });
        
        res.json({
            userId: user.id,
            telegramId: user.telegramId,
            username: user.username,
            coins: user.coins,
            ships: ships
        });
    } catch (error) {
        console.error('Ошибка получения пользователя:', error);
        res.status(500).json({ error: error.message });
    }
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🚢 Сервер запущен на порту ${PORT}`);
});

module.exports = app;
