# Anchor Backend

API для игры ANCHOR. Работает с Supabase (БД) и деплоится на Railway.

## Переменные окружения

Скопируйте из `info.txt` в корне проекта или задайте вручную:

- `SUPABASE_URL` — URL проекта Supabase
- `SUPABASE_SERVICE_ROLE_KEY` — service role key (секретный)
- `PORT` — порт сервера (по умолчанию 3000)
- `TELEGRAM_BOT_TOKEN` — для бота (опционально)
- `WEBHOOK_URL` — URL webhook для Telegram (опционально)
- `GAME_URL` — URL фронтенда для ссылки в боте

Для локальной разработки создайте файл `.env` в папке `backend` с этими переменными.

## Установка и запуск

```bash
cd backend
npm install
npm run dev
```

Сборка для продакшена:

```bash
npm run build
npm start
```

## API

- **POST** `/api/companies` — создать компанию. Тело: `{ "name": "Название" }`. Возвращает компанию и уровень. После создания фронт сохраняет `company.id` и передаёт в заголовке `X-Company-Id` во всех запросах.
- **GET** `/api/companies/me` — текущая компания (нужен заголовок `X-Company-Id`).
- **PATCH** `/api/companies/me/level-up` — повысить уровень компании (если выполнены условия).

- **GET** `/api/ports` — список портов с актуальными складами (на бэкенде считается производство каждые 5 сек).

- **GET** `/api/ships` — корабли компании с позициями и грузом (`X-Company-Id`).
- **POST** `/api/ships` — купить корабль. Тело: `{ "type": "tanker"|"cargo"|"supply"|"barge", "name": "Имя" }`.
- **POST** `/api/ships/:id/send` — отправить в порт. Тело: `{ "destinationPortId": "port2" }`.
- **POST** `/api/ships/:id/arrive` — корабль прибыл (вызвать после анимации).
- **POST** `/api/ships/:id/load` — погрузка. Тело: `{ "cargoType": "oil"|"materials"|"provisions", "amount": number }`.
- **POST** `/api/ships/:id/unload` — разгрузка (в другом порту).
- **POST** `/api/ships/:id/refuel` — заправить (только в нефтяном порту). Тело: `{ "amount": number }`.
- **POST** `/api/ships/:id/repair` — починить (только в порту материалов). Тело: `{ "amount": number }`.
- **POST** `/api/ships/:id/morale` — поднять боевой дух (только в провизионном порту). Тело: `{ "amount": number }`.
- **POST** `/api/ships/:id/tow` — отбуксировать в нефтяной порт (списание монет).

- **GET** `/api/tasks` — задачи компании (прогресс синхронизируется с рейсами/монетами/кораблями).
- **POST** `/api/tasks/:id/claim` — забрать награду за задачу.

- **GET** `/api/leaderboard` — таблица лидеров по монетам. Опционально `X-Company-Id` для пометки текущего игрока.

- **POST** `/api/telegram/webhook` — webhook для Telegram-бота (настроить в BotFather: setWebhook на этот URL).

## Telegram Web App (Mini App)

- **POST** `/api/companies/telegram-auth` — авторизация по `initData` из Telegram Mini App. Тело: `{ "initData": "..." }`. Если компания привязана к этому Telegram user, возвращает `{ companyId, company }`; иначе 404.
- **POST** `/api/companies/link-telegram` — привязать текущую компанию к Telegram user. Заголовок `X-Company-Id`, тело `{ "initData": "..." }`. Нужен `TELEGRAM_BOT_TOKEN` для проверки подписи.

`initData` проверяется по [документации Telegram](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app). В БД у компании есть поле `telegram_user_id` (миграция `002_telegram_user_id.sql`).

## Два репозитория

Бэкенд и фронтенд — отдельные репозитории. Фронт после создания компании сохраняет `company.id` (например в localStorage или состоянии) и при каждом запросе к API отправляет заголовок `X-Company-Id`.
