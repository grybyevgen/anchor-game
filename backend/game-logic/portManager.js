const Port = require('../models/Port');

// Правила генерации ресурсов для каждого порта
const PORT_GENERATION_RULES = {
    'Порт Владивосток': {
        generates: 'oil',  // Генерирует нефть
        requires: { materials: 1, provisions: 1 },  // Требует 1 материал + 1 провизия
        output: 3  // Выдает 3 единицы нефти
    },
    'Порт Новороссийск': {
        generates: 'provisions',  // Генерирует провизию
        requires: { materials: 1, oil: 1 },  // Требует 1 материал + 1 нефть
        output: 3  // Выдает 3 единицы провизии
    },
    'Порт Санкт-Петербург': {
        generates: 'materials',  // Генерирует материалы
        requires: { oil: 1, provisions: 1 },  // Требует 1 нефть + 1 провизия
        output: 3  // Выдает 3 единицы материалов
    }
};

/**
 * Получить правила генерации для порта
 */
function getPortGenerationRules(portName) {
    return PORT_GENERATION_RULES[portName] || null;
}

/**
 * Проверить, генерирует ли порт указанный тип груза
 */
function canLoadCargo(portName, cargoType) {
    const rules = getPortGenerationRules(portName);
    return rules && rules.generates === cargoType;
}

/**
 * Проверить, можно ли выгрузить указанный тип груза в порт (требуется для генерации)
 */
function canUnloadCargo(portName, cargoType) {
    const rules = getPortGenerationRules(portName);
    return rules && rules.requires && rules.requires[cargoType] !== undefined;
}

/**
 * Обработать генерацию ресурсов при выгрузке груза
 * Возвращает информацию о сгенерированных ресурсах или null
 */
async function processCargoGeneration(port, unloadedCargoType, unloadedAmount) {
    const rules = getPortGenerationRules(port.name);
    if (!rules) {
        return null;
    }

    // Проверяем, требуется ли этот груз для генерации
    const requiredAmount = rules.requires[unloadedCargoType];
    if (!requiredAmount) {
        return null;
    }

    // Получаем текущие запасы требуемых ресурсов в порту
    const requiredCargo = {};
    for (const [cargoType, amount] of Object.entries(rules.requires)) {
        const portCargo = port.getCargo(cargoType);
        requiredCargo[cargoType] = portCargo ? portCargo.amount : 0;
    }

    // Добавляем только что выгруженный груз
    requiredCargo[unloadedCargoType] = (requiredCargo[unloadedCargoType] || 0) + unloadedAmount;

    // Проверяем, достаточно ли ресурсов для генерации
    let canGenerate = true;
    for (const [cargoType, required] of Object.entries(rules.requires)) {
        if (requiredCargo[cargoType] < required) {
            canGenerate = false;
            break;
        }
    }

    if (!canGenerate) {
        return null;
    }

    // Вычисляем, сколько раз можно сгенерировать
    let generationCount = Infinity;
    for (const [cargoType, required] of Object.entries(rules.requires)) {
        const available = requiredCargo[cargoType];
        const possibleGenerations = Math.floor(available / required);
        generationCount = Math.min(generationCount, possibleGenerations);
    }

    if (generationCount === 0) {
        return null;
    }

    // Списываем ресурсы и генерируем новый ресурс
    const generatedAmount = generationCount * rules.output;
    
    // Удаляем использованные ресурсы
    for (const [cargoType, required] of Object.entries(rules.requires)) {
        const toRemove = generationCount * required;
        await port.removeCargo(cargoType, toRemove);
    }

    // Добавляем сгенерированный ресурс
    await port.addCargo(rules.generates, generatedAmount);

    return {
        generated: rules.generates,
        amount: generatedAmount,
        used: generationCount
    };
}

module.exports = {
    getPortGenerationRules,
    canLoadCargo,
    canUnloadCargo,
    processCargoGeneration
};
