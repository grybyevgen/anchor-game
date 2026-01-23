/**
 * Централизованная обработка ошибок
 */

class AppError extends Error {
    constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.isOperational = true;
        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * Создание стандартизированного ответа об ошибке
 */
function createErrorResponse(error, req) {
    // Проверяем, является ли это ошибкой подключения к базе данных
    const isConnError = isConnectionError(error);
    
    // Если это ошибка подключения, устанавливаем статус 503
    const statusCode = isConnError ? 503 : (error.statusCode || 500);
    const code = isConnError ? 'DATABASE_CONNECTION_ERROR' : (error.code || 'INTERNAL_ERROR');
    
    const response = {
        success: false,
        error: error.message || 'Внутренняя ошибка сервера',
        code: code
    };

    // В режиме разработки добавляем больше информации
    if (process.env.NODE_ENV === 'development') {
        response.stack = error.stack;
        response.path = req.path;
        response.method = req.method;
    }

    return { statusCode, response };
}

/**
 * Обработчик ошибок Express
 */
function errorHandler(err, req, res, next) {
    const { statusCode, response } = createErrorResponse(err, req);
    
    // Проверяем, является ли это ошибкой подключения к базе данных
    const isConnError = isConnectionError(err);
    
    // Не логируем 404 для статических ресурсов (favicon, robots.txt и т.д.)
    const isStaticResource = req.path === '/favicon.ico' || 
                             req.path === '/robots.txt' ||
                             req.path.startsWith('/static/') ||
                             req.path.startsWith('/assets/');
    
    // Логируем ошибку (но не логируем временные ошибки подключения и статические ресурсы как критичные)
    if ((!isConnError || process.env.NODE_ENV === 'development') && 
        !(statusCode === 404 && isStaticResource)) {
        console.error(`[${new Date().toISOString()}] Error ${statusCode} on ${req.method} ${req.path}:`, {
            message: err.message,
            code: response.code,
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
        });
    }

    res.status(statusCode).json(response);
}

/**
 * Обработчик 404
 */
function notFoundHandler(req, res, next) {
    // Не логируем favicon.ico как ошибку - это нормальный запрос браузера
    const isFavicon = req.path === '/favicon.ico';
    
    const error = new AppError(
        `Маршрут ${req.method} ${req.path} не найден`,
        404,
        'NOT_FOUND'
    );
    
    // Для favicon просто возвращаем 404 без логирования
    if (isFavicon) {
        return res.status(404).json({
            success: false,
            error: 'Not found',
            code: 'NOT_FOUND'
        });
    }
    
    next(error);
}

/**
 * Обертка для async функций - автоматически обрабатывает ошибки
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

/**
 * Проверка, является ли ошибка временной ошибкой подключения
 */
function isConnectionError(error) {
    if (!error) return false;
    
    const errorMessage = error.message?.toLowerCase() || '';
    const errorCode = error.code || '';
    
    return errorMessage.includes('fetch failed') ||
           errorMessage.includes('econnreset') ||
           errorMessage.includes('econnrefused') ||
           errorMessage.includes('terminated') ||
           errorMessage.includes('connection') ||
           errorCode === 'ECONNRESET' ||
           errorCode === 'ECONNREFUSED' ||
           errorCode === 'ETIMEDOUT';
}

/**
 * Валидация ошибок Supabase
 */
function handleSupabaseError(error) {
    if (!error) return null;

    // Проверяем, является ли это временной ошибкой подключения
    if (isConnectionError(error)) {
        // Для временных ошибок подключения возвращаем более понятное сообщение
        return new AppError(
            'Временная ошибка подключения к базе данных. Попробуйте еще раз.',
            503, // Service Unavailable
            'DATABASE_CONNECTION_ERROR'
        );
    }

    // Ошибки уникальности
    if (error.code === '23505') {
        return new AppError('Запись с такими данными уже существует', 409, 'DUPLICATE_ENTRY');
    }

    // Ошибки внешних ключей
    if (error.code === '23503') {
        return new AppError('Связанная запись не найдена', 404, 'FOREIGN_KEY_VIOLATION');
    }

    // Ошибки проверки ограничений
    if (error.code === '23514') {
        return new AppError('Нарушено ограничение данных', 400, 'CHECK_VIOLATION');
    }

    // Ошибки не найдено
    if (error.code === 'PGRST116') {
        return new AppError('Запись не найдена', 404, 'NOT_FOUND');
    }

    // Общая ошибка базы данных
    return new AppError(
        error.message || 'Ошибка базы данных',
        500,
        'DATABASE_ERROR'
    );
}

module.exports = {
    AppError,
    errorHandler,
    notFoundHandler,
    asyncHandler,
    handleSupabaseError,
    isConnectionError
};
