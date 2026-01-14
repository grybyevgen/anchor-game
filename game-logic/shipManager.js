const Ship = require('../models/Ship');
const Port = require('../models/Port');
const Cargo = require('../models/Cargo');
const User = require('../models/User');

async function sendShipToPort(shipId, portId) {
    const ship = await Ship.findById(shipId);
    if (!ship) {
        return { success: false, error: 'Судно не найдено' };
    }

    if (ship.isTraveling) {
        return { success: false, error: 'Судно уже в пути' };
    }

    const port = await Port.findById(portId);
    if (!port) {
        return { success: false, error: 'Порт не найден' };
    }

    if (ship.currentPortId === portId) {
        return { success: false, error: 'Судно уже в этом порту' };
    }

    const fuelCost = 10;
    
    if (ship.fuel < fuelCost) {
        return { success: false, error: 'Недостаточно топлива' };
    }

    const travelTime = 30000; // 30 секунд
    
    ship.fuel -= fuelCost;
    await ship.startTravel(portId, travelTime);
    
    setTimeout(async () => {
        try {
            const shipToUpdate = await Ship.findById(shipId);
            if (shipToUpdate && shipToUpdate.isTraveling) {
                await shipToUpdate.completeTravel();
                console.log(`Судно ${shipToUpdate.name} прибыло в порт`);
            }
        } catch (error) {
            console.error('Ошибка завершения путешествия:', error);
        }
    }, travelTime);
    
    return { success: true, ship, travelTime };
}

async function loadCargo(shipId, cargoType, amount) {
    const ship = await Ship.findById(shipId);
    if (!ship) {
        return { success: false, error: 'Судно не найдено' };
    }

    if (ship.cargo) {
        return { success: false, error: 'Судно уже загружено' };
    }

    if (ship.isTraveling) {
        return { success: false, error: 'Судно в пути' };
    }

    const port = await Port.findById(ship.currentPortId);
    const cargo = port.getCargo(cargoType);
    
    if (!cargo || cargo.amount < amount) {
        return { success: false, error: 'Недостаточно груза в порту' };
    }

    if (!ship.canLoadCargo(cargoType)) {
        return { success: false, error: 'Этот тип судна не может перевозить данный груз' };
    }

    ship.cargo = { type: cargoType, amount };
    await ship.save();
    
    await port.removeCargo(cargoType, amount);
    
    return { success: true, ship };
}

async function unloadCargo(shipId) {
    const ship = await Ship.findById(shipId);
    if (!ship) {
        return { success: false, error: 'Судно не найдено' };
    }

    if (!ship.cargo) {
        return { success: false, error: 'Судно пустое' };
    }

    if (ship.isTraveling) {
        return { success: false, error: 'Судно в пути' };
    }

    const baseReward = ship.cargo.amount * 10;
    const reward = Math.floor(baseReward * (1 + (ship.crewLevel - 1) * 0.1));

    await Cargo.addToMarket({
        type: ship.cargo.type,
        amount: ship.cargo.amount,
        portId: ship.currentPortId,
        sellerId: ship.userId,
        price: Math.floor(reward * 0.8)
    });

    const user = await User.findById(ship.userId);
    await user.addCoins(reward);

    const cargo = ship.cargo;
    ship.cargo = null;
    await ship.save();
    
    return { success: true, reward, cargo };
}

async function repairShip(shipId) {
    const ship = await Ship.findById(shipId);
    if (!ship) {
        return { success: false, error: 'Судно не найдено' };
    }

    if (ship.health >= ship.maxHealth) {
        return { success: false, error: 'Судно уже полностью исправно' };
    }

    if (ship.isTraveling) {
        return { success: false, error: 'Судно в пути' };
    }

    const repairCost = (ship.maxHealth - ship.health) * 5;
    
    const user = await User.findById(ship.userId);
    if (user.coins < repairCost) {
        return { success: false, error: 'Недостаточно монет для ремонта' };
    }

    ship.health = ship.maxHealth;
    await ship.save();
    
    await user.spendCoins(repairCost);
    
    return { success: true, ship, cost: repairCost };
}

module.exports = {
    sendShipToPort,
    loadCargo,
    unloadCargo,
    repairShip
};
