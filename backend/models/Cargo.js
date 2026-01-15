const { getSupabase } = require('../config/database');
const { AppError } = require('../middleware/errorHandler');

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
        
        // Сначала получаем все грузы
        const { data: cargoList, error: cargoError } = await supabase
            .from('market_cargo')
            .select('*')
            .eq('is_sold', false)
            .order('created_at', { ascending: false });
        
        if (cargoError) throw cargoError;
        
        if (!cargoList || cargoList.length === 0) {
            return [];
        }
        
        // Получаем уникальные ID портов и продавцов
        const portIds = [...new Set(cargoList.map(c => c.port_id))];
        const sellerIds = [...new Set(cargoList.map(c => c.seller_id))];
        
        // Загружаем порты
        const { data: ports, error: portsError } = await supabase
            .from('ports')
            .select('id, name')
            .in('id', portIds);
        
        if (portsError) throw portsError;
        
        // Загружаем продавцов
        const { data: sellers, error: sellersError } = await supabase
            .from('users')
            .select('id, username')
            .in('id', sellerIds);
        
        if (sellersError) throw sellersError;
        
        // Создаем мапы для быстрого поиска
        const portsMap = new Map(ports ? ports.map(p => [p.id, p]) : []);
        const sellersMap = new Map(sellers ? sellers.map(s => [s.id, s]) : []);
        
        // Объединяем данные
        return cargoList.map(cargo => {
            const port = portsMap.get(cargo.port_id);
            const seller = sellersMap.get(cargo.seller_id);
            
            return {
                id: cargo.id,
                type: cargo.cargo_type,
                amount: cargo.amount,
                price: cargo.price,
                portId: cargo.port_id,
                portName: port?.name || 'Неизвестно',
                sellerId: cargo.seller_id,
                sellerName: seller?.username || 'Неизвестно'
            };
        });
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
            throw new AppError('Груз уже продан', 400, 'CARGO_ALREADY_SOLD');
        }
        
        // Получаем покупателя
        const { data: buyer, error: buyerError } = await supabase
            .from('users')
            .select('*')
            .eq('id', buyerId)
            .single();
        
        if (buyerError) throw buyerError;
        
        if (buyer.coins < cargo.price) {
            throw new AppError('Недостаточно монет', 400, 'INSUFFICIENT_FUNDS');
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
