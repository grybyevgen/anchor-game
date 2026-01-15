// Игровые константы и конфигурация

module.exports = {
    // Цены судов
    shipPrices: {
        tanker: 1000,
        cargo: 1500,
        supply: 1200
    },

    // Названия судов
    shipNames: {
        tanker: 'Танкер',
        cargo: 'Грузовое судно',
        supply: 'Снабженец'
    },

    // Время путешествия (в миллисекундах)
    travelTime: {
        default: 30000, // 30 секунд для тестирования
        // В продакшене можно использовать:
        // short: 5 * 60 * 1000,  // 5 минут
        // medium: 15 * 60 * 1000, // 15 минут
        // long: 30 * 60 * 1000    // 30 минут
    },

    // Расход топлива
    fuelCost: {
        perTravel: 10,
        maxFuel: 100
    },

    // Экономика
    economy: {
        baseRewardPerCargo: 10,
        rewardMultiplierPerCrewLevel: 0.1,
        marketPriceMultiplier: 0.8, // 80% от награды
        repairCostPerHealth: 5
    },

    // Начальные значения
    initial: {
        userCoins: 1000,
        shipFuel: 100,
        shipMaxFuel: 100,
        shipHealth: 100,
        shipMaxHealth: 100,
        shipCrewLevel: 1
    },

    // Валидация
    validation: {
        minCargoAmount: 1,
        maxCargoAmount: 100, // Максимальное количество груза на судне - 100 единиц
        minPrice: 0,
        maxPrice: 1000000,
        minCrewLevel: 1,
        maxCrewLevel: 10
    }
};
