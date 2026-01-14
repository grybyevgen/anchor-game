const { getSupabase } = require('../config/database');

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
        
        if (query.telegramId) {
            const { data, error } = await supabase
                .from('users')
                .select('*')
                .eq('telegram_id', query.telegramId)
                .single();
            
            if (error && error.code !== 'PGRST116') throw error;
            return data ? new User(data) : null;
        }
        
        if (query.id) {
            const { data, error } = await supabase
                .from('users')
                .select('*')
                .eq('id', query.id)
                .single();
            
            if (error && error.code !== 'PGRST116') throw error;
            return data ? new User(data) : null;
        }
        
        return null;
    }

    static async findById(id) {
        return await this.findOne({ id });
    }

    static async create(userData) {
        const supabase = getSupabase();
        
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
        
        if (error) throw error;
        return new User(data);
    }

    async save() {
        const supabase = getSupabase();
        
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
        
        if (error) throw error;
        Object.assign(this, new User(data));
        return this;
    }

    async addCoins(amount) {
        const supabase = getSupabase();
        
        const { data, error } = await supabase.rpc('add_user_coins', {
            user_uuid: this.id,
            amount: amount
        });
        
        if (error) throw error;
        this.coins = data;
        return this;
    }

    async spendCoins(amount) {
        const supabase = getSupabase();
        
        const { data, error } = await supabase.rpc('spend_user_coins', {
            user_uuid: this.id,
            amount: amount
        });
        
        if (error) throw error;
        this.coins = data;
        return this;
    }
}

module.exports = User;
