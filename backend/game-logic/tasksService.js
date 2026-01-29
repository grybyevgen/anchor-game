/**
 * Сервис заданий: определения заданий и расчёт прогресса по данным из БД.
 * Данные не хранятся на frontend — только отображаются с backend.
 */

const User = require('../models/User');
const UserEarnings = require('../models/UserEarnings');
const { getSupabase, withRetry } = require('../config/database');

// Определения заданий (daily, weekly, achievement)
const TASK_DEFINITIONS = [
    { code: 'daily_login', name: 'Постоялец', description: 'Зайти в игру', type: 'daily', target: 1, reward: 50 },
    { code: 'daily_trips_5', name: 'Опытный моряк', description: 'Совершите 5 рейсов с грузом', type: 'daily', target: 5, reward: 300 },
    { code: 'daily_balance_5000', name: 'Экономный капитан', description: 'Накопите 5,000 монет', type: 'daily', target: 5000, reward: 700 },
    { code: 'weekly_distance_100000', name: 'Морской волк', description: 'Пройдите 100000 миль за неделю', type: 'weekly', target: 100000, reward: 1500 },
    { code: 'weekly_trips_50', name: 'Стойкий', description: 'Совершите 50 рейсов гружеными', type: 'weekly', target: 50, reward: 2000 },
    { code: 'weekly_cargo_10000', name: 'Торговый магнат', description: 'Доставьте 10000 единиц груза за неделю', type: 'weekly', target: 10000, reward: 3000 },
    { code: 'achievement_oil_50000', name: 'Владелец нефти', description: 'Заправьте судно нефтью в общем количестве 50000 единиц', type: 'achievement', target: 50000, reward: 5000 },
    { code: 'achievement_repair_50000', name: 'Мастер ремонта', description: 'Отремонтируйте суда на 50000 единиц здоровья', type: 'achievement', target: 50000, reward: 5000 },
];

function getTodayDate() {
    return new Date().toISOString().split('T')[0];
}

function getWeekStartDate() {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - diff);
    weekStart.setHours(0, 0, 0, 0);
    return weekStart.toISOString().split('T')[0];
}

/**
 * Получить прогресс по всем заданиям для пользователя.
 */
function resolveUser(userId) {
    const idStr = String(userId);
    if (idStr.match(/^[0-9]+$/)) {
        return User.findOne({ telegramId: parseInt(idStr, 10) });
    }
    return User.findById(idStr);
}

async function getTasksProgress(userId) {
    const user = await resolveUser(userId);
    if (!user) return null;

    const today = getTodayDate();
    const weekStart = getWeekStartDate();
    const supabase = getSupabase();

    // Обновляем last_active при открытии заданий — засчитывается «Постоялец» (зайти в игру)
    try {
        await withRetry(() =>
            supabase.from('users').update({ last_active: new Date().toISOString() }).eq('id', user.id)
        );
    } catch (e) {
        // не критично
    }

    let dailyTrips = 0;
    const { data: dailyRow } = await withRetry(async () => {
        return await supabase
            .from('user_daily_stats')
            .select('trips_count')
            .eq('user_id', user.id)
            .eq('stat_date', today)
            .maybeSingle();
    });
    if (dailyRow) dailyTrips = dailyRow.trips_count || 0;

    let userEarnings = null;
    try {
        userEarnings = await UserEarnings.findOrCreate(user.id);
    } catch (e) {
        userEarnings = { weeklyDistanceNm: 0, weeklyTrips: 0, weeklyCargoMoved: 0 };
    }

    // После обновления last_active выше — считаем, что пользователь «зашёл в игру» сегодня
    const dailyLoginProgress = 1;

    const progressByCode = {
        daily_login: Math.min(dailyLoginProgress, 1),
        daily_trips_5: Math.min(dailyTrips, 5),
        daily_balance_5000: Math.min(user.coins || 0, 5000),
        weekly_distance_100000: Math.min(userEarnings.weeklyDistanceNm || 0, 100000),
        weekly_trips_50: Math.min(userEarnings.weeklyTrips || 0, 50),
        weekly_cargo_10000: Math.min(userEarnings.weeklyCargoMoved || 0, 10000),
        achievement_oil_50000: user.totalFuelRefueled ?? 0,
        achievement_repair_50000: user.totalHealthRepaired ?? 0,
    };

    const { data: claims } = await withRetry(async () => {
        return await supabase
            .from('user_task_claims')
            .select('task_code, period_key')
            .eq('user_id', user.id);
    });
    const claimedSet = new Set((claims || []).map(c => `${c.task_code}:${c.period_key}`));

    const tasks = TASK_DEFINITIONS.map((def) => {
        const periodKey = def.type === 'daily' ? today : def.type === 'weekly' ? weekStart : 'all';
        const progress = progressByCode[def.code] ?? 0;
        const completed = progress >= def.target;
        const claimed = claimedSet.has(`${def.code}:${periodKey}`);

        return {
            code: def.code,
            name: def.name,
            description: def.description,
            type: def.type,
            target: def.target,
            reward: def.reward,
            progress,
            completed,
            claimed,
            periodKey,
        };
    });

    return { tasks };
}

/**
 * Забрать награду за задание. Проверяет выполнение и что награда ещё не выдана.
 */
async function claimTaskReward(userId, taskCode) {
    const user = await resolveUser(userId);
    if (!user) return { success: false, error: 'Пользователь не найден' };

    const def = TASK_DEFINITIONS.find(d => d.code === taskCode);
    if (!def) return { success: false, error: 'Задание не найдено' };

    const today = getTodayDate();
    const weekStart = getWeekStartDate();
    const periodKey = def.type === 'daily' ? today : def.type === 'weekly' ? weekStart : 'all';

    const supabase = getSupabase();

    const { data: existing } = await withRetry(async () => {
        return await supabase
            .from('user_task_claims')
            .select('task_code')
            .eq('user_id', user.id)
            .eq('task_code', taskCode)
            .eq('period_key', periodKey)
            .maybeSingle();
    });
    if (existing) return { success: false, error: 'Награда уже получена' };

    const { tasks } = await getTasksProgress(userId);
    const task = tasks.find(t => t.code === taskCode);
    if (!task || !task.completed) return { success: false, error: 'Задание не выполнено' };

    await user.addCoins(def.reward);
    await withRetry(async () => {
        return await supabase
            .from('user_task_claims')
            .insert({ user_id: user.id, task_code: taskCode, period_key: periodKey });
    });

    return { success: true, reward: def.reward, newBalance: user.coins };
}

module.exports = {
    TASK_DEFINITIONS,
    getTasksProgress,
    claimTaskReward,
};
