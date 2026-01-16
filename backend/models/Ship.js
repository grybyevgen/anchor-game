const { getSupabase } = require('../config/database');

class Ship {
    constructor(data) {
        this.id = data.id;
        this.userId = data.user_id;
        this.type = data.type;
        this.name = data.name;
        this.currentPortId = data.current_port_id;
        this.fuel = data.fuel;
        this.maxFuel = data.max_fuel;
        this.health = data.health;
        this.maxHealth = data.max_health;
        this.crewLevel = data.crew_level;
        this.cargo = data.cargo_type ? {
            type: data.cargo_type,
            amount: data.cargo_amount,
            purchasePortId: data.cargo_purchase_port_id
        } : null;
        this.isTraveling = data.is_traveling;
        this.travelStartTime = data.travel_start_time;
        this.travelEndTime = data.travel_end_time;
        this.destinationPortId = data.destination_port_id;
        this.createdAt = data.created_at;
    }

    static async find(query) {
        const supabase = getSupabase();
        let queryBuilder = supabase.from('ships').select('*');
        
        if (query.userId) {
            queryBuilder = queryBuilder.eq('user_id', query.userId);
        }
        
        const { data, error } = await queryBuilder;
        if (error) throw error;
        
        return data.map(ship => new Ship(ship));
    }

    static async findById(id) {
        const supabase = getSupabase();
        
        const { data, error } = await supabase
            .from('ships')
            .select('*')
            .eq('id', id)
            .single();
        
        if (error && error.code !== 'PGRST116') throw error;
        return data ? new Ship(data) : null;
    }

    static async create(shipData) {
        const supabase = getSupabase();
        
        const { data, error } = await supabase
            .from('ships')
            .insert({
                user_id: shipData.userId,
                type: shipData.type,
                name: shipData.name,
                current_port_id: shipData.currentPortId,
                fuel: shipData.fuel || 100,
                max_fuel: shipData.maxFuel || 100,
                health: shipData.health || 100,
                max_health: shipData.maxHealth || 100,
                crew_level: shipData.crewLevel || 1
            })
            .select()
            .single();
        
        if (error) throw error;
        return new Ship(data);
    }

    async save() {
        const supabase = getSupabase();
        
        const updateData = {
            name: this.name,
            current_port_id: this.currentPortId,
            fuel: this.fuel,
            max_fuel: this.maxFuel,
            health: this.health,
            max_health: this.maxHealth,
            crew_level: this.crewLevel,
            cargo_type: this.cargo ? this.cargo.type : null,
            cargo_amount: this.cargo ? this.cargo.amount : null,
            cargo_purchase_port_id: this.cargo?.purchasePortId || null,
            is_traveling: this.isTraveling,
            travel_start_time: this.travelStartTime,
            travel_end_time: this.travelEndTime,
            destination_port_id: this.destinationPortId
        };
        
        const { data, error } = await supabase
            .from('ships')
            .update(updateData)
            .eq('id', this.id)
            .select()
            .single();
        
        if (error) throw error;
        Object.assign(this, new Ship(data));
        return this;
    }

    canLoadCargo(cargoType) {
        const cargoCompatibility = {
            'tanker': ['oil'],
            'cargo': ['materials'],
            'supply': ['provisions']
        };
        return cargoCompatibility[this.type].includes(cargoType);
    }

    async startTravel(destinationPortId, travelTime) {
        this.isTraveling = true;
        this.destinationPortId = destinationPortId;
        this.travelStartTime = new Date().toISOString();
        this.travelEndTime = new Date(Date.now() + travelTime).toISOString();
        return await this.save();
    }

    async completeTravel() {
        this.isTraveling = false;
        this.currentPortId = this.destinationPortId;
        this.destinationPortId = null;
        this.travelStartTime = null;
        this.travelEndTime = null;
        return await this.save();
    }
}

module.exports = Ship;
