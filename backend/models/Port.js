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
     * Рассчитывает расстояние между двумя портами по формуле Haversine
     * @param {Port} port1 - Первый порт
     * @param {Port} port2 - Второй порт
     * @returns {number} - Расстояние в морских милях
     */
    static calculateDistance(port1, port2) {
        if (!port1.location || !port2.location) {
            // Если координаты не указаны, возвращаем среднее расстояние (например, 1000 миль)
            return 1000;
        }

        // Специальный балансный случай: расстояние между "Провизионным заводом" и "Заводом Материалов"
        // фиксируем в 1959 миль (в обе стороны), независимо от координат.
        const name1 = port1.name;
        const name2 = port2.name;
        const isNovoSpbPair =
            (name1 === 'Порт "Провизионный завод"' && name2 === 'Порт "Завод Материалов"') ||
            (name1 === 'Порт "Завод Материалов"' && name2 === 'Порт "Провизионный завод"');

        if (isNovoSpbPair) {
            return 1959;
        }

        const R = 3440; // Радиус Земли в морских милях
        const lat1 = port1.location.lat * Math.PI / 180;
        const lat2 = port2.location.lat * Math.PI / 180;
        const deltaLat = (port2.location.lat - port1.location.lat) * Math.PI / 180;
        const deltaLng = (port2.location.lng - port1.location.lng) * Math.PI / 180;

        const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
                  Math.cos(lat1) * Math.cos(lat2) *
                  Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        const distance = R * c;
        return Math.round(distance * 10) / 10; // Округляем до 0.1 мили
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
        
        // Правильно обрабатываем ошибку "не найдено" (код 'PGRST116')
        // Это нормальная ситуация, когда груза еще нет в порту
        const isNotFound = fetchError && fetchError.code === 'PGRST116';
        
        if (isNotFound || !current) {
            // Если груза еще нет - создаем новый
            newAmount = amount;
            newPrice = price !== null ? price : Port.calculateDynamicPrice(newAmount);
        } else if (fetchError) {
            // Если другая ошибка - пробрасываем её
            throw fetchError;
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
        
        if (error) {
            console.error('Ошибка при upsert груза в порт:', error);
            throw error;
        }
        
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
        
        // Правильно обрабатываем ошибку "не найдено"
        if (fetchError) {
            // Если это ошибка "не найдено" - груза нет, это нормально
            if (fetchError.code === 'PGRST116') {
                throw new Error('Груз не найден в порту');
            }
            // Иначе пробрасываем ошибку
            throw fetchError;
        }
        
        if (!current || current.amount < amount) {
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
        
        if (error) {
            console.error('Ошибка при обновлении груза в порту:', error);
            throw error;
        }
        
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
