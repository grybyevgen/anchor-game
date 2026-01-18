const Ship = require('../models/Ship');
const Port = require('../models/Port');
const Cargo = require('../models/Cargo');
const User = require('../models/User');
const gameConfig = require('../config/gameConfig');

/**
 * Отправить судно в порт
 * Теперь использует проверку по времени вместо setTimeout
 */
async function sendShipToPort(shipId, portId) {
    const ship = await Ship.findById(shipId);
    if (!ship) {
        return { success: false, error: 'Судно не найдено' };
    }

    if (ship.isTraveling) {
        return { success: false, error: 'Судно уже в пути' };
    }

    const destinationPort = await Port.findById(portId);
    if (!destinationPort) {
        return { success: false, error: 'Порт назначения не найден' };
    }

    const currentPort = await Port.findById(ship.currentPortId);
    if (!currentPort) {
        return { success: false, error: 'Текущий порт не найден' };
    }

    if (ship.currentPortId === portId) {
        return { success: false, error: 'Судно уже в этом порту' };
    }

    // Рассчитываем расстояние между портами
    const distance = Port.calculateDistance(currentPort, destinationPort);
    
    // Рассчитываем расход топлива на основе расстояния
    const fuelConsumptionRate = gameConfig.fuelCost.consumptionPerMile[ship.type] || 0.12;
    let fuelCost = Math.max(
        distance * fuelConsumptionRate,
        gameConfig.fuelCost.minFuelPerTravel
    );
    
    // Если судно перевозит груз, расход немного увеличивается
    if (ship.cargo) {
        fuelCost = fuelCost * 1.1; // +10% к расходу с грузом
    }
    
    fuelCost = Math.round(fuelCost);
    
    if (ship.fuel < fuelCost) {
        return { success: false, error: `Недостаточно топлива. Требуется: ${fuelCost}, доступно: ${ship.fuel}` };
    }

    // ВРЕМЕННО ДЛЯ ТЕСТОВ: фиксированное время рейса 30 секунд
    // TODO: ВЕРНУТЬ РЕАЛИСТИЧНОЕ ВРЕМЯ В БУДУЩЕМ
    const travelTime = 30000; // 30 секунд для всех рейсов
    
    // РЕАЛИСТИЧНЫЙ РАСЧЕТ (закомментирован для тестов):
    // const shipSpeed = gameConfig.shipSpeed[ship.type] || 18; // Морские мили в час
    // const travelTimeHours = distance / shipSpeed;
    // const travelTime = Math.max(
    //     travelTimeHours * 60 * 1000, // 1 час = 1 минута реального времени
    //     gameConfig.travelTime.default // Минимум 30 секунд
    // );
    const travelEndTime = new Date(Date.now() + travelTime);
    
    ship.fuel -= fuelCost;
    await ship.startTravel(portId, travelTime);
    
    // Не используем setTimeout - путешествие будет завершено при следующей проверке
    // через endpoint /api/ships/check-travels или при любом запросе к судну
    
    return { 
        success: true, 
        ship, 
        travelTime,
        travelEndTime: travelEndTime.toISOString(),
        distance,
        fuelCost
    };
}

/**
 * Проверить и завершить завершенные путешествия
 * Должна вызываться периодически или при запросах
 */
async function checkAndCompleteTravels() {
    try {
        const supabase = require('../config/database').getSupabase();
        const now = new Date().toISOString();
        
        // Находим все судна, которые должны были прибыть
        const { data: travelingShips, error } = await supabase
            .from('ships')
            .select('*')
            .eq('is_traveling', true)
            .lte('travel_end_time', now);
        
        if (error) {
            console.error('Ошибка при проверке путешествий:', error);
            return { completed: 0, error: error.message };
        }
        
        let completed = 0;
        for (const shipData of travelingShips || []) {
            try {
                const ship = new Ship(shipData);
                
                // Портовые сборы теперь взимаются только при выгрузке груза
                // Если судно с грузом - сбор будет взят при выгрузке
                // Если судно пустое - сборов нет
                if (ship.cargo) {
                    console.log(`🚢 Судно ${ship.name} прибыло с грузом. Сбор будет взят при выгрузке.`);
                } else {
                    console.log(`✅ Судно ${ship.name} прибыло пустым. Сборов нет.`);
                }
                
                await ship.completeTravel();
                console.log(`✅ Судно ${ship.name} прибыло в порт`);
                completed++;
            } catch (err) {
                console.error(`Ошибка завершения путешествия для судна ${shipData.id}:`, err);
            }
        }
        
        return { completed, total: travelingShips?.length || 0 };
    } catch (error) {
        console.error('Ошибка проверки путешествий:', error);
        return { completed: 0, error: error.message };
    }
}

/**
 * Проверить конкретное судно и завершить путешествие если оно завершено
 */
async function checkShipTravel(shipId) {
    const ship = await Ship.findById(shipId);
    if (!ship) {
        return { success: false, error: 'Судно не найдено' };
    }
    
    if (!ship.isTraveling) {
        return { success: true, completed: false, ship };
    }
    
    // Проверяем, завершилось ли путешествие
    if (ship.travelEndTime && new Date(ship.travelEndTime) <= new Date()) {
        await ship.completeTravel();
        return { success: true, completed: true, ship };
    }
    
    return { success: true, completed: false, ship };
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

    // Проверка валидности количества
    if (!amount || amount <= 0) {
        return { success: false, error: 'Количество груза должно быть больше 0' };
    }
    
    // Максимальное количество груза на судне - 100 единиц
    if (amount > 100) {
        return { success: false, error: 'Максимальное количество груза - 100 единиц' };
    }
    
    const port = await Port.findById(ship.currentPortId);
    const cargo = port.getCargo(cargoType);
    
    if (!cargo || cargo.amount < amount) {
        return { success: false, error: 'Недостаточно груза в порту' };
    }

    if (!ship.canLoadCargo(cargoType)) {
        return { success: false, error: 'Этот тип судна не может перевозить данный груз' };
    }

    // Вычисляем стоимость груза (цена за единицу * количество)
    const cargoPrice = (cargo.price || 0) * amount;
    
    // Получаем пользователя
    const user = await User.findById(ship.userId);
    if (!user) {
        return { success: false, error: 'Пользователь не найден' };
    }
    
    // Проверяем баланс
    if (user.coins < cargoPrice) {
        return { success: false, error: 'Недостаточно денег' };
    }
    
        // Списываем деньги
        try {
            await user.spendCoins(cargoPrice);
            
            // Загружаем груз на судно и сохраняем порт покупки
            ship.cargo = { 
                type: cargoType, 
                amount,
                purchasePortId: ship.currentPortId  // Сохраняем порт, где купили груз
            };
            await ship.save();
            
            // Удаляем груз из порта
            await port.removeCargo(cargoType, amount);
            
            return { success: true, ship };
        } catch (error) {
            console.error('Ошибка при загрузке груза:', error);
            throw error;
        }
}

async function unloadCargo(shipId, destination = 'market') {
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

    // Проверка: нельзя продать груз в порту, где он был куплен (ни на рынок, ни в порт)
    if (ship.cargo.purchasePortId === ship.currentPortId) {
        return { 
            success: false, 
            error: 'Нельзя продать груз в порту, где он был куплен. Перевезите груз в другой порт, чтобы продать его там.' 
        };
    }

    // Используем транзакцию для атомарности операций
    try {
        const currentPort = await Port.findById(ship.currentPortId);
        const purchasePort = await Port.findById(ship.cargo.purchasePortId);
        
        // Рассчитываем расстояние между портами
        const distance = Port.calculateDistance(purchasePort, currentPort);
        
        // Базовая стоимость груза по типу
        const cargoBaseValue = gameConfig.economy.cargoBaseValue[ship.cargo.type] || 25;
        
        // Рассчитываем базовую цену продажи с учетом расстояния
        // Формула: базовая_стоимость + (расстояние * множитель_расстояния)
        const basePricePerUnit = cargoBaseValue + (distance * gameConfig.economy.distancePriceMultiplier);
        
        // Рассчитываем множитель спроса/предложения в порту назначения
        const portCargo = currentPort.getCargo(ship.cargo.type);
        let demandMultiplier = 1.0;
        
        if (portCargo) {
            const pricing = gameConfig.economy.portCargoPricing;
            const normalizedAmount = Math.min(portCargo.amount / pricing.referenceAmount, 1);
            // Чем меньше груза в порту, тем выше спрос (и цена)
            demandMultiplier = gameConfig.economy.demandMultiplier.min + 
                             (gameConfig.economy.demandMultiplier.max - gameConfig.economy.demandMultiplier.min) * (1 - normalizedAmount);
        } else {
            // Если груза нет в порту - максимальный спрос
            demandMultiplier = gameConfig.economy.demandMultiplier.max;
        }
        
        // Рассчитываем итоговую цену за единицу с учетом спроса
        const pricePerUnit = basePricePerUnit * demandMultiplier;
        
        // Рассчитываем валовую прибыль (до вычета сборов и налогов)
        let baseReward = pricePerUnit * ship.cargo.amount;
        
        // Применяем бонус от уровня экипажа
        const crewBonus = 1 + (ship.crewLevel - 1) * gameConfig.economy.rewardMultiplierPerCrewLevel;
        const grossReward = Math.floor(baseReward * crewBonus);

        // Сохраняем данные груза
        const cargoData = {
            type: ship.cargo.type,
            amount: ship.cargo.amount
        };

        // ВСЕ СБОРЫ И НАЛОГИ ТЕПЕРЬ В % ОТ ПРИБЫЛИ
        // Портовые сборы: только процент от прибыли (включает вход с грузом + выгрузку)
        const unloadingPercentage = gameConfig.economy.portFees.unloadingPercentage || 0.15;
        const portFees = Math.floor(grossReward * unloadingPercentage);
        
        // Налог на прибыль: процент от прибыли после портовых сборов
        const profitAfterPortFees = grossReward - portFees;
        const profitTax = profitAfterPortFees > 0 
            ? Math.floor(profitAfterPortFees * (gameConfig.economy.profitTax || 0))
            : 0;  // Если прибыль отрицательная - налога нет

        // Рассчитываем итоговую прибыль (все вычитается из прибыли)
        const netReward = grossReward - portFees - profitTax;

        const user = await User.findById(ship.userId);
        if (!user) {
            throw new Error('Пользователь не найден');
        }

        // Начисляем чистую прибыль одной операцией (сборы и налоги уже вычтены)
        // Это гарантирует, что нет проблем с недостатком денег
        await user.addCoins(netReward);

        // Добавляем груз в рынок/порт ТОЛЬКО после финансовых операций
        if (destination === 'port') {
            // Продажа в порт - пополняем запасы порта
            await currentPort.addCargo(cargoData.type, cargoData.amount);
        } else {
            // Продажа на рынок
            const marketPrice = Math.floor(grossReward * gameConfig.economy.marketPriceMultiplier);
            await Cargo.addToMarket({
                type: cargoData.type,
                amount: cargoData.amount,
                portId: ship.currentPortId,
                sellerId: ship.userId,
                price: marketPrice
            });
        }

        // Очищаем груз ТОЛЬКО после всех операций
        ship.cargo = null;
        await ship.save();
        
        return { 
            success: true, 
            reward: netReward, 
            grossReward: grossReward,
            portFees,
            profitTax,
            cargo: cargoData, 
            destination,
            distance
        };
    } catch (error) {
        console.error('Ошибка выгрузки груза:', error);
        // В случае ошибки состояние должно остаться согласованным
        throw error;
    }
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

    const repairCost = (ship.maxHealth - ship.health) * gameConfig.economy.repairCostPerHealth;
    
    const user = await User.findById(ship.userId);
    if (!user) {
        return { success: false, error: 'Пользователь не найден' };
    }
    
    if (user.coins < repairCost) {
        return { success: false, error: 'Недостаточно монет для ремонта' };
    }

    // Атомарная операция: сначала списываем монеты, потом чиним
    try {
        await user.spendCoins(repairCost);
        ship.health = ship.maxHealth;
        await ship.save();
        
        return { success: true, ship, cost: repairCost };
    } catch (error) {
        console.error('Ошибка ремонта судна:', error);
        throw error;
    }
}

async function refuelShip(shipId, cargoId, amount) {
    const ship = await Ship.findById(shipId);
    if (!ship) {
        return { success: false, error: 'Судно не найдено' };
    }

    if (ship.isTraveling) {
        return { success: false, error: 'Судно в пути' };
    }

    // Получаем нефть с рынка
    const { getSupabase } = require('../config/database');
    const supabase = getSupabase();
    
    const { data: cargo, error: cargoError } = await supabase
        .from('market_cargo')
        .select('*')
        .eq('id', cargoId)
        .eq('cargo_type', 'oil')
        .eq('port_id', ship.currentPortId)
        .eq('is_sold', false)
        .single();
    
    if (cargoError || !cargo) {
        return { success: false, error: 'Нефть не найдена на рынке в этом порту' };
    }

    // Проверка количества
    if (!amount || amount <= 0) {
        return { success: false, error: 'Количество нефти должно быть больше 0' };
    }

    if (amount > cargo.amount) {
        return { success: false, error: `Недостаточно нефти на рынке. Доступно: ${cargo.amount}` };
    }

    // Вычисляем сколько топлива можно заправить (не больше максимума)
    const fuelNeeded = ship.maxFuel - ship.fuel;
    if (fuelNeeded <= 0) {
        return { success: false, error: 'Судно уже полностью заправлено' };
    }

    const actualAmount = Math.min(amount, fuelNeeded); // Реальное количество для заправки
    
    // Вычисляем цену за единицу и общую цену
    const pricePerUnit = Math.floor(cargo.price / cargo.amount);
    const totalPrice = pricePerUnit * actualAmount;

    // Получаем пользователя
    const user = await User.findById(ship.userId);
    if (!user) {
        return { success: false, error: 'Пользователь не найден' };
    }

    if (user.coins < totalPrice) {
        return { success: false, error: 'Недостаточно монет' };
    }

    try {
        // Списываем деньги у покупателя
        await supabase.rpc('spend_user_coins', {
            user_uuid: ship.userId,
            amount: totalPrice
        });

        // Начисляем монеты продавцу
        await supabase.rpc('add_user_coins', {
            user_uuid: cargo.seller_id,
            amount: totalPrice
        });

        // Заправляем судно
        ship.fuel = Math.min(ship.fuel + actualAmount, ship.maxFuel);
        await ship.save();

        // Обновляем рынок
        const remainingAmount = cargo.amount - actualAmount;
        if (remainingAmount === 0) {
            // Если куплено всё - помечаем как проданный
            await supabase
                .from('market_cargo')
                .update({
                    is_sold: true,
                    sold_to: ship.userId,
                    sold_at: new Date().toISOString()
                })
                .eq('id', cargoId);
        } else {
            // Если куплена часть - уменьшаем количество и обновляем цену
            const remainingPrice = pricePerUnit * remainingAmount;
            await supabase
                .from('market_cargo')
                .update({
                    amount: remainingAmount,
                    price: remainingPrice
                })
                .eq('id', cargoId);
        }

        return { 
            success: true, 
            ship, 
            fueled: actualAmount,
            cost: totalPrice
        };
    } catch (error) {
        console.error('Ошибка при заправке судна:', error);
        throw error;
    }
}

module.exports = {
    sendShipToPort,
    loadCargo,
    unloadCargo,
    repairShip,
    refuelShip,
    checkAndCompleteTravels,
    checkShipTravel
};
