-- Скрипт для увеличения количества грузов в портах в 100 раз
-- Выполните этот скрипт, если база данных уже создана
-- Также пересчитывает цены на основе нового количества

-- Сначала создаем функцию для расчета динамической цены (если еще не создана)
CREATE OR REPLACE FUNCTION calculate_port_cargo_price(current_amount INTEGER)
RETURNS INTEGER AS $$
DECLARE
    base_price INTEGER := 5;
    min_price INTEGER := 2;
    max_price INTEGER := 15;
    reference_amount INTEGER := 5000;
    min_amount INTEGER := 100;
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

-- Увеличиваем количество и пересчитываем цены
UPDATE port_cargo 
SET 
    amount = amount * 100,
    price = calculate_port_cargo_price(amount * 100)
WHERE amount > 0;
