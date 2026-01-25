const { getSupabase, withRetry } = require('../config/database');

class UserEarnings {
    constructor(data) {
        this.id = data.id;
        this.userId = data.user_id;
        this.totalEarnings = data.total_earnings || 0;
        this.weeklyEarnings = data.weekly_earnings || 0;
        this.weekStartDate = data.week_start_date;
        this.lastUpdated = data.last_updated;
    }

    static async findOrCreate(userId) {
        const supabase = getSupabase();
        
        // Получаем начало текущей недели (понедельник)
        const today = new Date();
        const dayOfWeek = today.getDay();
        const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Понедельник = 1, воскресенье = 0
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - diff);
        weekStart.setHours(0, 0, 0, 0);
        const weekStartDate = weekStart.toISOString().split('T')[0];

        try {
            // Пытаемся найти существующую запись
            const { data: existing, error: findError } = await withRetry(async () => {
                return await supabase
                    .from('user_earnings')
                    .select('*')
                    .eq('user_id', userId)
                    .eq('week_start_date', weekStartDate)
                    .single();
            });

            if (existing && !findError) {
                return new UserEarnings(existing);
            }

            // Если запись не найдена, создаем новую
            // Сначала проверяем, есть ли старая запись для этого пользователя
            const { data: oldRecord } = await withRetry(async () => {
                return await supabase
                    .from('user_earnings')
                    .select('total_earnings')
                    .eq('user_id', userId)
                    .order('week_start_date', { ascending: false })
                    .limit(1)
                    .single();
            });

            const totalEarnings = oldRecord?.total_earnings || 0;

            const { data: newRecord, error: createError } = await withRetry(async () => {
                return await supabase
                    .from('user_earnings')
                    .insert({
                        user_id: userId,
                        total_earnings: totalEarnings,
                        weekly_earnings: 0,
                        week_start_date: weekStartDate
                    })
                    .select()
                    .single();
            });

            if (createError) {
                throw createError;
            }

            return new UserEarnings(newRecord);
        } catch (error) {
            const isConnectionError = error.message?.includes('fetch failed') || 
                                     error.message?.includes('ECONNRESET') ||
                                     error.message?.includes('ECONNREFUSED') ||
                                     error.message?.includes('terminated') ||
                                     error.code === 'ECONNRESET' ||
                                     error.code === 'ECONNREFUSED';
            
            if (isConnectionError) {
                throw new Error('Временная ошибка подключения к базе данных. Попробуйте еще раз.');
            }
            throw error;
        }
    }

    async addEarnings(amount) {
        const supabase = getSupabase();
        
        try {
            // Обновляем общий и недельный заработок
            const { data, error } = await withRetry(async () => {
                return await supabase
                    .from('user_earnings')
                    .update({
                        total_earnings: this.totalEarnings + amount,
                        weekly_earnings: this.weeklyEarnings + amount,
                        last_updated: new Date().toISOString()
                    })
                    .eq('id', this.id)
                    .select()
                    .single();
            });

            if (error) {
                throw error;
            }

            this.totalEarnings = data.total_earnings;
            this.weeklyEarnings = data.weekly_earnings;
            return this;
        } catch (error) {
            const isConnectionError = error.message?.includes('fetch failed') || 
                                     error.message?.includes('ECONNRESET') ||
                                     error.message?.includes('ECONNREFUSED') ||
                                     error.message?.includes('terminated') ||
                                     error.code === 'ECONNRESET' ||
                                     error.code === 'ECONNREFUSED';
            
            if (isConnectionError) {
                throw new Error('Временная ошибка подключения к базе данных. Попробуйте еще раз.');
            }
            throw error;
        }
    }

    static async getTopPlayers(type = 'total', limit = 20, currentUserId = null) {
        const supabase = getSupabase();
        
        // Получаем начало текущей недели
        const today = new Date();
        const dayOfWeek = today.getDay();
        const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - diff);
        weekStart.setHours(0, 0, 0, 0);
        const weekStartDate = weekStart.toISOString().split('T')[0];

        try {
            if (type === 'weekly') {
                // Для weekly берем записи текущей недели
                const { data, error } = await withRetry(async () => {
                    return await supabase
                        .from('user_earnings')
                        .select(`
                            total_earnings,
                            weekly_earnings,
                            user_id,
                            users:user_id (
                                id,
                                username,
                                first_name,
                                telegram_id
                            )
                        `)
                        .eq('week_start_date', weekStartDate)
                        .order('weekly_earnings', { ascending: false })
                        .limit(limit);
                });

                if (error) {
                    throw error;
                }

                return (data || []).map(record => {
                    const user = record.users;
                    return {
                        userId: record.user_id,
                        username: user?.username || user?.first_name || 'Игрок',
                        earnings: record.weekly_earnings,
                        isMe: currentUserId && record.user_id === currentUserId
                    };
                });
            } else {
                // Для total нужно получить последнюю запись каждого пользователя
                // Используем подзапрос для получения максимального last_updated для каждого пользователя
                const { data, error } = await withRetry(async () => {
                    // Получаем все записи, отсортированные по total_earnings
                    // Затем в коде отфильтруем, оставив только последнюю запись для каждого пользователя
                    return await supabase
                        .from('user_earnings')
                        .select(`
                            total_earnings,
                            weekly_earnings,
                            user_id,
                            last_updated,
                            users:user_id (
                                id,
                                username,
                                first_name,
                                telegram_id
                            )
                        `)
                        .order('total_earnings', { ascending: false });
                });

                if (error) {
                    throw error;
                }

                // Группируем по user_id и берем последнюю запись (с максимальным last_updated)
                const userMap = new Map();
                for (const record of data || []) {
                    const existing = userMap.get(record.user_id);
                    if (!existing || new Date(record.last_updated) > new Date(existing.last_updated)) {
                        userMap.set(record.user_id, record);
                    }
                }

                // Преобразуем в массив и сортируем по total_earnings
                const processed = Array.from(userMap.values())
                    .sort((a, b) => b.total_earnings - a.total_earnings)
                    .slice(0, limit)
                    .map(record => {
                        const user = record.users;
                        return {
                            userId: record.user_id,
                            username: user?.username || user?.first_name || 'Игрок',
                            earnings: record.total_earnings,
                            isMe: currentUserId && record.user_id === currentUserId
                        };
                    });

                return processed;
            }
        } catch (error) {
            const isConnectionError = error.message?.includes('fetch failed') || 
                                     error.message?.includes('ECONNRESET') ||
                                     error.message?.includes('ECONNREFUSED') ||
                                     error.message?.includes('terminated') ||
                                     error.code === 'ECONNRESET' ||
                                     error.code === 'ECONNREFUSED';
            
            if (isConnectionError) {
                throw new Error('Временная ошибка подключения к базе данных. Попробуйте еще раз.');
            }
            throw error;
        }
    }

    static async getFriendsRating(userId, limit = 20) {
        const supabase = getSupabase();
        
        // Получаем начало текущей недели
        const today = new Date();
        const dayOfWeek = today.getDay();
        const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - diff);
        weekStart.setHours(0, 0, 0, 0);
        const weekStartDate = weekStart.toISOString().split('T')[0];

        try {
            // Получаем всех рефералов пользователя (тех, кого он пригласил)
            const { data: referrals, error: refError } = await withRetry(async () => {
                return await supabase
                    .from('referrals')
                    .select('referred_id')
                    .eq('referrer_id', userId);
            });

            if (refError) {
                throw refError;
            }

            // Получаем пользователя, который пригласил текущего
            const { data: referrerData } = await withRetry(async () => {
                return await supabase
                    .from('users')
                    .select('referred_by')
                    .eq('id', userId)
                    .single();
            });

            const friendIds = new Set([userId]); // Включаем текущего пользователя

            // Добавляем рефералов (тех, кого пригласил пользователь)
            if (referrals) {
                referrals.forEach(ref => friendIds.add(ref.referred_id));
            }

            // Добавляем реферера (того, кто пригласил пользователя)
            if (referrerData?.referred_by) {
                friendIds.add(referrerData.referred_by);
            }

            // Получаем заработок всех друзей
            const { data: earnings, error: earningsError } = await withRetry(async () => {
                return await supabase
                    .from('user_earnings')
                    .select(`
                        total_earnings,
                        weekly_earnings,
                        user_id,
                        users:user_id (
                            id,
                            username,
                            first_name,
                            telegram_id
                        )
                    `)
                    .in('user_id', Array.from(friendIds))
                    .eq('week_start_date', weekStartDate)
                    .order('weekly_earnings', { ascending: false });
            });

            if (earningsError) {
                throw earningsError;
            }

            return (earnings || []).map(record => {
                const user = record.users;
                return {
                    userId: record.user_id,
                    username: user?.username || user?.first_name || 'Игрок',
                    earnings: record.weekly_earnings,
                    isMe: record.user_id === userId
                };
            });
        } catch (error) {
            const isConnectionError = error.message?.includes('fetch failed') || 
                                     error.message?.includes('ECONNRESET') ||
                                     error.message?.includes('ECONNREFUSED') ||
                                     error.message?.includes('terminated') ||
                                     error.code === 'ECONNRESET' ||
                                     error.code === 'ECONNREFUSED';
            
            if (isConnectionError) {
                throw new Error('Временная ошибка подключения к базе данных. Попробуйте еще раз.');
            }
            throw error;
        }
    }
}

module.exports = UserEarnings;
