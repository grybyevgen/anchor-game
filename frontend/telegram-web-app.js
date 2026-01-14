// Инициализация Telegram Web App
const tg = window.Telegram.WebApp;

// Инициализация приложения
tg.ready();
tg.expand();

// Настройка цветовой схемы
tg.setHeaderColor('#2481cc');
tg.setBackgroundColor('#ffffff');

// Получение данных пользователя
const user = tg.initDataUnsafe?.user || {};
const userId = user.id || null;
const username = user.username || user.first_name || 'Игрок';

// Экспорт для использования в других файлах
window.TelegramWebApp = {
    tg,
    user,
    userId,
    username,
    initData: tg.initData,
    sendData: (data) => tg.sendData(JSON.stringify(data))
};