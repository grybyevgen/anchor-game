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
            purchasePortId: data.cargo_purchase_port_id,
            // Может быть null для старых записей, поэтому по умолчанию 0
            purchasePricePerUnit: data.cargo_purchase_price_per_unit ?? 0
        } : null;
        this.isTraveling = data.is_traveling;
        this.travelStartTime = data.travel_start_time;
        this.travelEndTime = data.travel_end_time;
        this.destinationPortId = data.destination_port_id;
        this.createdAt = data.created_at;
        // Статистика по судну
        this.purchasePrice = data.purchase_price ?? 0;
        this.totalDistanceNm = data.total_distance_nm ?? 0;
        this.totalTrips = data.total_trips ?? 0;
        this.totalCargoMoved = data.total_cargo_moved ?? 0;
        this.totalProfit = data.total_profit ?? 0;
        this.totalFuelCost = data.total_fuel_cost ?? 0;
        this.totalCargoCost = data.total_cargo_cost ?? 0;
        this.totalRepairCost = data.total_repair_cost ?? 0;
        this.totalTowCost = data.total_tow_cost ?? 0;
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
                crew_level: shipData.crewLevel || 1,
                purchase_price: shipData.purchasePrice || 0,
                total_distance_nm: 0,
                total_trips: 0,
                total_cargo_moved: 0,
                total_profit: 0,
                total_fuel_cost: 0,
                total_cargo_cost: 0,
                total_repair_cost: 0,
                total_tow_cost: 0
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
            cargo_purchase_price_per_unit: this.cargo ? (this.cargo.purchasePricePerUnit || 0) : null,
            is_traveling: this.isTraveling,
            travel_start_time: this.travelStartTime,
            travel_end_time: this.travelEndTime,
            destination_port_id: this.destinationPortId,
            purchase_price: this.purchasePrice ?? 0,
            total_distance_nm: this.totalDistanceNm ?? 0,
            total_trips: this.totalTrips ?? 0,
            total_cargo_moved: this.totalCargoMoved ?? 0,
            total_profit: this.totalProfit ?? 0,
            total_fuel_cost: this.totalFuelCost ?? 0,
            total_cargo_cost: this.totalCargoCost ?? 0,
            total_repair_cost: this.totalRepairCost ?? 0,
            total_tow_cost: this.totalTowCost ?? 0
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
