-- Миграция: уменьшение бака до 100 единиц и актуализация топлива

UPDATE ships
SET
    max_fuel = 100,
    fuel = LEAST(fuel, 100)
WHERE max_fuel <> 100 OR fuel > 100;

COMMENT ON COLUMN ships.fuel IS 'Текущее топливо (максимум 100).';
COMMENT ON COLUMN ships.max_fuel IS 'Максимальный бак 100.';
