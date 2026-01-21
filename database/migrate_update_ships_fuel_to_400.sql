-- Миграция: обновление топлива судов до 400 единиц
-- Выполните этот скрипт, если база данных уже создана

-- Обновляем максимальный бак до 400
UPDATE ships 
SET max_fuel = 400
WHERE max_fuel < 400;

-- Заправляем все суда до полного бака (400)
UPDATE ships 
SET fuel = 400
WHERE fuel < 400 AND max_fuel >= 400;

-- Для судов, у которых max_fuel был меньше 400, устанавливаем fuel = max_fuel
UPDATE ships 
SET fuel = max_fuel
WHERE fuel > max_fuel;
