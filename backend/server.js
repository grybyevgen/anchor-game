const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Проверка обязательных переменных окружения
const requiredEnvVars = ['SUPABASE_URL'];
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
if (!supabaseKey) {
    requiredEnvVars.push('SUPABASE_SERVICE_ROLE_KEY или SUPABASE_ANON_KEY');
}

// В production режиме проверяем обязательные переменные
if (process.env.NODE_ENV === 'production') {
    const missingVars = requiredEnvVars.filter(varName => {
        if (varName === 'SUPABASE_URL') return !process.env.SUPABASE_URL;
        if (varName.includes('SUPABASE_SERVICE_ROLE_KEY')) return !supabaseKey;
        return !process.env[varName];
    });
    
    if (missingVars.length > 0) {
        console.error(`❌ Критическая ошибка: отсутствуют обязательные переменные окружения: ${missingVars.join(', ')}`);
        console.error('💡 Проверьте файл backend/.env и убедитесь, что все переменные установлены');
        process.exit(1);
    }
}

const { initDatabase } = require('./config/database');
const { errorHandler, notFoundHandler, asyncHandler, handleSupabaseError } = require('./middleware/errorHandler');
const { telegramAuthMiddleware } = require('./middleware/auth');
const shipRoutes = require('./routes/ships');
const portRoutes = require('./routes/ports');
const marketRoutes = require('./routes/market');
const ratingRoutes = require('./routes/rating');
const referralRoutes = require('./routes/referral');
const telegramRoutes = require('./routes/telegram');
const taskRoutes = require('./routes/tasks');
const User = require('./models/User');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy для работы за прокси (Railway, Heroku и т.д.)
// 1 означает доверять только одному прокси перед приложением
app.set('trust proxy', 1);

// Rate limiting - более мягкий для тестового режима
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: process.env.NODE_ENV === 'production' ? 300 : 1000, // В тестовом режиме больше лимит
    message: {
        success: false,
        error: 'Слишком много запросов, попробуйте позже'
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Отключаем валидацию trust proxy для работы за прокси
    validate: {
        trustProxy: false
    },
    // Не лимитим preflight-запросы браузера (иначе они "съедают" лимит при CORS)
    // + пропускаем health check
    skip: (req) => req.method === 'OPTIONS' || req.path === '/health' || req.originalUrl === '/health'
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

// Более мягкий лимит для check-travel (применяется ПЕРЕД общим лимитером)
const checkTravelLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 минута
    max: 120, // максимум 120 запросов в минуту на check-travel (под 1000+ онлайна при окне прибытия)
    message: {
        success: false,
        error: 'Слишком много запросов проверки путешествий, попробуйте позже'
    },
    standardHeaders: true,
    legacyHeaders: false,
    validate: {
        trustProxy: false
    },
    // Не лимитим preflight-запросы браузера
    skip: (req) => req.method === 'OPTIONS'
});

// Применяем более мягкий лимит для check-travel ПЕРЕД общим лимитером
app.use('/api/ships/:shipId/check-travel', checkTravelLimiter);

// Применяем rate limiting ко всем остальным запросам
app.use('/api/', limiter);

// Health check endpoint (без rate limiting и аутентификации)
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Корневой путь - информация об API
app.get('/', (req, res) => {
    res.json({
        name: 'Anchor Game API',
        version: '1.0.0',
        status: 'running',
        endpoints: {
            health: '/health',
            api: '/api',
            ships: '/api/ships',
            ports: '/api/ports',
            market: '/api/market',
            users: '/api/users'
        }
    });
});

// Информация об API эндпоинтах
app.get('/api', (req, res) => {
    res.json({
        message: 'Anchor Game API',
        version: '1.0.0',
        endpoints: {
            ships: '/api/ships',
            ports: '/api/ports',
            market: '/api/market',
            users: '/api/users'
        },
        documentation: 'See /health for server status'
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

// Telegram webhook не требует аутентификации (имеет свою валидацию через секретный токен)
// Должен быть ПЕРЕД применением telegramAuthMiddleware
app.use('/api/telegram', telegramRoutes);

// Применяем аутентификацию Telegram (можно отключить через DISABLE_TELEGRAM_AUTH=true)
app.use('/api/', telegramAuthMiddleware);

// Routes
app.use('/api/ships', shipRoutes);
app.use('/api/ports', portRoutes);
app.use('/api/market', marketRoutes);
app.use('/api/rating', ratingRoutes);
app.use('/api/referral', referralRoutes);
app.use('/api/tasks', taskRoutes);

// Инициализация пользователя
const { validateUserInit } = require('./middleware/validation');
const gameConfig = require('./config/gameConfig');

app.post('/api/users/init', validateUserInit, asyncHandler(async (req, res) => {
    const { telegramId, username, firstName, lastName, referralCode } = req.body;
    
    let user = await User.findOne({ telegramId });
    
    if (!user) {
        user = await User.create({
            telegramId,
            username: username || 'Игрок',
            firstName,
            lastName,
            coins: gameConfig.initial.userCoins,
            referralCode: referralCode // Передаем реферальный код при создании
        });
    } else {
        // Обновляем последнюю активность
        user.username = username || user.username;
        user.lastActive = new Date().toISOString();
        
        // Если у пользователя нет referral_code, создаем его
        if (!user.referralCode) {
            user.referralCode = User.generateReferralCode(user.telegramId);
        }
        
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
    try {
        // Преобразуем userId в строку для проверки
        const userIdStr = String(userId);
        if (userIdStr.match(/^[0-9]+$/)) {
            // Это telegramId (число)
            user = await User.findOne({ telegramId: parseInt(userIdStr) });
        } else {
            // Это UUID
            user = await User.findById(userIdStr);
        }
    } catch (error) {
        // Обработка ошибок подключения к базе данных
        const { isConnectionError } = require('./middleware/errorHandler');
        if (isConnectionError(error)) {
            // Возвращаем 503 для временных ошибок подключения
            return res.status(503).json({
                success: false,
                error: 'Временная ошибка подключения к базе данных. Попробуйте еще раз через несколько секунд.',
                code: 'DATABASE_CONNECTION_ERROR'
            });
        }
        throw error;
    }
    
    if (!user) {
        return res.status(404).json({ 
            success: false,
            error: 'Пользователь не найден' 
        });
    }
    
    // Проверяем завершенные путешествия перед загрузкой судов
    try {
        const { checkAndCompleteTravels } = require('./game-logic/shipManager');
        await checkAndCompleteTravels();
    } catch (error) {
        // Игнорируем ошибки проверки путешествий - это не критично для получения данных пользователя
        const { isConnectionError } = require('./middleware/errorHandler');
        if (!isConnectionError(error)) {
            console.error('Ошибка при проверке путешествий:', error);
        }
    }
    
    // Загружаем судна пользователя
    const Ship = require('./models/Ship');
    let ships = [];
    try {
        ships = await Ship.find({ userId: user.id });
    } catch (error) {
        // Обработка ошибок подключения при загрузке судов
        const { isConnectionError } = require('./middleware/errorHandler');
        if (isConnectionError(error)) {
            // Возвращаем данные пользователя, но без судов
            return res.json({
                success: true,
                userId: user.id,
                telegramId: user.telegramId,
                username: user.username,
                coins: user.coins,
                ships: [],
                warning: 'Не удалось загрузить данные о судах из-за временной ошибки подключения'
            });
        }
        throw error;
    }
    
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

// Запуск сервера (0.0.0.0 нужен для Railway/Heroku и др. — иначе health check не доходит)
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, async () => {
    console.log(`🚢 Сервер запущен на ${HOST}:${PORT}`);
    console.log(`📝 Режим: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔐 Аутентификация Telegram: ${process.env.DISABLE_TELEGRAM_AUTH === 'true' ? 'ОТКЛЮЧЕНА ⚠️' : 'ВКЛЮЧЕНА'}`);
    
    // Предупреждение о токене выводится только один раз при старте
    if (!process.env.TELEGRAM_BOT_TOKEN && process.env.DISABLE_TELEGRAM_AUTH !== 'true') {
        console.warn('⚠️  TELEGRAM_BOT_TOKEN не установлен, аутентификация будет пропущена для всех запросов');
    }

    // Предзагрузка username бота для реферальных ссылок (t.me/bot?start=ref_xxx)
    try {
        const { getBotUsername } = require('./config/telegramBot');
        await getBotUsername();
    } catch (e) {
        // не блокируем старт
    }
    
    // Запускаем периодическую проверку завершенных путешествий
    // Можно отключить через DISABLE_TRAVEL_CHECK=true для локального тестирования
    if (process.env.DISABLE_TRAVEL_CHECK !== 'true') {
        const { checkAndCompleteTravels } = require('./game-logic/shipManager');
        let lastErrorTime = 0;
        const ERROR_LOG_INTERVAL = 60000; // Логируем ошибки не чаще раза в минуту
        
        setInterval(async () => {
            try {
                const result = await checkAndCompleteTravels();
                if (result.completed > 0) {
                    console.log(`✅ Завершено путешествий: ${result.completed}`);
                }
                // Логируем ошибки только если они не silent и не слишком часто
                if (result.error && !result.silent) {
                    const now = Date.now();
                    if (now - lastErrorTime > ERROR_LOG_INTERVAL) {
                        console.error('Ошибка при проверке путешествий:', result.error);
                        lastErrorTime = now;
                    }
                }
            } catch (error) {
                // Обработка неожиданных ошибок
                const isConnectionError = error.message?.includes('fetch failed') || 
                                         error.message?.includes('ECONNRESET') ||
                                         error.message?.includes('ECONNREFUSED') ||
                                         error.code === 'ECONNRESET' ||
                                         error.code === 'ECONNREFUSED';
                
                if (!isConnectionError) {
                    // Логируем только не-сетевые ошибки и не чаще раза в минуту
                    const now = Date.now();
                    if (now - lastErrorTime > ERROR_LOG_INTERVAL) {
                        console.error('Ошибка при проверке путешествий:', error.message || error);
                        lastErrorTime = now;
                    }
                }
                // Сетевые ошибки игнорируем - это временные проблемы
            }
        }, 60000); // Проверяем каждую минуту
    } else {
        console.log('ℹ️  Периодическая проверка путешествий отключена (DISABLE_TRAVEL_CHECK=true)');
    }
});

module.exports = app;
