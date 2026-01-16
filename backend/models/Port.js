const { getSupabase } = require('../config/database');
const gameConfig = require('../config/gameConfig');

class Port {
    constructor(data) {
        this.id = data.id;
        this.name = data.name;
        this.location = data.location_lat ? {
            lat: parseFloat(data.location_lat),
            lng: parseFloat(data.location_lng)
        } : null;
        this.createdAt = data.created_at;
        this.availableCargo = data.availableCargo || [];
    }

    static async findAll() {
        const supabase = getSupabase();
        
        // Получаем порты
        const { data: ports, error: portsError } = await supabase
            .from('ports')
            .select('*')
            .order('name');
        
        if (portsError) throw portsError;
        
        // Получаем грузы для каждого порта
        const { data: cargo, error: cargoError } = await supabase
            .from('port_cargo')
            .select('*');
        
        if (cargoError) throw cargoError;
        
        // Объединяем данные
        return ports.map(port => {
            const portCargo = cargo
                .filter(c => c.port_id === port.id)
                .map(c => ({
                    type: c.cargo_type,
                    amount: c.amount,
                    price: c.price
                }));
            
            return new Port({
                ...port,
                availableCargo: portCargo
            });
        });
    }

    static async findById(id) {
        const supabase = getSupabase();
        
        const { data: port, error: portError } = await supabase
            .from('ports')
            .select('*')
            .eq('id', id)
            .single();
        
        if (portError) throw portError;
        
        // Получаем грузы порта
        const { data: cargo, error: cargoError } = await supabase
            .from('port_cargo')
            .select('*')
            .eq('port_id', id);
        
        if (cargoError) throw cargoError;
        
        return new Port({
            ...port,
            availableCargo: cargo.map(c => ({
                type: c.cargo_type,
                amount: c.amount,
                price: c.price
            }))
        });
    }

    getCargo(cargoType) {
        return this.availableCargo.find(c => c.type === cargoType);
    }

    /**
     * Рассчитывает динамическую цену груза на основе текущего количества
     * @param {number} currentAmount - Текущее количество груза в порту
     * @returns {number} - Цена за единицу груза
     */
    static calculateDynamicPrice(currentAmount) {
        const pricing = gameConfig.economy.portCargoPricing;
        
        // Если груза очень мало - максимальная цена
        if (currentAmount <= pricing.minAmount) {
            return pricing.maxPrice;
        }
        
        // Нормализуем количество относительно эталонного
        const normalizedAmount = Math.min(currentAmount / pricing.referenceAmount, 1);
        
        // Рассчитываем цену: чем меньше груза, тем выше цена
        // Формула: minPrice + (maxPrice - minPrice) * (1 - normalizedAmount)
        const price = pricing.minPrice + (pricing.maxPrice - pricing.minPrice) * (1 - normalizedAmount);
        
        // Округляем до целого числа
        return Math.round(price);
    }

    async addCargo(cargoType, amount, price = null) {
        const supabase = getSupabase();
        
        // Получаем текущее количество груза
        const { data: current, error: fetchError } = await supabase
            .from('port_cargo')
            .select('amount')
            .eq('port_id', this.id)
            .eq('cargo_type', cargoType)
            .single();
        
        let newAmount, newPrice;
        
        if (fetchError || !current) {
            // Если груза еще нет - создаем новый
            newAmount = amount;
            newPrice = price !== null ? price : Port.calculateDynamicPrice(newAmount);
        } else {
            // Если груз уже есть - добавляем к существующему
            newAmount = current.amount + amount;
            // Пересчитываем цену на основе нового количества
            newPrice = Port.calculateDynamicPrice(newAmount);
        }
        
        const { data, error } = await supabase
            .from('port_cargo')
            .upsert({
                port_id: this.id,
                cargo_type: cargoType,
                amount: newAmount,
                price: newPrice
            }, {
                onConflict: 'port_id,cargo_type'
            })
            .select()
            .single();
        
        if (error) throw error;
        
        // Обновляем локальный кэш
        const existing = this.availableCargo.find(c => c.type === cargoType);
        if (existing) {
            existing.amount = newAmount;
            existing.price = newPrice;
        } else {
            this.availableCargo.push({ type: cargoType, amount: newAmount, price: newPrice });
        }
        
        return this;
    }

    async removeCargo(cargoType, amount) {
        const supabase = getSupabase();
        
        // Получаем текущее количество
        const { data: current, error: fetchError } = await supabase
            .from('port_cargo')
            .select('amount')
            .eq('port_id', this.id)
            .eq('cargo_type', cargoType)
            .single();
        
        if (fetchError) throw fetchError;
        
        if (current.amount < amount) {
            throw new Error('Недостаточно груза в порту');
        }
        
        const newAmount = current.amount - amount;
        // Пересчитываем цену на основе нового количества
        const newPrice = Port.calculateDynamicPrice(newAmount);
        
        const { error } = await supabase
            .from('port_cargo')
            .update({ 
                amount: newAmount,
                price: newPrice
            })
            .eq('port_id', this.id)
            .eq('cargo_type', cargoType);
        
        if (error) throw error;
        
        // Обновляем локальный кэш
        const cargo = this.availableCargo.find(c => c.type === cargoType);
        if (cargo) {
            cargo.amount = newAmount;
            cargo.price = newPrice;
        }
        
        return this;
    }
}

module.exports = Port;
