const { getSupabase } = require('../config/database');

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

    async addCargo(cargoType, amount, price = 0) {
        const supabase = getSupabase();
        
        const { data, error } = await supabase
            .from('port_cargo')
            .upsert({
                port_id: this.id,
                cargo_type: cargoType,
                amount: amount,
                price: price
            }, {
                onConflict: 'port_id,cargo_type'
            })
            .select()
            .single();
        
        if (error) throw error;
        
        // Обновляем локальный кэш
        const existing = this.availableCargo.find(c => c.type === cargoType);
        if (existing) {
            existing.amount += amount;
            if (price > 0) existing.price = price;
        } else {
            this.availableCargo.push({ type: cargoType, amount, price });
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
        
        const { error } = await supabase
            .from('port_cargo')
            .update({ amount: newAmount })
            .eq('port_id', this.id)
            .eq('cargo_type', cargoType);
        
        if (error) throw error;
        
        // Обновляем локальный кэш
        const cargo = this.availableCargo.find(c => c.type === cargoType);
        if (cargo) {
            cargo.amount = newAmount;
        }
        
        return this;
    }
}

module.exports = Port;
