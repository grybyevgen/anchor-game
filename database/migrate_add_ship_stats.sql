-- Миграция: добавление статистических полей для судов

ALTER TABLE ships
ADD COLUMN IF NOT EXISTS purchase_price INTEGER DEFAULT 0 CHECK (purchase_price >= 0),
ADD COLUMN IF NOT EXISTS total_distance_nm BIGINT DEFAULT 0 CHECK (total_distance_nm >= 0),
ADD COLUMN IF NOT EXISTS total_trips INTEGER DEFAULT 0 CHECK (total_trips >= 0),
ADD COLUMN IF NOT EXISTS total_cargo_moved INTEGER DEFAULT 0 CHECK (total_cargo_moved >= 0),
ADD COLUMN IF NOT EXISTS total_profit INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_fuel_cost INTEGER DEFAULT 0 CHECK (total_fuel_cost >= 0),
ADD COLUMN IF NOT EXISTS total_cargo_cost INTEGER DEFAULT 0 CHECK (total_cargo_cost >= 0),
ADD COLUMN IF NOT EXISTS total_repair_cost INTEGER DEFAULT 0 CHECK (total_repair_cost >= 0),
ADD COLUMN IF NOT EXISTS total_tow_cost INTEGER DEFAULT 0 CHECK (total_tow_cost >= 0);

