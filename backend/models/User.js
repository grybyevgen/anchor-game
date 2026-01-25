const { getSupabase, withRetry } = require('../config/database');

class User {
    constructor(data) {
        this.id = data.id;
        this.telegramId = data.telegram_id;
        this.username = data.username;
        this.firstName = data.first_name;
        this.lastName = data.last_name;
        this.coins = data.coins;
        this.referralCode = data.referral_code;
        this.referredBy = data.referred_by;
        this.createdAt = data.created_at;
        this.lastActive = data.last_active;
    }

    static async findOne(query) {
        const supabase = getSupabase();
        
        try {
            if (query.telegramId) {
                const result = await withRetry(async () => {
                    const { data, error } = await supabase
                        .from('users')
                        .select('*')
                        .eq('telegram_id', query.telegramId)
                        .single();
                    
                    if (error && error.code !== 'PGRST116') {
                        throw error;
                    }
                    return { data, error };
                });
                
                return result.data ? new User(result.data) : null;
            }
            
            if (query.id) {
                const result = await withRetry(async () => {
                    const { data, error } = await supabase
                        .from('users')
                        .select('*')
                        .eq('id', query.id)
                        .single();
                    
                    if (error && error.code !== 'PGRST116') {
                        throw error;
                    }
                    return { data, error };
                });
                
                return result.data ? new User(result.data) : null;
            }
            
            return null;
        } catch (error) {
            // Обработка ошибок подключения на уровне catch
            const isConnectionError = error.message?.includes('fetch failed') || 
                                     error.message?.includes('ECONNRESET') ||
                                     error.message?.includes('ECONNREFUSED') ||
                                     error.message?.includes('terminated') ||
                                     error.message?.toLowerCase().includes('connection') ||
                                     error.code === 'ECONNRESET' ||
                                     error.code === 'ECONNREFUSED' ||
                                     error.code === 'ETIMEDOUT';
            
            if (isConnectionError) {
                throw new Error('Временная ошибка подключения к базе данных. Попробуйте еще раз.');
            }
            throw error;
        }
    }

    static async findById(id) {
        return await this.findOne({ id });
    }

    static generateReferralCode(telegramId) {
        // Генерируем код на основе telegram_id
        const base = String(telegramId);
        const hash = base.split('').reduce((acc, char) => {
            return ((acc << 5) - acc) + char.charCodeAt(0);
        }, 0);
        return `ref_${Math.abs(hash).toString(36).substring(0, 8)}`;
    }

    static async create(userData) {
        const supabase = getSupabase();
        
        try {
            // Генерируем реферальный код
            const referralCode = User.generateReferralCode(userData.telegramId);
            
            // Обрабатываем реферальную ссылку, если она есть
            let referredBy = null;
            if (userData.referralCode) {
                const { data: referrer } = await withRetry(async () => {
                    return await supabase
                        .from('users')
                        .select('id')
                        .eq('referral_code', userData.referralCode)
                        .single();
                });
                
                if (referrer) {
                    referredBy = referrer.id;
                }
            }

            const { data, error } = await supabase
                .from('users')
                .insert({
                    telegram_id: userData.telegramId,
                    username: userData.username || 'Игрок',
                    first_name: userData.firstName,
                    last_name: userData.lastName,
                    coins: userData.coins || 1000,
                    referral_code: referralCode,
                    referred_by: referredBy
                })
                .select()
                .single();
            
            if (error) {
                // Обработка ошибок подключения
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

            const user = new User(data);

            // Если пользователь был приглашен, создаем запись в referrals и начисляем бонус
            if (referredBy) {
                try {
                    await withRetry(async () => {
                        return await supabase
                            .from('referrals')
                            .insert({
                                referrer_id: referredBy,
                                referred_id: user.id,
                                bonus_paid: false
                            });
                    });

                    // Начисляем бонус рефереру (100 монет)
                    const referrer = await User.findById(referredBy);
                    if (referrer) {
                        await referrer.addCoins(100);
                    }

                    // Начисляем бонус новому пользователю (100 монет)
                    await user.addCoins(100);
                } catch (refError) {
                    // Не критично, если не удалось обработать реферала
                    console.error('Ошибка обработки реферала:', refError);
                }
            }

            return user;
        } catch (error) {
            // Обработка ошибок подключения на уровне catch
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

    async save() {
        const supabase = getSupabase();
        
        try {
            const updateData = {
                username: this.username,
                first_name: this.firstName,
                last_name: this.lastName,
                coins: this.coins,
                last_active: new Date().toISOString()
            };

            // Обновляем referral_code только если его еще нет
            if (this.referralCode) {
                updateData.referral_code = this.referralCode;
            }

            const { data, error } = await supabase
                .from('users')
                .update(updateData)
                .eq('id', this.id)
                .select()
                .single();
            
            if (error) {
                // Обработка ошибок подключения
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
            Object.assign(this, new User(data));
            return this;
        } catch (error) {
            // Обработка ошибок подключения на уровне catch
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

    async addCoins(amount) {
        const supabase = getSupabase();
        
        try {
            const { data, error } = await supabase.rpc('add_user_coins', {
                user_uuid: this.id,
                amount: amount
            });
            
            if (error) {
                // Обработка ошибок подключения
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
            this.coins = data;
            return this;
        } catch (error) {
            // Обработка ошибок подключения на уровне catch
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

    async spendCoins(amount) {
        const supabase = getSupabase();
        
        try {
            const { data, error } = await supabase.rpc('spend_user_coins', {
                user_uuid: this.id,
                amount: amount
            });
            
            if (error) {
                // Обработка ошибок подключения
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
            this.coins = data;
            return this;
        } catch (error) {
            // Обработка ошибок подключения на уровне catch
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

module.exports = User;
