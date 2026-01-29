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

        const currentHealth = ship.health ?? ship.maxHealth ?? 100;
        if (currentHealth <= 0) {
            console.error(`[sendShipToPort] Судно нуждается в ремонте: здоровье ${currentHealth}`);
            return { success: false, error: 'Судно не может выходить в рейс при нулевом здоровье. Отремонтируйте судно в Заводе материалов.' };
        }
        const healthRate = gameConfig.economy.healthDamagePerMileByType?.[ship.type] ?? 0.008;
        let healthDamagePerMile = ship.cargo ? healthRate * 1.05 : healthRate;
        const minHealthDamage = gameConfig.economy.minHealthDamagePerTravel ?? 1;
        const healthDamage = Math.max(minHealthDamage, Math.round(distance * healthDamagePerMile));
        if (currentHealth <= healthDamage) {
            console.error(`[sendShipToPort] Недостаточно здоровья: требуется более ${healthDamage}, доступно ${currentHealth}`);
            return { success: false, error: `Недостаточно здоровья для рейса. Потеря за рейс: ${healthDamage}, текущее здоровье: ${currentHealth}. Отремонтируйте судно в Заводе материалов.` };
        }
        
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

        // Списываем здоровье при старте рейса (как и топливо)
        ship.health = Math.max(0, currentHealth - healthDamage);
        console.log(`[sendShipToPort] Здоровье после списания износа за рейс: ${ship.health}`);

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
        let travelingShips;
        let error;
        
        try {
            const result = await supabase
                .from('ships')
                .select('*')
                .eq('is_traveling', true)
                .lte('travel_end_time', now);
            
            travelingShips = result.data;
            error = result.error;
        } catch (fetchError) {
            // Обработка ошибок подключения к Supabase (ECONNRESET, fetch failed и т.д.)
            const isConnectionError = fetchError.message?.includes('fetch failed') || 
                                     fetchError.message?.includes('ECONNRESET') ||
                                     fetchError.message?.includes('ECONNREFUSED') ||
                                     fetchError.code === 'ECONNRESET' ||
                                     fetchError.code === 'ECONNREFUSED';
            
            if (isConnectionError) {
                // Тихая обработка ошибок подключения - не логируем как критическую ошибку
                // Это временные проблемы с сетью, которые могут быть нормальными
                return { completed: 0, error: 'Временная ошибка подключения к базе данных', silent: true };
            }
            
            // Для других ошибок логируем как обычно
            console.error('Ошибка при запросе к Supabase:', fetchError);
            return { completed: 0, error: fetchError.message || 'Ошибка подключения к базе данных' };
        }
        
        if (error) {
            // Ошибка от Supabase API (не ошибка подключения)
            const isConnectionError = error.message?.includes('fetch failed') || 
                                     error.message?.includes('ECONNRESET') ||
                                     error.code === 'ECONNRESET';
            
            if (isConnectionError) {
                // Тихая обработка ошибок подключения
                return { completed: 0, error: 'Временная ошибка подключения к базе данных', silent: true };
            }
            
            console.error('Ошибка при проверке путешествий:', error);
            return { completed: 0, error: error.message };
        }
        
        let completed = 0;
        for (const shipData of travelingShips || []) {
            try {
                const ship = new Ship(shipData);
                // Здоровье списывается при старте рейса (в sendShipToPort), здесь только прибытие

                // Портовые сборы теперь взимаются только при выгрузке груза
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
        // Обработка неожиданных ошибок
        const isConnectionError = error.message?.includes('fetch failed') || 
                                 error.message?.includes('ECONNRESET') ||
                                 error.message?.includes('ECONNREFUSED') ||
                                 error.code === 'ECONNRESET' ||
                                 error.code === 'ECONNREFUSED';
        
        if (isConnectionError) {
            // Тихая обработка ошибок подключения
            return { completed: 0, error: 'Временная ошибка подключения к базе данных', silent: true };
        }
        
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
    
    // Проверяем, завершилось ли путешествие (здоровье уже списано при старте рейса)
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
    
    const maxCargo = ship.maxCargo ?? gameConfig.validation.maxCargoAmount;
    if (amount > maxCargo) {
        return { success: false, error: `Максимальное количество груза на этом судне - ${maxCargo} единиц` };
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
        const { withRetry } = require('../config/database');
        
        const currentPort = await withRetry(async () => {
            return await Port.findById(ship.currentPortId);
        });
        
        // Проверяем, можно ли выгрузить этот груз в порт (требуется для генерации)
        if (!portManager.canUnloadCargo(currentPort.name, ship.cargo.type)) {
            return { 
                success: false, 
                error: `Этот порт не принимает ${ship.cargo.type}. Можно выгрузить только ресурсы, которые требуются для генерации.` 
            };
        }
        
        // Выгружаем груз в порт
        await withRetry(async () => {
            return await currentPort.addCargo(ship.cargo.type, ship.cargo.amount);
        });
        
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
        let distance = 0;
        let distanceBonus = 0; // общий бонус (за весь объём груза)
        let distanceBonusPerUnit = 0; // бонус за 1 единицу
        if (ship.cargo.purchasePortId) {
            const purchasePort = await withRetry(async () => {
                return await Port.findById(ship.cargo.purchasePortId);
            });
            if (purchasePort) {
                distance = Port.calculateDistance(purchasePort, currentPort);
                const distanceMultiplier = gameConfig.economy.distancePriceMultiplier || 0;
                // Бонус добавляем к цене за единицу
                distanceBonusPerUnit = Math.round(distance * distanceMultiplier);
                salePricePerUnit += distanceBonusPerUnit;
                // Общий бонус за дистанцию для всего груза
                distanceBonus = distanceBonusPerUnit * ship.cargo.amount;
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

        const user = await withRetry(async () => {
            return await User.findById(ship.userId);
        });
        
        if (!user) {
            throw new Error('Пользователь не найден');
        }

        // Начисляем финальную сумму
        await withRetry(async () => {
            return await user.addCoins(finalReward);
        });

        // Обновляем статистику по судну:
        // - прибыль (может быть отрицательной, если рейс в минус)
        // - перевезённый груз (на случае, если хотим считать только доставленный)
        ship.totalProfit = (ship.totalProfit || 0) + netReward;
        ship.totalCargoMoved = (ship.totalCargoMoved || 0) + ship.cargo.amount;

        // Обновляем заработок пользователя для рейтинга (только если прибыль положительная)
        if (netReward > 0) {
            try {
                const UserEarnings = require('../models/UserEarnings');
                const userEarnings = await UserEarnings.findOrCreate(user.id);
                await userEarnings.addEarnings(netReward);
                await userEarnings.addWeeklyStats(Math.round(distance || 0), 1, ship.cargo.amount || 0);
            } catch (error) {
                // Не критично, если не удалось обновить рейтинг
                console.error('Ошибка обновления заработка для рейтинга:', error);
            }
        } else {
            try {
                const UserEarnings = require('../models/UserEarnings');
                const userEarnings = await UserEarnings.findOrCreate(user.id);
                await userEarnings.addWeeklyStats(Math.round(distance || 0), 1, ship.cargo.amount || 0);
            } catch (err) {
                console.error('Ошибка обновления недельной статистики:', err);
            }
        }

        // Ежедневная статистика: +1 рейс за сегодня (для задания «Опытный моряк»)
        try {
            const { getSupabase, withRetry } = require('../config/database');
            const supabase = getSupabase();
            const today = new Date().toISOString().split('T')[0];
            const { data: row } = await withRetry(async () => {
                return await supabase
                    .from('user_daily_stats')
                    .select('trips_count')
                    .eq('user_id', ship.userId)
                    .eq('stat_date', today)
                    .maybeSingle();
            });
            if (row) {
                await withRetry(async () => {
                    return await supabase
                        .from('user_daily_stats')
                        .update({ trips_count: (row.trips_count || 0) + 1 })
                        .eq('user_id', ship.userId)
                        .eq('stat_date', today);
                });
            } else {
                await withRetry(async () => {
                    return await supabase
                        .from('user_daily_stats')
                        .insert({ user_id: ship.userId, stat_date: today, trips_count: 1 });
                });
            }
        } catch (dailyErr) {
            console.error('Ошибка обновления ежедневной статистики:', dailyErr);
        }

        // Очищаем груз ТОЛЬКО после всех операций и сохраняем судно со статистикой
        ship.cargo = null;
        await withRetry(async () => {
            return await ship.save();
        });
        
        return { 
            success: true, 
            reward: finalReward,
            grossProfit: grossProfit,  // Прибыль до налогов (может быть отрицательной)
            netProfit: netReward, // Чистая прибыль (после сборов/налога; может быть отрицательной)
            totalSalePrice: totalSalePrice,  // Общая сумма продажи
            totalPurchasePrice: totalPurchasePrice,  // Общая сумма покупки
            salePricePerUnit: salePricePerUnit,
            purchasePricePerUnit: purchasePricePerUnit,
            portFees,
            profitTax,
            distanceBonus,  // Бонус за дистанцию
            distanceBonusPerUnit, // Бонус за дистанцию за 1 единицу
            distance,  // Расстояние в милях
            cargo: cargoData, 
            destination,
            generation: generationResult  // Информация о генерации ресурсов
        };
    } catch (error) {
        console.error('Ошибка выгрузки груза:', error);
        
        // Проверяем, является ли это ошибкой подключения к базе данных
        const isConnectionError = error.message?.includes('fetch failed') || 
                                 error.message?.includes('ECONNRESET') ||
                                 error.message?.includes('ECONNREFUSED') ||
                                 error.message?.includes('terminated') ||
                                 error.code === 'ECONNRESET' ||
                                 error.code === 'ECONNREFUSED';
        
        if (isConnectionError) {
            return { 
                success: false, 
                error: 'Временная ошибка подключения к базе данных. Попробуйте еще раз через несколько секунд.' 
            };
        }
        
        // В случае ошибки состояние должно остаться согласованным
        throw error;
    }
}

async function repairShip(shipId, amount = null) {
    const { withRetry } = require('../config/database');

    const ship = await Ship.findById(shipId);
    if (!ship) {
        return { success: false, error: 'Судно не найдено' };
    }

    if (ship.health >= (ship.maxHealth ?? 100)) {
        return { success: false, error: 'Судно уже полностью исправно' };
    }

    if (ship.isTraveling) {
        return { success: false, error: 'Судно в пути' };
    }

    const port = await withRetry(async () => await Port.findById(ship.currentPortId));
    if (!port) {
        return { success: false, error: 'Порт не найден' };
    }
    if (!portManager.canLoadCargo(port.name, 'materials')) {
        return { success: false, error: 'Ремонт за материалы возможен только в порту «Завод Материалов»' };
    }

    const materialsCargo = port.getCargo('materials');
    if (!materialsCargo || materialsCargo.amount < 1) {
        return { success: false, error: `Недостаточно материалов в порту. Доступно: ${materialsCargo?.amount ?? 0}` };
    }

    const maxHealth = ship.maxHealth ?? 100;
    const healthNeeded = maxHealth - ship.health;
    const materialsAvailable = Math.floor(materialsCargo.amount);
    const maxRepairAmount = Math.min(healthNeeded, materialsAvailable);
    const materialsPrice = typeof materialsCargo.price === 'number' ? materialsCargo.price : 0;

    const repairAmount = amount != null
        ? Math.min(Math.max(1, Math.floor(amount)), maxRepairAmount)
        : maxRepairAmount;
    const repairCost = Math.round(repairAmount * materialsPrice);

    const user = await withRetry(async () => await User.findById(ship.userId));
    if (!user) {
        return { success: false, error: 'Пользователь не найден' };
    }
    if (user.coins < repairCost) {
        return { success: false, error: 'Недостаточно монет для покупки материалов' };
    }

    try {
        await withRetry(async () => await user.spendCoins(repairCost));
        await withRetry(async () => await port.removeCargo('materials', repairAmount));

        ship.totalRepairCost = (ship.totalRepairCost || 0) + repairCost;
        ship.health = Math.min(ship.health + repairAmount, maxHealth);
        const totalDistance = Number(ship.totalDistanceNm || 0);
        if (ship.health >= maxHealth) {
            ship.distanceAtLastRepair = totalDistance;
        }
        await withRetry(async () => await ship.save());

        try {
            await user.addHealthRepaired(repairAmount);
        } catch (e) {
            console.error('Ошибка обновления статистики ремонта:', e);
        }

        return { success: true, ship, cost: repairCost, repaired: repairAmount };
    } catch (error) {
        console.error('Ошибка ремонта судна:', error);
        throw error;
    }
}

async function refuelShip(shipId, cargoType, amount) {
    try {
        const { withRetry } = require('../config/database');
        
        const ship = await withRetry(async () => {
            return await Ship.findById(shipId);
        });
        
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
        const port = await withRetry(async () => {
            return await Port.findById(ship.currentPortId);
        });
        
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
        const user = await withRetry(async () => {
            return await User.findById(ship.userId);
        });
        
        if (!user) {
            return { success: false, error: 'Пользователь не найден' };
        }

        if (user.coins < cargoPrice) {
            return { success: false, error: 'Недостаточно монет' };
        }

        // Списываем деньги
        await withRetry(async () => {
            return await user.spendCoins(cargoPrice);
        });

        // Обновляем статистику по судну: расходы на топливо
        ship.totalFuelCost = (ship.totalFuelCost || 0) + cargoPrice;

        // Заправляем судно
        ship.fuel = Math.min(ship.fuel + actualAmount, ship.maxFuel);
        await withRetry(async () => {
            return await ship.save();
        });

        try {
            await user.addFuelRefueled(actualAmount);
        } catch (e) {
            console.error('Ошибка обновления статистики заправки:', e);
        }

        // Удаляем нефть из порта
        await withRetry(async () => {
            return await port.removeCargo('oil', actualAmount);
        });

        return { 
            success: true, 
            ship, 
            fueled: actualAmount,
            cost: cargoPrice
        };
    } catch (error) {
        console.error('Ошибка при заправке судна:', error);
        
        // Обработка ошибок подключения к базе данных
        const isConnectionError = error.message?.includes('fetch failed') || 
                                 error.message?.includes('ECONNRESET') ||
                                 error.message?.includes('ECONNREFUSED') ||
                                 error.message?.includes('terminated') ||
                                 error.message?.toLowerCase().includes('временная ошибка подключения') ||
                                 error.message?.toLowerCase().includes('connection') ||
                                 error.code === 'ECONNRESET' ||
                                 error.code === 'ECONNREFUSED';
        
        if (isConnectionError) {
            return { 
                success: false, 
                error: 'Временная ошибка подключения к базе данных. Попробуйте еще раз через несколько секунд.' 
            };
        }
        
        return { 
            success: false, 
            error: error.message || 'Ошибка при заправке судна' 
        };
    }
}

/**
 * Отбуксировать судно в порт "Нефтяной завод"
 * Можно вызывать в любой момент, когда судно стоит в порту (не в пути)
 */
async function towShip(shipId) {
    try {
        console.log(`[towShip] Начало буксировки судна: ${shipId}`);
        const { withRetry } = require('../config/database');
        
        const ship = await withRetry(async () => {
            return await Ship.findById(shipId);
        });
        
        if (!ship) {
            console.error(`[towShip] Судно не найдено: ${shipId}`);
            return { success: false, error: 'Судно не найдено' };
        }

        console.log(`[towShip] Судно найдено: ${ship.name}, текущий порт: ${ship.currentPortId}, в пути: ${ship.isTraveling}`);

        if (ship.isTraveling) {
            console.error(`[towShip] Судно в пути: ${shipId}`);
            return { success: false, error: 'Судно в пути. Буксировка невозможна во время движения.' };
        }

        // Находим порт "Нефтяной завод" (где генерируется нефть)
        const allPorts = await withRetry(async () => {
            return await Port.findAll();
        });
        
        console.log(`[towShip] Найдено портов: ${allPorts.length}`);
        const portNames = allPorts.map(p => p.name);
        console.log(`[towShip] Названия портов:`, portNames);
        
        const vladivostokPort = allPorts.find(port => port.name === 'Порт "Нефтяной завод"');
        
        if (!vladivostokPort) {
            console.error(`[towShip] Порт "Нефтяной завод" не найден. Доступные порты:`, portNames);
            return { 
                success: false, 
                error: `Порт "Нефтяной завод" не найден. Доступные порты: ${portNames.join(', ')}` 
            };
        }

        console.log(`[towShip] Порт "Нефтяной завод" найден: ${vladivostokPort.id}`);

        // Получаем текущий порт для расчета расстояния и проверки
        const currentPort = await withRetry(async () => {
            return await Port.findById(ship.currentPortId);
        });
        
        if (!currentPort) {
            console.error(`[towShip] Текущий порт не найден: ${ship.currentPortId}`);
            return { success: false, error: 'Текущий порт не найден' };
        }

        console.log(`[towShip] Текущий порт: ${currentPort.name}`);

        // Если судно уже в порту "Нефтяной завод", буксировка не нужна
        // Проверяем по ID и по названию порта для надежности
        const isAlreadyInOilPort = ship.currentPortId === vladivostokPort.id || 
                                   currentPort.name?.includes('Нефтяной');
        
        if (isAlreadyInOilPort) {
            console.log(`[towShip] Судно уже в порту "Нефтяной завод" (ID: ${ship.currentPortId}, название: ${currentPort.name})`);
            return { 
                success: false, 
                error: 'Судно уже в порту "Нефтяной завод". Заправьте судно нефтью.' 
            };
        }

        // Рассчитываем расстояние и стоимость буксировки
        const distance = Port.calculateDistance(currentPort, vladivostokPort);
        const towCost = Math.round(
            gameConfig.economy.towCost.base + 
            (distance * gameConfig.economy.towCost.perMile)
        );

        console.log(`[towShip] Расстояние: ${distance} миль, стоимость буксировки: ${towCost}`);

        // Получаем пользователя
        const user = await withRetry(async () => {
            return await User.findById(ship.userId);
        });
        
        if (!user) {
            console.error(`[towShip] Пользователь не найден: ${ship.userId}`);
            return { success: false, error: 'Пользователь не найден' };
        }

        console.log(`[towShip] Пользователь найден, баланс: ${user.coins}, требуется: ${towCost}`);

        // Проверяем баланс
        if (user.coins < towCost) {
            console.error(`[towShip] Недостаточно монет: требуется ${towCost}, доступно ${user.coins}`);
            return { 
                success: false, 
                error: `Недостаточно монет для буксировки. Требуется: ${towCost}, доступно: ${user.coins}` 
            };
        }

        // Списываем деньги
        console.log(`[towShip] Списываем монеты: ${towCost}`);
        await withRetry(async () => {
            return await user.spendCoins(towCost);
        });

        // Обновляем статистику по судну: затраты на буксировку
        ship.totalTowCost = (ship.totalTowCost || 0) + towCost;

        // Перемещаем судно в порт "Нефтяной завод"
        const oldPortId = ship.currentPortId;
        ship.currentPortId = vladivostokPort.id;
        // Топливо остаётся 0 (игрок должен заправиться)
        console.log(`[towShip] Перемещаем судно из порта ${oldPortId} в порт ${vladivostokPort.id}`);
        await withRetry(async () => {
            return await ship.save();
        });

        console.log(`[towShip] Буксировка успешно завершена`);

        return { 
            success: true, 
            ship, 
            cost: towCost,
            distance: distance,
            message: 'Судно отбуксировано в порт "Нефтяной завод". Заправьте судно нефтью для продолжения работы.'
        };
    } catch (error) {
        console.error('[towShip] Ошибка при буксировке судна:', error);
        console.error('[towShip] Stack trace:', error.stack);
        
        // Обработка ошибок подключения к базе данных
        const { isConnectionError } = require('../middleware/errorHandler');
        
        if (isConnectionError(error)) {
            return { 
                success: false, 
                error: 'Временная ошибка подключения к базе данных. Попробуйте еще раз через несколько секунд.' 
            };
        }
        
        return { 
            success: false, 
            error: error.message || 'Ошибка при буксировке судна' 
        };
    }
}

/** Целевой порт для буксировки: название для поиска в БД */
const MATERIALS_PORT_NAME = 'Порт "Завод Материалов"';

/**
 * Отбуксировать судно в порт "Завод Материалов" (для ремонта)
 * Логика та же, что для Нефтяного завода: списание монет, перемещение судна.
 */
async function towShipToMaterials(shipId) {
    try {
        const { withRetry } = require('../config/database');
        const ship = await withRetry(() => Ship.findById(shipId));
        if (!ship) return { success: false, error: 'Судно не найдено' };
        if (ship.isTraveling) return { success: false, error: 'Судно в пути. Буксировка невозможна во время движения.' };

        const allPorts = await withRetry(() => Port.findAll());
        const materialsPort = allPorts.find(p => p.name && (p.name === MATERIALS_PORT_NAME || p.name.includes('Материалов')));
        if (!materialsPort) return { success: false, error: 'Порт "Завод Материалов" не найден' };

        const currentPort = await withRetry(() => Port.findById(ship.currentPortId));
        if (!currentPort) return { success: false, error: 'Текущий порт не найден' };

        const isAlreadyInMaterials = ship.currentPortId === materialsPort.id || (currentPort.name && currentPort.name.includes('Материалов'));
        if (isAlreadyInMaterials) return { success: false, error: 'Судно уже в порту "Завод Материалов". Отремонтируйте судно для продолжения работы.' };

        const distance = Port.calculateDistance(currentPort, materialsPort);
        const towCost = Math.round(gameConfig.economy.towCost.base + (distance * gameConfig.economy.towCost.perMile));

        const user = await withRetry(() => User.findById(ship.userId));
        if (!user) return { success: false, error: 'Пользователь не найден' };
        if (user.coins < towCost) return { success: false, error: `Недостаточно монет для буксировки. Требуется: ${towCost}, доступно: ${user.coins}` };

        await withRetry(() => user.spendCoins(towCost));
        ship.totalTowCost = (ship.totalTowCost || 0) + towCost;
        ship.currentPortId = materialsPort.id;
        await withRetry(() => ship.save());

        return { success: true, ship, cost: towCost, distance, message: 'Судно отбуксировано в порт "Завод Материалов". Отремонтируйте судно для продолжения работы.' };
    } catch (error) {
        console.error('[towShipToMaterials] Ошибка:', error);
        const { isConnectionError } = require('../middleware/errorHandler');
        if (isConnectionError(error)) return { success: false, error: 'Временная ошибка подключения к базе данных. Попробуйте еще раз через несколько секунд.' };
        return { success: false, error: error.message || 'Ошибка при буксировке судна' };
    }
}

/**
 * Получить информацию о буксировке в Завод Материалов (стоимость и возможность).
 * canReachAnyPort: true если судно может хотя бы в один порт дойти по здоровью (иначе предлагаем буксировку).
 */
async function getTowInfoToMaterials(shipId) {
    const { withRetry } = require('../config/database');
    const ship = await withRetry(() => Ship.findById(shipId));
    if (!ship) return { success: false, canTow: false, error: 'Судно не найдено' };
    if (ship.isTraveling) return { success: true, canTow: false, canReachAnyPort: true, error: 'Судно в пути' };

    const allPorts = await withRetry(() => Port.findAll());
    const materialsPort = allPorts.find(p => p.name && (p.name === MATERIALS_PORT_NAME || p.name.includes('Материалов')));
    if (!materialsPort) return { success: true, canTow: false, canReachAnyPort: true, error: 'Порт "Завод Материалов" не найден' };

    const currentPort = await withRetry(() => Port.findById(ship.currentPortId));
    if (!currentPort) return { success: false, canTow: false, canReachAnyPort: false, error: 'Текущий порт не найден' };

    const isAlreadyInMaterials = ship.currentPortId === materialsPort.id || (currentPort.name && currentPort.name.includes('Материалов'));
    if (isAlreadyInMaterials) return { success: true, canTow: false, canReachAnyPort: true, error: 'Судно уже в порту Завод Материалов' };

    const currentHealth = ship.health ?? ship.maxHealth ?? 100;
    const healthRate = gameConfig.economy.healthDamagePerMileByType?.[ship.type] ?? 0.008;
    const healthDamagePerMile = ship.cargo ? healthRate * 1.05 : healthRate;
    const minDamage = gameConfig.economy.minHealthDamagePerTravel ?? 1;

    let canReachAnyPort = false;
    for (const port of allPorts) {
        if (port.id === ship.currentPortId) continue;
        const dist = Port.calculateDistance(currentPort, port);
        const healthDamage = Math.max(minDamage, Math.round(dist * healthDamagePerMile));
        if (currentHealth > healthDamage) {
            canReachAnyPort = true;
            break;
        }
    }

    const distance = Port.calculateDistance(currentPort, materialsPort);
    const cost = Math.round(gameConfig.economy.towCost.base + distance * (gameConfig.economy.towCost.perMile || 0.5));
    return {
        success: true,
        canTow: true,
        canReachAnyPort,
        cost,
        destinationPortName: materialsPort.name || MATERIALS_PORT_NAME
    };
}

/**
 * Повысить уровень судна (crew_level). Списывает монеты, увеличивает max_fuel, max_health, max_cargo и health.
 */
async function upgradeShip(shipId) {
    const ship = await Ship.findById(shipId);
    if (!ship) {
        return { success: false, error: 'Судно не найдено' };
    }

    const { maxLevel, costPerLevel, healthBonus, fuelBonus, cargoBonus } = gameConfig.shipUpgrade;
    const currentLevel = ship.crewLevel ?? 1;

    if (currentLevel >= maxLevel) {
        return { success: false, error: 'Достигнут максимальный уровень судна' };
    }

    const cost = costPerLevel * currentLevel;
    const user = await User.findById(ship.userId);
    if (!user) {
        return { success: false, error: 'Пользователь не найден' };
    }
    if (user.coins < cost) {
        return { success: false, error: `Недостаточно монет. Требуется: ${cost}` };
    }

    try {
        await user.spendCoins(cost);

        ship.crewLevel = currentLevel + 1;
        ship.maxFuel = (ship.maxFuel ?? 100) + fuelBonus;
        ship.maxHealth = (ship.maxHealth ?? 100) + healthBonus;
        ship.maxCargo = (ship.maxCargo ?? 100) + cargoBonus;
        ship.health = Math.min((ship.health ?? 100) + healthBonus, ship.maxHealth);

        await ship.save();

        return {
            success: true,
            ship,
            newLevel: ship.crewLevel,
            cost
        };
    } catch (err) {
        throw err;
    }
}

/**
 * Получить информацию о буксировке (стоимость и возможность) — расчёт только на backend
 */
async function getTowInfo(shipId) {
    const { withRetry } = require('../config/database');
    const ship = await withRetry(() => Ship.findById(shipId));
    if (!ship) return { success: false, canTow: false, error: 'Судно не найдено' };
    if (ship.isTraveling) return { success: true, canTow: false, error: 'Судно в пути' };

    const allPorts = await withRetry(() => Port.findAll());
    const oilPort = allPorts.find(p => p.name && p.name.includes('Нефтяной'));
    if (!oilPort) return { success: true, canTow: false, error: 'Порт "Нефтяной завод" не найден' };

    const currentPort = await withRetry(() => Port.findById(ship.currentPortId));
    if (!currentPort) return { success: false, canTow: false, error: 'Текущий порт не найден' };

    const isAlreadyInOilPort = ship.currentPortId === oilPort.id || currentPort.name && currentPort.name.includes('Нефтяной');
    if (isAlreadyInOilPort) return { success: true, canTow: false, error: 'Судно уже в порту Нефтяной завод' };

    const distance = Port.calculateDistance(currentPort, oilPort);
    const cost = Math.round(
        gameConfig.economy.towCost.base +
        distance * (gameConfig.economy.towCost.perMile || 0.5)
    );
    return {
        success: true,
        canTow: true,
        cost,
        destinationPortName: oilPort.name || 'Порт "Нефтяной завод"'
    };
}

/**
 * Получить информацию о заправке (цена, макс. объём, стоимость для количества) — расчёт только на backend
 * amount — опционально; если передан, cost считается для этого количества
 */
async function getRefuelInfo(shipId, amount = null) {
    const { withRetry } = require('../config/database');
    const ship = await withRetry(() => Ship.findById(shipId));
    if (!ship) return { success: false, canRefuel: false, error: 'Судно не найдено' };
    if (ship.isTraveling) return { success: true, canRefuel: false, error: 'Судно в пути' };

    const port = await withRetry(() => Port.findById(ship.currentPortId));
    if (!port) return { success: false, canRefuel: false, error: 'Порт не найден' };
    if (!portManager.canLoadCargo(port.name, 'oil')) {
        return { success: true, canRefuel: false, error: 'Бункеровка возможна только в порту, где есть нефть' };
    }

    const cargo = port.getCargo('oil');
    if (!cargo) return { success: true, canRefuel: false, error: 'В порту нет нефти' };

    const maxRefuelAmount = Math.max(0, (ship.maxFuel || 100) - (ship.fuel || 0));
    if (maxRefuelAmount <= 0) return { success: true, canRefuel: false, error: 'Судно уже заправлено' };

    const oilPrice = typeof cargo.price === 'number' ? cargo.price : 0;
    const refuelAmount = amount != null ? Math.min(Math.max(0, Math.floor(Number(amount))), maxRefuelAmount) : maxRefuelAmount;
    const cost = Math.ceil((oilPrice * refuelAmount));

    return {
        success: true,
        canRefuel: true,
        oilPrice,
        maxRefuelAmount,
        cost,
        refuelAmountForCost: refuelAmount
    };
}

/**
 * Превью рейса: расстояние, расход топлива, стоимость буксировки при необходимости — расчёт только на backend
 */
async function getTripPreview(shipId, destinationPortId) {
    const ship = await Ship.findById(shipId);
    if (!ship) return { success: false, error: 'Судно не найдено' };
    if (ship.isTraveling) return { success: false, error: 'Судно уже в пути' };

    const currentPort = await Port.findById(ship.currentPortId);
    const destinationPort = await Port.findById(destinationPortId);
    if (!currentPort) return { success: false, error: 'Текущий порт не найден' };
    if (!destinationPort) return { success: false, error: 'Порт назначения не найден' };
    if (ship.currentPortId === destinationPortId) return { success: false, error: 'Судно уже в этом порту' };

    const distance = Port.calculateDistance(currentPort, destinationPort);
    const distanceInt = Math.round(distance);
    const fuelConsumptionRate = gameConfig.fuelCost.consumptionPerMile[ship.type] || 0.12;
    let fuelConsumption = Math.max(
        distance * fuelConsumptionRate,
        gameConfig.fuelCost.minFuelPerTravel
    );
    if (ship.cargo) fuelConsumption = fuelConsumption * 1.05;
    fuelConsumption = Math.round(fuelConsumption);

    const healthRate = gameConfig.economy.healthDamagePerMileByType?.[ship.type] ?? 0.008;
    const healthDamagePerMile = ship.cargo ? healthRate * 1.05 : healthRate;
    const minHealthDamage = gameConfig.economy.minHealthDamagePerTravel ?? 1;
    const healthDamage = Math.max(minHealthDamage, Math.round(distance * healthDamagePerMile));
    const currentHealth = ship.health ?? ship.maxHealth ?? 100;
    const hasEnoughHealth = currentHealth > 0 && currentHealth > healthDamage;

    const hasEnoughFuel = (ship.fuel || 0) >= fuelConsumption;
    let towCost = null;
    if (!hasEnoughFuel) {
        const { withRetry } = require('../config/database');
        const allPorts = await withRetry(() => Port.findAll());
        const oilPort = allPorts.find(p => p.name && p.name.includes('Нефтяной'));
        if (oilPort && currentPort.id !== oilPort.id) {
            const towDistance = Port.calculateDistance(currentPort, oilPort);
            towCost = Math.round(
                gameConfig.economy.towCost.base +
                towDistance * (gameConfig.economy.towCost.perMile || 0.5)
            );
        }
    }

    return {
        success: true,
        distance: distanceInt,
        fuelConsumption,
        healthDamage,
        canSend: hasEnoughFuel && hasEnoughHealth,
        canSendByFuel: hasEnoughFuel,
        canSendByHealth: hasEnoughHealth,
        towCost
    };
}

module.exports = {
    sendShipToPort,
    loadCargo,
    unloadCargo,
    repairShip,
    refuelShip,
    towShip,
    checkAndCompleteTravels,
    checkShipTravel,
    upgradeShip,
    getTowInfo,
    getRefuelInfo,
    getTripPreview,
    towShipToMaterials,
    getTowInfoToMaterials
};
