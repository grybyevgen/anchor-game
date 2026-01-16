const { getSupabase } = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const Ship = require('./Ship');

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

    static async buyFromMarket(cargoId, buyerId, requestedAmount = null) {
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
        
        // Определяем количество для покупки
        const buyAmount = requestedAmount || cargo.amount; // Если не указано - покупаем всё
        
        // Проверка валидности количества
        if (!buyAmount || buyAmount <= 0) {
            throw new AppError('Количество груза должно быть больше 0', 400, 'INVALID_AMOUNT');
        }
        
        // Максимальное количество груза на судне - 100 единиц
        if (buyAmount > 100) {
            throw new AppError('Максимальное количество груза - 100 единиц', 400, 'MAX_CARGO_EXCEEDED');
        }
        
        // Проверка доступного количества
        if (buyAmount > cargo.amount) {
            throw new AppError(`Недостаточно груза на рынке. Доступно: ${cargo.amount}`, 400, 'INSUFFICIENT_CARGO');
        }
        
        // Получаем покупателя
        const { data: buyer, error: buyerError } = await supabase
            .from('users')
            .select('*')
            .eq('id', buyerId)
            .single();
        
        if (buyerError) throw buyerError;
        
        // Вычисляем цену за единицу (цена всего груза / количество)
        const pricePerUnit = Math.floor(cargo.price / cargo.amount);
        const totalPrice = pricePerUnit * buyAmount;
        
        if (buyer.coins < totalPrice) {
            throw new AppError('Недостаточно монет', 400, 'INSUFFICIENT_FUNDS');
        }

        // Определяем тип судна по типу груза
        const cargoToShipType = {
            'oil': 'tanker',
            'materials': 'cargo',
            'provisions': 'supply'
        };

        const requiredShipType = cargoToShipType[cargo.cargo_type];
        if (!requiredShipType) {
            throw new AppError('Неизвестный тип груза', 400, 'INVALID_CARGO_TYPE');
        }

        // Проверяем завершенные путешествия перед поиском судна
        const { checkAndCompleteTravels } = require('../game-logic/shipManager');
        await checkAndCompleteTravels();

        // Ищем подходящее судно покупателя в порту
        const { data: ships, error: shipsError } = await supabase
            .from('ships')
            .select('*')
            .eq('user_id', buyerId)
            .eq('current_port_id', cargo.port_id)
            .eq('type', requiredShipType)
            .eq('is_traveling', false)
            .is('cargo_type', null)
            .limit(1);
        
        if (shipsError) throw shipsError;

        if (!ships || ships.length === 0) {
            const shipTypeNames = {
                'tanker': 'танкер',
                'cargo': 'грузовое судно',
                'supply': 'снабженец'
            };
            throw new AppError(
                `У вас нет подходящего судна в порту для перевозки этого груза. ` +
                `Требуется ${shipTypeNames[requiredShipType]} в порту с грузом, ` +
                `которое не занято и не в пути.`,
                400,
                'NO_SHIP_IN_PORT'
            );
        }

        // Загружаем судно как объект
        const ship = await Ship.findById(ships[0].id);
        if (!ship) {
            throw new AppError('Судно не найдено', 404, 'SHIP_NOT_FOUND');
        }

        // Загружаем груз на судно (только выбранное количество)
        // Сохраняем порт, где находится груз на рынке (порт покупки)
        ship.cargo = {
            type: cargo.cargo_type,
            amount: buyAmount,
            purchasePortId: cargo.port_id  // Порт, где находится груз на рынке
        };
        await ship.save();

        // Списываем монеты у покупателя
        await supabase.rpc('spend_user_coins', {
            user_uuid: buyerId,
            amount: totalPrice
        });
        
        // Начисляем монеты продавцу
        await supabase.rpc('add_user_coins', {
            user_uuid: cargo.seller_id,
            amount: totalPrice
        });
        
        // Обновляем груз на рынке
        const remainingAmount = cargo.amount - buyAmount;
        
        if (remainingAmount === 0) {
            // Если куплено всё - помечаем как проданный
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
            return { success: true, cargo: new Cargo(updatedCargo), ship };
        } else {
            // Если куплена часть - уменьшаем количество и обновляем цену
            const remainingPrice = pricePerUnit * remainingAmount;
            const { data: updatedCargo, error: updateError } = await supabase
                .from('market_cargo')
                .update({
                    amount: remainingAmount,
                    price: remainingPrice
                })
                .eq('id', cargoId)
                .select()
                .single();
            
            if (updateError) throw updateError;
            return { success: true, cargo: new Cargo(updatedCargo), ship, boughtAmount: buyAmount };
        }
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
