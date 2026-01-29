const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

let supabase;

function initDatabase() {
    try {
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
        
        if (!supabaseUrl || !supabaseKey) {
            throw new Error('SUPABASE_URL и SUPABASE_ANON_KEY должны быть установлены в .env');
        }
        
        supabase = createClient(supabaseUrl, supabaseKey);
        
        console.log('✅ Supabase подключен успешно');
        console.log(`📦 URL: ${supabaseUrl}`);
        
        // Проверка подключения (асинхронно, не блокирует запуск)
        // Выполняем только один раз при старте, без повторных попыток
        testConnection().catch(() => {
            // Ошибка уже обработана в testConnection, не логируем повторно
        });
        
    } catch (error) {
        console.error('❌ Ошибка подключения к Supabase:', error);
        // В продакшене не завершаем процесс сразу, даем серверу запуститься
        // process.exit(1);
        throw error;
    }
}

async function testConnection() {
    try {
        const { data, error } = await supabase
            .from('ports')
            .select('count')
            .limit(1);
        
        if (error) throw error;
        console.log('✅ Подключение к базе данных успешно');
        return true;
    } catch (error) {
        // Проверяем, является ли это реальной ошибкой подключения
        const isConnectionError = error.message?.includes('fetch failed') || 
                                 error.message?.includes('ECONNRESET') ||
                                 error.message?.includes('ECONNREFUSED') ||
                                 error.code === 'ECONNRESET' ||
                                 error.code === 'ECONNREFUSED';
        
        // Логируем только реальные ошибки подключения, не все ошибки
        if (isConnectionError) {
            console.error('❌ Ошибка проверки подключения к базе данных:', error.message || error);
        } else {
            // Другие ошибки (например, проблемы с правами доступа) логируем один раз
            console.error('❌ Ошибка проверки подключения:', error.message || error);
        }
        return false;
    }
}

function getSupabase() {
    if (!supabase) {
        throw new Error('Supabase не инициализирован. Вызовите initDatabase() сначала.');
    }
    return supabase;
}

/**
 * Выполняет операцию с Supabase с автоматическим retry при временных ошибках подключения
 * @param {Function} operation - Функция, которая выполняет операцию с Supabase
 * @param {number} maxRetries - Максимальное количество попыток (по умолчанию 3)
 * @param {number} delay - Задержка между попытками в миллисекундах (по умолчанию 500ms)
 * @returns {Promise} Результат операции
 */
async function withRetry(operation, maxRetries = 3, delay = 500) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            
            // Проверяем, является ли это временной ошибкой подключения
            // Более строгая проверка - только реальные сетевые ошибки
            const errorMessage = error.message?.toLowerCase() || '';
            const isConnectionError = 
                // Сетевые ошибки
                error.message?.includes('fetch failed') || 
                error.message?.includes('ECONNRESET') ||
                error.message?.includes('ECONNREFUSED') ||
                error.message?.includes('ETIMEDOUT') ||
                error.message?.includes('network') ||
                error.message?.includes('socket') ||
                error.message?.includes('terminated') ||
                // Коды ошибок
                error.code === 'ECONNRESET' ||
                error.code === 'ECONNREFUSED' ||
                error.code === 'ETIMEDOUT' ||
                error.code === 'ENOTFOUND' ||
                error.code === 'ECONNABORTED' ||
                // Специфичные ошибки Supabase
                (errorMessage.includes('connection') && (
                    errorMessage.includes('failed') ||
                    errorMessage.includes('reset') ||
                    errorMessage.includes('refused') ||
                    errorMessage.includes('timeout')
                ));
            
            // Если это не временная ошибка подключения или это последняя попытка, пробрасываем ошибку
            if (!isConnectionError) {
                throw error;
            }
            
            // Если это последняя попытка, пробрасываем ошибку
            if (attempt === maxRetries) {
                throw error;
            }
            
            // Ждем перед следующей попыткой (экспоненциальная задержка)
            const waitTime = delay * Math.pow(2, attempt - 1);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            
            // Логируем только если это не последняя попытка и включен режим отладки
            // В production не засоряем логи повторными попытками
            if (process.env.NODE_ENV === 'development' && attempt < maxRetries) {
                console.log(`⚠️ Повторная попытка подключения к Supabase (${attempt}/${maxRetries})...`);
            }
        }
    }
    
    throw lastError;
}

module.exports = { initDatabase, getSupabase, withRetry };
