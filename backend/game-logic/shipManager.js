const Ship = require('../models/Ship');
const Port = require('../models/Port');
const Cargo = require('../models/Cargo');
const User = require('../models/User');
const gameConfig = require('../config/gameConfig');
const portManager = require('./portManager');

/**
 * Отправить судно в порт
 * Теперь использует проверку по времени вместо setTimeout
 */
async function sendShipToPort(shipId, portId) {
    let ship, currentPort, destinationPort;
    
    try {
        ship = await Ship.findById(shipId);
        if (!ship) {
            console.error(`[sendShipToPort] Судно не найдено: ${shipId}`);
            return { success: false, error: 'Судно не найдено' };
        }

        if (ship.isTraveling) {
            console.error(`[sendShipToPort] Судно уже в пути: ${shipId}`);
            return { success: false, error: 'Судно уже в пути' };
        }

        destinationPort = await Port.findById(portId);
        if (!destinationPort) {
            console.error(`[sendShipToPort] Порт назначения не найден: ${portId}`);
            return { success: false, error: 'Порт назначения не найден' };
        }

        currentPort = await Port.findById(ship.currentPortId);
        if (!currentPort) {
            console.error(`[sendShipToPort] Текущий порт не найден: ${ship.currentPortId} для судна ${shipId}`);
            return { success: false, error: `Текущий порт не найден (ID: ${ship.currentPortId})` };
        }

        if (ship.currentPortId === portId) {
            console.error(`[sendShipToPort] Судно уже в этом порту: ${shipId} в порту ${portId}`);
            return { success: false, error: 'Судно уже в этом порту' };
        }

        console.log(`[sendShipToPort] Отправка судна ${shipId} из порта "${currentPort.name}" (${ship.currentPortId}) в порт "${destinationPort.name}" (${portId})`);
    } catch (error) {
        console.error(`[sendShipToPort] Ошибка при проверке параметров:`, error);
        return { success: false, error: `Ошибка при проверке параметров: ${error.message}` };
    }

    try {
        // Рассчитываем расстояние между портами
        const distance = Port.calculateDistance(currentPort, destinationPort);
        console.log(`[sendShipToPort] Расстояние: ${distance} миль`);
        
        // Рассчитываем расход топлива на основе расстояния
        const fuelConsumptionRate = gameConfig.fuelCost.consumptionPerMile[ship.type] || 0.12;
        let fuelCost = Math.max(
            distance * fuelConsumptionRate,
            gameConfig.fuelCost.minFuelPerTravel
        );
        
        // Если судно перевозит груз, расход немного увеличивается
        if (ship.cargo) {
            fuelCost = fuelCost * 1.05; // +5% к расходу с грузом (чуть мягче, чтобы полный круг был реалистичен)
            console.log(`[sendShipToPort] Судно перевозит груз, расход увеличен на 5%`);
        }
        
        fuelCost = Math.round(fuelCost);
        console.log(`[sendShipToPort] Расход топлива: ${fuelCost}, доступно: ${ship.fuel}`);
        
        // Обновляем статистику по судну: расстояние и количество рейсов
        // В БД поле total_distance_nm = BIGINT, поэтому сохраняем ОКРУГЛЁННОЕ значение (целое число миль)
        const distanceInt = Math.round(distance);
        ship.totalDistanceNm = (ship.totalDistanceNm || 0) + distanceInt;
        ship.totalTrips = (ship.totalTrips || 0) + 1;

        if (ship.fuel < fuelCost) {
            console.error(`[sendShipToPort] Недостаточно топлива: требуется ${fuelCost}, доступно ${ship.fuel}`);
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
        console.log(`[sendShipToPort] Топливо после списания: ${ship.fuel}`);
        
        await ship.startTravel(portId, travelTime);
        console.log(`[sendShipToPort] Судно успешно отправлено в путь`);
        
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
    } catch (error) {
        console.error(`[sendShipToPort] Ошибка при отправке судна:`, error);
        return { success: false, error: `Ошибка при отправке судна: ${error.message}` };
    }
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
    
    // Проверяем, генерирует ли порт этот ресурс (можно загрузить только то, что порт генерирует)
    if (!portManager.canLoadCargo(port.name, cargoType)) {
        return { 
            success: false, 
            error: `Этот порт не генерирует ${cargoType}. Можно загрузить только ресурсы, которые порт производит.` 
        };
    }
    
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
            
            // Обновляем статистику по судну: затраты на груз
            ship.totalCargoCost = (ship.totalCargoCost || 0) + cargoPrice;

            // Загружаем груз на судно и сохраняем порт покупки и цену покупки за единицу
            ship.cargo = { 
                type: cargoType, 
                amount,
                purchasePortId: ship.currentPortId,  // Сохраняем порт, где купили груз
                purchasePricePerUnit: cargo.price || 0  // Сохраняем цену покупки за единицу
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

async function unloadCargo(shipId, destination = 'port') {
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
        
        // Проверяем, можно ли выгрузить этот груз в порт (требуется для генерации)
        if (!portManager.canUnloadCargo(currentPort.name, ship.cargo.type)) {
            return { 
                success: false, 
                error: `Этот порт не принимает ${ship.cargo.type}. Можно выгрузить только ресурсы, которые требуются для генерации.` 
            };
        }
        
        // Выгружаем груз в порт
        await currentPort.addCargo(ship.cargo.type, ship.cargo.amount);
        
        // Пытаемся запустить генерацию ресурсов
        const generationResult = await portManager.processCargoGeneration(
            currentPort, 
            ship.cargo.type, 
            ship.cargo.amount
        );
        
        // Получаем цену покупки за единицу (сохранена при загрузке и БД)
        const purchasePricePerUnit = ship.cargo.purchasePricePerUnit || 0;
        
        // Получаем текущую цену в порту назначения (цена, по которой порт покупает/продает груз)
        const portCargo = currentPort.getCargo(ship.cargo.type);
        
        // Цена продажи = текущая цена в порту назначения (если груз есть, используется цена порта)
        // Если груза нет в порту, используем максимальную цену из конфига
        let salePricePerUnit;
        if (portCargo && portCargo.price) {
            // Используем текущую цену порта (это цена, по которой порт покупает/продает груз)
            salePricePerUnit = portCargo.price;
        } else {
            // Если груза нет в порту, используем максимальную цену из конфига
            const pricing = gameConfig.economy.portCargoPricing;
            salePricePerUnit = pricing.maxPrice;
        }

        // Учитываем бонус за расстояние между портом покупки и текущим портом (если возможно)
        if (ship.cargo.purchasePortId) {
            const purchasePort = await Port.findById(ship.cargo.purchasePortId);
            if (purchasePort) {
                const distance = Port.calculateDistance(purchasePort, currentPort);
                const distanceMultiplier = gameConfig.economy.distancePriceMultiplier || 0;
                // Бонус добавляем к цене за единицу
                salePricePerUnit += Math.round(distance * distanceMultiplier);
            }
        }
        
        // Рассчитываем общую стоимость покупки и продажи
        const totalPurchasePrice = purchasePricePerUnit * ship.cargo.amount;
        const totalSalePrice = salePricePerUnit * ship.cargo.amount;
        
        // Прибыль = выручка - затраты
        const grossProfit = totalSalePrice - totalPurchasePrice;
        
        // Сохраняем данные груза
        const cargoData = {
            type: ship.cargo.type,
            amount: ship.cargo.amount
        };

        // СБОРЫ И НАЛОГИ РАССЧИТЫВАЮТСЯ ОТ ПРИБЫЛИ (если прибыль положительная)
        let portFees = 0;
        let profitTax = 0;
        let netReward = 0;
        
        if (grossProfit > 0) {
            // Портовые сборы: процент от прибыли (включает вход с грузом + выгрузку)
            const unloadingPercentage = gameConfig.economy.portFees.unloadingPercentage || 0.15;
            portFees = Math.floor(grossProfit * unloadingPercentage);
            
            // Налог на прибыль: процент от прибыли после портовых сборов
            const profitAfterPortFees = grossProfit - portFees;
            profitTax = profitAfterPortFees > 0 
                ? Math.floor(profitAfterPortFees * (gameConfig.economy.profitTax || 0))
                : 0;

            // Чистая прибыль после всех сборов и налогов
            netReward = grossProfit - portFees - profitTax;
        } else {
            // Если убыток - сборов и налогов нет
            netReward = grossProfit;  // Отрицательное значение (убыток)
        }
        
        // Финальная сумма к начислению: затраты + чистая прибыль
        // Если прибыль положительная: возвращаем затраты + чистую прибыль
        // Если убыток: возвращаем только выручку (меньше затрат)
        const finalReward = totalPurchasePrice + netReward;

        const user = await User.findById(ship.userId);
        if (!user) {
            throw new Error('Пользователь не найден');
        }

        // Начисляем финальную сумму
        await user.addCoins(finalReward);

        // Обновляем статистику по судну:
        // - прибыль (может быть отрицательной, если рейс в минус)
        // - перевезённый груз (на случае, если хотим считать только доставленный)
        ship.totalProfit = (ship.totalProfit || 0) + netReward;
        ship.totalCargoMoved = (ship.totalCargoMoved || 0) + ship.cargo.amount;

        // Очищаем груз ТОЛЬКО после всех операций и сохраняем судно со статистикой
        ship.cargo = null;
        await ship.save();
        
        return { 
            success: true, 
            reward: finalReward,
            grossProfit: grossProfit,  // Прибыль до налогов (может быть отрицательной)
            totalSalePrice: totalSalePrice,  // Общая сумма продажи
            totalPurchasePrice: totalPurchasePrice,  // Общая сумма покупки
            salePricePerUnit: salePricePerUnit,
            purchasePricePerUnit: purchasePricePerUnit,
            portFees,
            profitTax,
            cargo: cargoData, 
            destination,
            generation: generationResult  // Информация о генерации ресурсов
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

        // Обновляем статистику по судну: затраты на ремонт
        ship.totalRepairCost = (ship.totalRepairCost || 0) + repairCost;

        ship.health = ship.maxHealth;
        await ship.save();
        
        return { success: true, ship, cost: repairCost };
    } catch (error) {
        console.error('Ошибка ремонта судна:', error);
        throw error;
    }
}

async function refuelShip(shipId, cargoType, amount) {
    const ship = await Ship.findById(shipId);
    if (!ship) {
        return { success: false, error: 'Судно не найдено' };
    }

    if (ship.isTraveling) {
        return { success: false, error: 'Судно в пути' };
    }

    // Проверяем, что заправляем нефтью
    if (cargoType !== 'oil') {
        return { success: false, error: 'Для заправки можно использовать только нефть' };
    }

    // Получаем порт и нефть в порту
    const port = await Port.findById(ship.currentPortId);
    if (!port) {
        return { success: false, error: 'Порт не найден' };
    }

    // Проверяем, что порт генерирует нефть (бункеровка возможна только в портах, где генерируется нефть)
    if (!portManager.canLoadCargo(port.name, 'oil')) {
        return { 
            success: false, 
            error: `Бункеровка возможна только в портах, где генерируется нефть. Этот порт не производит нефть.` 
        };
    }

    const cargo = port.getCargo('oil');
    if (!cargo || cargo.amount < amount) {
        return { success: false, error: `Недостаточно нефти в порту. Доступно: ${cargo?.amount || 0}` };
    }

    // Проверка количества
    if (!amount || amount <= 0) {
        return { success: false, error: 'Количество нефти должно быть больше 0' };
    }

    // Вычисляем сколько топлива можно заправить (не больше максимума)
    const fuelNeeded = ship.maxFuel - ship.fuel;
    if (fuelNeeded <= 0) {
        return { success: false, error: 'Судно уже полностью заправлено' };
    }

    const actualAmount = Math.min(amount, fuelNeeded); // Реальное количество для заправки
    
    // Вычисляем стоимость (цена за единицу * количество)
    const cargoPrice = (cargo.price || 0) * actualAmount;

    // Получаем пользователя
    const user = await User.findById(ship.userId);
    if (!user) {
        return { success: false, error: 'Пользователь не найден' };
    }

    if (user.coins < cargoPrice) {
        return { success: false, error: 'Недостаточно монет' };
    }

    try {
        // Списываем деньги
        await user.spendCoins(cargoPrice);

        // Обновляем статистику по судну: расходы на топливо
        ship.totalFuelCost = (ship.totalFuelCost || 0) + cargoPrice;

        // Заправляем судно
        ship.fuel = Math.min(ship.fuel + actualAmount, ship.maxFuel);
        await ship.save();

        // Удаляем нефть из порта
        await port.removeCargo('oil', actualAmount);

        return { 
            success: true, 
            ship, 
            fueled: actualAmount,
            cost: cargoPrice
        };
    } catch (error) {
        console.error('Ошибка при заправке судна:', error);
        throw error;
    }
}

/**
 * Отбуксировать судно в порт "Нефтяной завод"
 * Можно вызывать в любой момент, когда судно стоит в порту (не в пути)
 */
async function towShip(shipId) {
    const ship = await Ship.findById(shipId);
    if (!ship) {
        return { success: false, error: 'Судно не найдено' };
    }

    if (ship.isTraveling) {
        return { success: false, error: 'Судно в пути. Буксировка невозможна во время движения.' };
    }

    // Находим порт "Нефтяной завод" (где генерируется нефть)
    const allPorts = await Port.findAll();
    const vladivostokPort = allPorts.find(port => port.name === 'Порт "Нефтяной завод"');
    
    if (!vladivostokPort) {
        return { success: false, error: 'Порт "Нефтяной завод" не найден' };
    }

    // Если судно уже в порту "Нефтяной завод", буксировка не нужна
    if (ship.currentPortId === vladivostokPort.id) {
        return { 
            success: false, 
            error: 'Судно уже в порту "Нефтяной завод". Заправьте судно нефтью.' 
        };
    }

    // Получаем текущий порт для расчета расстояния
    const currentPort = await Port.findById(ship.currentPortId);
    if (!currentPort) {
        return { success: false, error: 'Текущий порт не найден' };
    }

    // Рассчитываем расстояние и стоимость буксировки
    const distance = Port.calculateDistance(currentPort, vladivostokPort);
    const towCost = Math.round(
        gameConfig.economy.towCost.base + 
        (distance * gameConfig.economy.towCost.perMile)
    );

    // Получаем пользователя
    const user = await User.findById(ship.userId);
    if (!user) {
        return { success: false, error: 'Пользователь не найден' };
    }

    // Проверяем баланс
    if (user.coins < towCost) {
        return { 
            success: false, 
            error: `Недостаточно монет для буксировки. Требуется: ${towCost}, доступно: ${user.coins}` 
        };
    }

    try {
        // Списываем деньги
        await user.spendCoins(towCost);

        // Обновляем статистику по судну: затраты на буксировку
        ship.totalTowCost = (ship.totalTowCost || 0) + towCost;

        // Перемещаем судно в порт "Нефтяной завод"
        ship.currentPortId = vladivostokPort.id;
        // Топливо остаётся 0 (игрок должен заправиться)
        await ship.save();

        return { 
            success: true, 
            ship, 
            cost: towCost,
            distance: distance,
            message: 'Судно отбуксировано в порт "Нефтяной завод". Заправьте судно нефтью для продолжения работы.'
        };
    } catch (error) {
        console.error('Ошибка при буксировке судна:', error);
        throw error;
    }
}

module.exports = {
    sendShipToPort,
    loadCargo,
    unloadCargo,
    repairShip,
    refuelShip,
    towShip,
    checkAndCompleteTravels,
    checkShipTravel
};
