const { getSupabase, withRetry } = require('../config/database');

class User {
    constructor(data) {
        this.id = data.id;
        this.telegramId = data.telegram_id;
        this.username = data.username;
        this.firstName = data.first_name;
        this.lastName = data.last_name;
        this.coins = data.coins;
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

    static async create(userData) {
        const supabase = getSupabase();
        
        try {
            const { data, error } = await supabase
                .from('users')
                .insert({
                    telegram_id: userData.telegramId,
                    username: userData.username || 'Игрок',
                    first_name: userData.firstName,
                    last_name: userData.lastName,
                    coins: userData.coins || 1000
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
            return new User(data);
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
            const { data, error } = await supabase
                .from('users')
                .update({
                    username: this.username,
                    first_name: this.firstName,
                    last_name: this.lastName,
                    coins: this.coins,
                    last_active: new Date().toISOString()
                })
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
