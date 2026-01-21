-- Включение расширений
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Таблица пользователей
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    telegram_id BIGINT UNIQUE NOT NULL,
    username VARCHAR(255),
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    coins INTEGER DEFAULT 6000 CHECK (coins >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_active TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_users_telegram_id ON users(telegram_id);

-- Таблица портов
CREATE TABLE IF NOT EXISTS ports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) UNIQUE NOT NULL,
    location_lat DECIMAL(10, 8),
    location_lng DECIMAL(11, 8),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Таблица грузов в портах (JSONB для гибкости)
CREATE TABLE IF NOT EXISTS port_cargo (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    port_id UUID NOT NULL REFERENCES ports(id) ON DELETE CASCADE,
    cargo_type VARCHAR(50) NOT NULL CHECK (cargo_type IN ('oil', 'materials', 'provisions')),
    amount INTEGER DEFAULT 0 CHECK (amount >= 0),
    price INTEGER DEFAULT 0 CHECK (price >= 0),
    UNIQUE(port_id, cargo_type)
);

CREATE INDEX idx_port_cargo_port_id ON port_cargo(port_id);

-- Таблица судов
CREATE TABLE IF NOT EXISTS ships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL CHECK (type IN ('tanker', 'cargo', 'supply')),
    name VARCHAR(255) NOT NULL,
    current_port_id UUID NOT NULL REFERENCES ports(id),
    fuel INTEGER DEFAULT 100 CHECK (fuel >= 0),
    max_fuel INTEGER DEFAULT 100,
    health INTEGER DEFAULT 100 CHECK (health >= 0 AND health <= 100),
    max_health INTEGER DEFAULT 100,
    crew_level INTEGER DEFAULT 1 CHECK (crew_level >= 1 AND crew_level <= 10),
    cargo_type VARCHAR(50) CHECK (cargo_type IN ('oil', 'materials', 'provisions')),
    cargo_amount INTEGER CHECK (cargo_amount >= 0),
    cargo_purchase_port_id UUID REFERENCES ports(id),
    cargo_purchase_price_per_unit INTEGER CHECK (cargo_purchase_price_per_unit >= 0),
    is_traveling BOOLEAN DEFAULT FALSE,
    travel_start_time TIMESTAMP WITH TIME ZONE,
    travel_end_time TIMESTAMP WITH TIME ZONE,
    destination_port_id UUID REFERENCES ports(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Статистика по судну
    purchase_price INTEGER DEFAULT 0 CHECK (purchase_price >= 0),
    total_distance_nm BIGINT DEFAULT 0 CHECK (total_distance_nm >= 0),
    total_trips INTEGER DEFAULT 0 CHECK (total_trips >= 0),
    total_cargo_moved INTEGER DEFAULT 0 CHECK (total_cargo_moved >= 0),
    total_profit INTEGER DEFAULT 0,
    total_fuel_cost INTEGER DEFAULT 0 CHECK (total_fuel_cost >= 0),
    total_cargo_cost INTEGER DEFAULT 0 CHECK (total_cargo_cost >= 0),
    total_repair_cost INTEGER DEFAULT 0 CHECK (total_repair_cost >= 0),
    total_tow_cost INTEGER DEFAULT 0 CHECK (total_tow_cost >= 0)
);

CREATE INDEX idx_ships_user_id ON ships(user_id);
CREATE INDEX idx_ships_current_port_id ON ships(current_port_id);
CREATE INDEX idx_ships_is_traveling ON ships(is_traveling);

-- Таблица грузов на рынке
CREATE TABLE IF NOT EXISTS market_cargo (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cargo_type VARCHAR(50) NOT NULL CHECK (cargo_type IN ('oil', 'materials', 'provisions')),
    amount INTEGER NOT NULL CHECK (amount > 0),
    port_id UUID NOT NULL REFERENCES ports(id),
    seller_id UUID NOT NULL REFERENCES users(id),
    price INTEGER NOT NULL CHECK (price >= 0),
    is_sold BOOLEAN DEFAULT FALSE,
    sold_to UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    sold_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_market_cargo_port_id ON market_cargo(port_id);
CREATE INDEX idx_market_cargo_is_sold ON market_cargo(is_sold);
CREATE INDEX idx_market_cargo_seller_id ON market_cargo(seller_id);

-- Функция для добавления монет пользователю
CREATE OR REPLACE FUNCTION add_user_coins(user_uuid UUID, amount INTEGER)
RETURNS INTEGER AS $$
DECLARE
    new_balance INTEGER;
BEGIN
    UPDATE users 
    SET coins = coins + amount 
    WHERE id = user_uuid
    RETURNING coins INTO new_balance;
    RETURN new_balance;
END;
$$ LANGUAGE plpgsql;

-- Функция для списания монет
CREATE OR REPLACE FUNCTION spend_user_coins(user_uuid UUID, amount INTEGER)
RETURNS INTEGER AS $$
DECLARE
    current_coins INTEGER;
    new_balance INTEGER;
BEGIN
    SELECT coins INTO current_coins FROM users WHERE id = user_uuid;
    
    IF current_coins < amount THEN
        RAISE EXCEPTION 'Недостаточно монет';
    END IF;
    
    UPDATE users 
    SET coins = coins - amount 
    WHERE id = user_uuid
    RETURNING coins INTO new_balance;
    RETURN new_balance;
END;
$$ LANGUAGE plpgsql;

-- Функция для расчета динамической цены груза в порту
CREATE OR REPLACE FUNCTION calculate_port_cargo_price(current_amount INTEGER)
RETURNS INTEGER AS $$
DECLARE
    base_price INTEGER := 7;
    min_price INTEGER := 4;
    max_price INTEGER := 10;
    reference_amount INTEGER := 4000;
    min_amount INTEGER := 200;
    normalized_amount NUMERIC;
    calculated_price NUMERIC;
BEGIN
    -- Если груза очень мало - максимальная цена
    IF current_amount <= min_amount THEN
        RETURN max_price;
    END IF;
    
    -- Нормализуем количество относительно эталонного
    normalized_amount := LEAST(current_amount::NUMERIC / reference_amount, 1.0);
    
    -- Рассчитываем цену: чем меньше груза, тем выше цена
    calculated_price := min_price + (max_price - min_price) * (1 - normalized_amount);
    
    -- Округляем до целого числа
    RETURN ROUND(calculated_price);
END;
$$ LANGUAGE plpgsql;

-- Вставка начальных портов
INSERT INTO ports (name, location_lat, location_lng) VALUES
    ('Порт "Завод Материалов"', 59.9343, 30.3351),
    ('Порт "Нефтяной завод"', 43.1056, 131.8735),
    ('Порт "Провизионный завод"', 44.7239, 37.7688)
ON CONFLICT (name) DO NOTHING;

-- Вставка начальных грузов в порты
DO $$
DECLARE
    port_spb UUID;
    port_vlad UUID;
    port_novo UUID;
BEGIN
    SELECT id INTO port_spb FROM ports WHERE name = 'Порт "Завод Материалов"';
    SELECT id INTO port_vlad FROM ports WHERE name = 'Порт "Нефтяной завод"';
    SELECT id INTO port_novo FROM ports WHERE name = 'Порт "Провизионный завод"';
    
    -- Порт "Завод Материалов": генерирует МАТЕРИАЛЫ (требует нефть и провизию)
    INSERT INTO port_cargo (port_id, cargo_type, amount, price) VALUES
        (port_spb, 'materials', 1000, calculate_port_cargo_price(1000)),
        (port_spb, 'oil', 0, calculate_port_cargo_price(0)),
        (port_spb, 'provisions', 0, calculate_port_cargo_price(0))
    ON CONFLICT (port_id, cargo_type) DO NOTHING;
    
    -- Порт "Нефтяной завод": генерирует НЕФТЬ (требует материалы и провизию)
    INSERT INTO port_cargo (port_id, cargo_type, amount, price) VALUES
        (port_vlad, 'oil', 1000, calculate_port_cargo_price(1000)),
        (port_vlad, 'materials', 0, calculate_port_cargo_price(0)),
        (port_vlad, 'provisions', 0, calculate_port_cargo_price(0))
    ON CONFLICT (port_id, cargo_type) DO NOTHING;
    
    -- Порт "Провизионный завод": генерирует ПРОВИЗИЮ (требует материалы и нефть)
    INSERT INTO port_cargo (port_id, cargo_type, amount, price) VALUES
        (port_novo, 'provisions', 1000, calculate_port_cargo_price(1000)),
        (port_novo, 'materials', 0, calculate_port_cargo_price(0)),
        (port_novo, 'oil', 0, calculate_port_cargo_price(0))
    ON CONFLICT (port_id, cargo_type) DO NOTHING;
END $$;
