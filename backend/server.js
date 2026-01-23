const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const { initDatabase } = require('./config/database');
const { errorHandler, notFoundHandler, asyncHandler, handleSupabaseError } = require('./middleware/errorHandler');
const { telegramAuthMiddleware } = require('./middleware/auth');
const shipRoutes = require('./routes/ships');
const portRoutes = require('./routes/ports');
const marketRoutes = require('./routes/market');
const User = require('./models/User');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy для работы за прокси (Railway, Heroku и т.д.)
// 1 означает доверять только одному прокси перед приложением
app.set('trust proxy', 1);

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 300, // максимум 300 запросов с одного IP (увеличено для комфортной работы)
    message: {
        success: false,
        error: 'Слишком много запросов, попробуйте позже'
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Отключаем валидацию trust proxy для работы за прокси
    validate: {
        trustProxy: false
    }
});

// Middleware
const corsOptions = {
    origin: process.env.ALLOWED_ORIGINS 
        ? process.env.ALLOWED_ORIGINS.split(',')
        : '*', // В продакшене указать конкретные домены
    credentials: true,
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Применяем rate limiting ко всем запросам
app.use('/api/', limiter);

// Health check endpoint (без rate limiting и аутентификации)
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Инициализация базы данных
try {
    initDatabase();
} catch (error) {
    console.error('❌ Критическая ошибка инициализации базы данных:', error);
    // В продакшене продолжаем работу, возможно переменные окружения установятся позже
    if (process.env.NODE_ENV === 'development') {
        console.error('Завершаем процесс в режиме разработки');
        process.exit(1);
    }
}

// Применяем аутентификацию Telegram (можно отключить через DISABLE_TELEGRAM_AUTH=true)
app.use('/api/', telegramAuthMiddleware);

// Routes
app.use('/api/ships', shipRoutes);
app.use('/api/ports', portRoutes);
app.use('/api/market', marketRoutes);

// Инициализация пользователя
const { validateUserInit } = require('./middleware/validation');
const gameConfig = require('./config/gameConfig');

app.post('/api/users/init', validateUserInit, asyncHandler(async (req, res) => {
    const { telegramId, username, firstName, lastName } = req.body;
    
    let user = await User.findOne({ telegramId });
    
    if (!user) {
        user = await User.create({
            telegramId,
            username: username || 'Игрок',
            firstName,
            lastName,
            coins: gameConfig.initial.userCoins
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
}));

// Получение данных пользователя
const { validateGetUser } = require('./middleware/validation');

app.get('/api/users/:userId', validateGetUser, asyncHandler(async (req, res) => {
    const { userId } = req.params;
    
    let user;
    // Преобразуем userId в строку для проверки
    const userIdStr = String(userId);
    if (userIdStr.match(/^[0-9]+$/)) {
        // Это telegramId (число)
        user = await User.findOne({ telegramId: parseInt(userIdStr) });
    } else {
        // Это UUID
        user = await User.findById(userIdStr);
    }
    
    if (!user) {
        return res.status(404).json({ 
            success: false,
            error: 'Пользователь не найден' 
        });
    }
    
    // Проверяем завершенные путешествия перед загрузкой судов
    const { checkAndCompleteTravels } = require('./game-logic/shipManager');
    await checkAndCompleteTravels();
    
    // Загружаем судна пользователя
    const Ship = require('./models/Ship');
    const ships = await Ship.find({ userId: user.id });
    
    res.json({
        success: true,
        userId: user.id,
        telegramId: user.telegramId,
        username: user.username,
        coins: user.coins,
        ships: ships
    });
}));

// Обработка 404
app.use(notFoundHandler);

// Централизованная обработка ошибок (должна быть последней)
app.use(errorHandler);

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🚢 Сервер запущен на порту ${PORT}`);
    console.log(`📝 Режим: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔐 Аутентификация Telegram: ${process.env.DISABLE_TELEGRAM_AUTH === 'true' ? 'ОТКЛЮЧЕНА ⚠️' : 'ВКЛЮЧЕНА'}`);
    
    // Предупреждение о токене выводится только один раз при старте
    if (!process.env.TELEGRAM_BOT_TOKEN && process.env.DISABLE_TELEGRAM_AUTH !== 'true') {
        console.warn('⚠️  TELEGRAM_BOT_TOKEN не установлен, аутентификация будет пропущена для всех запросов');
    }
    
    // Запускаем периодическую проверку завершенных путешествий
    const { checkAndCompleteTravels } = require('./game-logic/shipManager');
    setInterval(async () => {
        try {
            const result = await checkAndCompleteTravels();
            if (result.completed > 0) {
                console.log(`✅ Завершено путешествий: ${result.completed}`);
            }
        } catch (error) {
            console.error('Ошибка при проверке путешествий:', error);
        }
    }, 60000); // Проверяем каждую минуту
});

module.exports = app;
