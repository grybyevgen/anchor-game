-- ============================================
-- СКРИПТ ДЛЯ ПОЛНОГО ВАЙПА БАЗЫ ДАННЫХ
-- ============================================
-- ВНИМАНИЕ: Этот скрипт удалит ВСЕ данные из базы!
-- Используйте только если хотите полностью пересоздать базу.
-- ============================================

-- Удаление всех таблиц в правильном порядке (с учетом внешних ключей)
DROP TABLE IF EXISTS market_cargo CASCADE;
DROP TABLE IF EXISTS ships CASCADE;
DROP TABLE IF EXISTS port_cargo CASCADE;
DROP TABLE IF EXISTS ports CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Удаление всех функций
DROP FUNCTION IF EXISTS add_user_coins(UUID, INTEGER) CASCADE;
DROP FUNCTION IF EXISTS spend_user_coins(UUID, INTEGER) CASCADE;
DROP FUNCTION IF EXISTS calculate_port_cargo_price(INTEGER) CASCADE;

-- Удаление расширений (опционально, если не нужны)
-- DROP EXTENSION IF EXISTS "uuid-ossp" CASCADE;

-- ============================================
-- После выполнения этого скрипта выполните:
-- database/schema.sql
-- ============================================
