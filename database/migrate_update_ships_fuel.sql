-- Миграция: Обновление размера топливного бака для существующих судов
-- Обновляет max_fuel и fuel до 200 для соответствия новым требованиям
-- Выполнить этот скрипт после обновления schema.sql

-- Обновляем max_fuel для всех судов, у которых он меньше 200
UPDATE ships 
SET max_fuel = 200
WHERE max_fuel < 200;

-- Обновляем fuel, но не превышаем новый максимум (200)
-- Если у судна больше 200 единиц топлива, ограничиваем до 200
UPDATE ships 
SET fuel = CASE 
    WHEN fuel > 200 THEN 200  -- Если топлива больше максимума - ограничиваем
    ELSE fuel                 -- Иначе оставляем текущее значение
END
WHERE max_fuel = 200;

-- Проверка: показываем статистику обновления
SELECT 
    COUNT(*) as total_ships,
    COUNT(CASE WHEN max_fuel = 200 THEN 1 END) as ships_with_200_fuel,
    COUNT(CASE WHEN max_fuel < 200 THEN 1 END) as ships_needing_update
FROM ships;
