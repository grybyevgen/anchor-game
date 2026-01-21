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
        testConnection().catch(err => {
            console.error('❌ Ошибка проверки подключения:', err);
            // Не завершаем процесс, просто логируем ошибку
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
    } catch (error) {
        console.error('❌ Ошибка проверки подключения:', error);
    }
}

function getSupabase() {
    if (!supabase) {
        throw new Error('Supabase не инициализирован. Вызовите initDatabase() сначала.');
    }
    return supabase;
}

module.exports = { initDatabase, getSupabase };
