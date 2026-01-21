-- Миграция: добавление поля cargo_purchase_port_id в таблицу ships
-- Выполните этот скрипт, если база данных уже создана

ALTER TABLE ships 
ADD COLUMN IF NOT EXISTS cargo_purchase_port_id UUID REFERENCES ports(id);
