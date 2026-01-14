const { getSupabase } = require('../config/database');

class Cargo {
    constructor(data) {
        this.id = data.id;
        this.type = data.cargo_type;
        this.amount = data.amount;
        this.portId = data.port_id;
        this.sellerId = data.seller_id;
        this.price = data.price;
        this.isSold = data.is_sold;
        this.soldTo = data.sold_to;
        this.createdAt = data.created_at;
        this.soldAt = data.sold_at;
    }

    static async findMarketCargo() {
        const supabase = getSupabase();
        
        const { data, error } = await supabase
            .from('market_cargo')
            .select(`
                *,
                port_id:ports(id, name),
                seller_id:users(id, username)
            `)
            .eq('is_sold', false)
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        return data.map(cargo => ({
            id: cargo.id,
            type: cargo.cargo_type,
            amount: cargo.amount,
            price: cargo.price,
            portId: cargo.port_id.id,
            portName: cargo.port_id.name,
            sellerId: cargo.seller_id.id,
            sellerName: cargo.seller_id.username
        }));
    }

    static async buyFromMarket(cargoId, buyerId) {
        const supabase = getSupabase();
        
        // Получаем груз
        const { data: cargo, error: cargoError } = await supabase
            .from('market_cargo')
            .select('*')
            .eq('id', cargoId)
            .single();
        
        if (cargoError) throw cargoError;
        
        if (cargo.is_sold) {
            throw new Error('Груз уже продан');
        }
        
        // Получаем покупателя
        const { data: buyer, error: buyerError } = await supabase
            .from('users')
            .select('*')
            .eq('id', buyerId)
            .single();
        
        if (buyerError) throw buyerError;
        
        if (buyer.coins < cargo.price) {
            throw new Error('Недостаточно монет');
        }
        
        // Списываем монеты у покупателя
        await supabase.rpc('spend_user_coins', {
            user_uuid: buyerId,
            amount: cargo.price
        });
        
        // Начисляем монеты продавцу
        await supabase.rpc('add_user_coins', {
            user_uuid: cargo.seller_id,
            amount: cargo.price
        });
        
        // Помечаем груз как проданный
        const { data: updatedCargo, error: updateError } = await supabase
            .from('market_cargo')
            .update({
                is_sold: true,
                sold_to: buyerId,
                sold_at: new Date().toISOString()
            })
            .eq('id', cargoId)
            .select()
            .single();
        
        if (updateError) throw updateError;
        
        return { success: true, cargo: new Cargo(updatedCargo) };
    }

    static async addToMarket(cargoData) {
        const supabase = getSupabase();
        
        const { data, error } = await supabase
            .from('market_cargo')
            .insert({
                cargo_type: cargoData.type,
                amount: cargoData.amount,
                port_id: cargoData.portId,
                seller_id: cargoData.sellerId,
                price: cargoData.price
            })
            .select()
            .single();
        
        if (error) throw error;
        return new Cargo(data);
    }
}

module.exports = Cargo;
