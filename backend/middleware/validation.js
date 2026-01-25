const { body, param, query, validationResult } = require('express-validator');
const gameConfig = require('../config/gameConfig');

/**
 * Middleware для проверки результатов валидации
 */
function validate(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            error: 'Ошибка валидации',
            errors: errors.array()
        });
    }
    next();
}

/**
 * Валидация для инициализации пользователя
 */
const validateUserInit = [
    body('telegramId')
        .notEmpty().withMessage('telegramId обязателен')
        .isInt({ min: 1 }).withMessage('telegramId должен быть положительным числом'),
    body('username').optional().isString().trim().isLength({ max: 255 }),
    body('firstName').optional().isString().trim().isLength({ max: 255 }),
    body('lastName').optional().isString().trim().isLength({ max: 255 }),
    body('referralCode').optional().isString().trim().isLength({ min: 1, max: 64 }),
    validate
];

/**
 * Валидация для покупки судна (поддерживает и UUID и telegramId)
 */
const validateBuyShip = [
    body('userId')
        .notEmpty().withMessage('userId обязателен')
        .custom((value) => {
            // Может быть UUID или число (telegramId)
            const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
            const isNumber = /^[0-9]+$/.test(value);
            if (!isUUID && !isNumber) {
                throw new Error('userId должен быть UUID или числом');
            }
            return true;
        }),
    body('type')
        .notEmpty().withMessage('type обязателен')
        .isIn(['tanker', 'cargo', 'supply']).withMessage('Неверный тип судна'),
    validate
];

/**
 * Валидация для отправки судна в порт
 */
const validateTravel = [
    param('shipId')
        .notEmpty().withMessage('shipId обязателен')
        .isUUID().withMessage('shipId должен быть UUID'),
    body('portId')
        .notEmpty().withMessage('portId обязателен')
        .isUUID().withMessage('portId должен быть UUID'),
    validate
];

/**
 * Валидация для загрузки груза
 */
const validateLoadCargo = [
    param('shipId')
        .notEmpty().withMessage('shipId обязателен')
        .isUUID().withMessage('shipId должен быть UUID'),
    body('cargoType')
        .notEmpty().withMessage('cargoType обязателен')
        .isIn(['oil', 'materials', 'provisions']).withMessage('Неверный тип груза'),
    body('amount')
        .notEmpty().withMessage('amount обязателен')
        .isInt({ 
            min: gameConfig.validation.minCargoAmount, 
            max: gameConfig.validation.maxCargoAmount 
        }).withMessage(`amount должен быть от ${gameConfig.validation.minCargoAmount} до ${gameConfig.validation.maxCargoAmount}`),
    validate
];

/**
 * Валидация для покупки груза с рынка (поддерживает и UUID и telegramId)
 */
const validateBuyCargo = [
    param('cargoId')
        .notEmpty().withMessage('cargoId обязателен')
        .isUUID().withMessage('cargoId должен быть UUID'),
    body('userId')
        .notEmpty().withMessage('userId обязателен')
        .custom((value) => {
            // Может быть UUID или число (telegramId)
            const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
            const isNumber = /^[0-9]+$/.test(value);
            if (!isUUID && !isNumber) {
                throw new Error('userId должен быть UUID или числом');
            }
            return true;
        }),
    body('amount')
        .optional()
        .isInt({ 
            min: 1, 
            max: 100 
        }).withMessage('amount должен быть от 1 до 100'),
    validate
];

/**
 * Валидация UUID параметра
 */
const validateUUID = (paramName) => [
    param(paramName)
        .notEmpty().withMessage(`${paramName} обязателен`)
        .isUUID().withMessage(`${paramName} должен быть UUID`),
    validate
];

/**
 * Валидация для получения пользователя (поддерживает и UUID и telegramId)
 */
const validateGetUser = [
    param('userId')
        .notEmpty().withMessage('userId обязателен')
        .custom((value) => {
            // Может быть UUID или число (telegramId)
            const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
            const isNumber = /^[0-9]+$/.test(value);
            if (!isUUID && !isNumber) {
                throw new Error('userId должен быть UUID или числом');
            }
            return true;
        }),
    validate
];

module.exports = {
    validate,
    validateUserInit,
    validateBuyShip,
    validateTravel,
    validateLoadCargo,
    validateBuyCargo,
    validateUUID,
    validateGetUser
};
