-- Миграция: добавление поля cargo_purchase_price_per_unit в таблицу ships
-- Выполните этот скрипт, если база данных уже создана

ALTER TABLE ships 
ADD COLUMN IF NOT EXISTS cargo_purchase_price_per_unit INTEGER CHECK (cargo_purchase_price_per_unit >= 0);

