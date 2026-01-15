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
    const statusCode = error.statusCode || 500;
    const code = error.code || 'INTERNAL_ERROR';
    
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
    
    // Логируем ошибку
    console.error(`[${new Date().toISOString()}] Error ${statusCode} on ${req.method} ${req.path}:`, {
        message: err.message,
        code: response.code,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });

    res.status(statusCode).json(response);
}

/**
 * Обработчик 404
 */
function notFoundHandler(req, res, next) {
    const error = new AppError(
        `Маршрут ${req.method} ${req.path} не найден`,
        404,
        'NOT_FOUND'
    );
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
 * Валидация ошибок Supabase
 */
function handleSupabaseError(error) {
    if (!error) return null;

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
    handleSupabaseError
};
