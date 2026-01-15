// Конфигурация API
const API_URL = 'http://anchor-game-production.up.railway.app'; // Замените на ваш URL

// Состояние приложения
let currentUser = null;
let ships = [];
let ports = [];
let marketCargo = [];

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    initApp();
    setupEventListeners();
});

async function initApp() {
    // Получаем данные пользователя из Telegram
    currentUser = {
        id: window.TelegramWebApp.userId,
        username: window.TelegramWebApp.username
    };

    if (!currentUser.id) {
        alert('Ошибка: не удалось получить данные пользователя');
        return;
    }

    // Инициализируем пользователя на сервере
    await initUser();
    
    // Загружаем данные
    await loadUserData();
    await loadPorts();
    await loadMarket();
    
    // Обновляем UI
    updateUI();
}

async function initUser() {
    try {
        const response = await fetch(`${API_URL}/users/init`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                telegramId: currentUser.id,
                username: currentUser.username
            })
        });
        const data = await response.json();
        currentUser.coins = data.coins || 0;
    } catch (error) {
        console.error('Ошибка инициализации пользователя:', error);
    }
}

async function loadUserData() {
    try {
        const response = await fetch(`${API_URL}/users/${currentUser.id}`);
        const data = await response.json();
        currentUser.coins = data.coins;
        ships = data.ships || [];
    } catch (error) {
        console.error('Ошибка загрузки данных:', error);
    }
}

async function loadPorts() {
    try {
        const response = await fetch(`${API_URL}/ports`);
        ports = await response.json();
    } catch (error) {
        console.error('Ошибка загрузки портов:', error);
    }
}

async function loadMarket() {
    try {
        const response = await fetch(`${API_URL}/market`);
        marketCargo = await response.json();
    } catch (error) {
        console.error('Ошибка загрузки рынка:', error);
    }
}

function setupEventListeners() {
    // Переключение вкладок
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tab = e.target.dataset.tab;
            switchTab(tab);
        });
    });

    // Модальные окна
    document.querySelectorAll('.close').forEach(close => {
        close.addEventListener('click', () => {
            document.querySelectorAll('.modal').forEach(modal => {
                modal.style.display = 'none';
            });
        });
    });

    // Кнопка покупки судна
    document.getElementById('buy-ship-btn').addEventListener('click', showBuyShipModal);
}

function switchTab(tabName) {
    // Убираем активный класс со всех вкладок
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    // Активируем выбранную вкладку
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
    document.getElementById(`${tabName}-tab`).classList.add('active');
}

function updateUI() {
    // Обновляем монеты
    document.getElementById('coins').textContent = `💰 ${currentUser.coins || 0}`;
    document.getElementById('username').textContent = currentUser.username;

    // Обновляем список судов
    renderShips();
    
    // Обновляем список портов
    renderPorts();
    
    // Обновляем рынок
    renderMarket();
}

function renderShips() {
    const shipsList = document.getElementById('ships-list');
    
    if (ships.length === 0) {
        shipsList.innerHTML = '<div class="loading">У вас пока нет судов. Купите первое судно!</div>';
        return;
    }

    shipsList.innerHTML = ships.map(ship => `
        <div class="ship-card" onclick="openShipModal(${ship.id})">
            <h3>${ship.name}</h3>
            <div class="ship-info">
                <div class="stat">
                    <span>Тип:</span>
                    <span>${getShipTypeName(ship.type)}</span>
                </div>
                <div class="stat">
                    <span>Порт:</span>
                    <span>${getPortName(ship.currentPortId)}</span>
                </div>
                <div class="stat">
                    <span>Нефть:</span>
                    <span>${ship.fuel}/${ship.maxFuel}</span>
                </div>
                <div class="stat">
                    <span>Здоровье:</span>
                    <span>${ship.health}/${ship.maxHealth}</span>
                </div>
                <div class="stat">
                    <span>Груз:</span>
                    <span>${ship.cargo ? getCargoName(ship.cargo.type) + ' (' + ship.cargo.amount + ')' : 'Пусто'}</span>
                </div>
                ${ship.isTraveling ? '<div class="stat"><span>⏳ В пути...</span></div>' : ''}
            </div>
        </div>
    `).join('');
}

function renderPorts() {
    const portsList = document.getElementById('ports-list');
    portsList.innerHTML = ports.map(port => `
        <div class="port-card" onclick="openPortModal(${port.id})">
            <h3>${port.name}</h3>
            <div class="port-info">
                <div class="stat">
                    <span>Грузы доступны:</span>
                    <span>${port.availableCargo.length}</span>
                </div>
            </div>
        </div>
    `).join('');
}

function renderMarket() {
    const marketList = document.getElementById('market-list');
    
    if (marketCargo.length === 0) {
        marketList.innerHTML = '<div class="loading">На рынке пока нет грузов</div>';
        return;
    }

    marketList.innerHTML = marketCargo.map(cargo => `
        <div class="market-item">
            <h3>${getCargoName(cargo.type)}</h3>
            <div class="port-info">
                <div class="stat">
                    <span>Количество:</span>
                    <span>${cargo.amount}</span>
                </div>
                <div class="stat">
                    <span>Цена:</span>
                    <span>💰 ${cargo.price}</span>
                </div>
                <div class="stat">
                    <span>Порт:</span>
                    <span>${getPortName(cargo.portId)}</span>
                </div>
                <button class="btn-primary" onclick="buyCargo(${cargo.id})">Купить</button>
            </div>
        </div>
    `).join('');
}

async function openShipModal(shipId) {
    const ship = ships.find(s => s.id === shipId);
    if (!ship) return;

    const modal = document.getElementById('ship-modal');
    const title = document.getElementById('modal-title');
    const body = document.getElementById('modal-body');

    title.textContent = ship.name;
    
    if (ship.isTraveling) {
        body.innerHTML = '<div class="loading">Судно в пути. Подождите...</div>';
    } else {
        body.innerHTML = `
            <div class="ship-info">
                <div class="stat"><span>Тип:</span><span>${getShipTypeName(ship.type)}</span></div>
                <div class="stat"><span>Текущий порт:</span><span>${getPortName(ship.currentPortId)}</span></div>
                <div class="stat"><span>Нефть:</span><span>${ship.fuel}/${ship.maxFuel}</span></div>
                <div class="stat"><span>Здоровье:</span><span>${ship.health}/${ship.maxHealth}</span></div>
                <div class="stat"><span>Экипаж:</span><span>Уровень ${ship.crewLevel}</span></div>
            </div>
            
            ${ship.cargo ? `
                <div style="margin: 15px 0;">
                    <h4>Текущий груз: ${getCargoName(ship.cargo.type)} (${ship.cargo.amount})</h4>
                    <button class="btn-primary" onclick="unloadCargo(${ship.id})">Выгрузить груз</button>
                </div>
            ` : `
                <div style="margin: 15px 0;">
                    <h4>Загрузить груз:</h4>
                    <div class="cargo-selector">
                        ${getAvailableCargoForPort(ship.currentPortId).map(cargo => `
                            <div class="cargo-option" onclick="selectCargo(${ship.id}, '${cargo.type}', ${cargo.amount})">
                                ${getCargoName(cargo.type)} (${cargo.amount}) - 💰 ${cargo.price || 'Бесплатно'}
                            </div>
                        `).join('')}
                    </div>
                </div>
            `}
            
            <div style="margin: 15px 0;">
                <h4>Отправить в порт:</h4>
                <div class="port-selector">
                    ${ports.filter(p => p.id !== ship.currentPortId).map(port => `
                        <div class="port-option" onclick="sendShipToPort(${ship.id}, ${port.id})">
                            ${port.name} (💰 ${calculateTravelCost(ship, port)})
                        </div>
                    `).join('')}
                </div>
            </div>
            
            ${ship.health < ship.maxHealth ? `
                <button class="btn-secondary" onclick="repairShip(${ship.id})">Починить судно</button>
            ` : ''}
        `;
    }

    modal.style.display = 'block';
}

async function openPortModal(portId) {
    const port = ports.find(p => p.id === portId);
    if (!port) return;

    const modal = document.getElementById('port-modal');
    const title = document.getElementById('port-modal-title');
    const body = document.getElementById('port-modal-body');

    title.textContent = port.name;
    body.innerHTML = `
        <div class="port-info">
            <h4>Доступные грузы:</h4>
            ${port.availableCargo.map(cargo => `
                <div class="cargo-option">
                    ${getCargoName(cargo.type)} - ${cargo.amount} единиц
                </div>
            `).join('')}
        </div>
    `;

    modal.style.display = 'block';
}

async function sendShipToPort(shipId, portId) {
    const ship = ships.find(s => s.id === shipId);
    const port = ports.find(p => p.id === portId);
    
    if (!ship || !port) return;
    
    const cost = calculateTravelCost(ship, port);
    
    if (ship.fuel < cost) {
        alert('Недостаточно топлива!');
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/ships/${shipId}/travel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ portId })
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert(`Судно отправлено в ${port.name}!`);
            await loadUserData();
            updateUI();
            document.getElementById('ship-modal').style.display = 'none';
        } else {
            alert(data.error || 'Ошибка отправки судна');
        }
    } catch (error) {
        console.error('Ошибка:', error);
        alert('Ошибка отправки судна');
    }
}

async function selectCargo(shipId, cargoType, amount) {
    try {
        const response = await fetch(`${API_URL}/ships/${shipId}/load`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cargoType, amount })
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert('Груз загружен!');
            await loadUserData();
            updateUI();
            openShipModal(shipId);
        } else {
            alert(data.error || 'Ошибка загрузки груза');
        }
    } catch (error) {
        console.error('Ошибка:', error);
        alert('Ошибка загрузки груза');
    }
}

async function unloadCargo(shipId) {
    try {
        const response = await fetch(`${API_URL}/ships/${shipId}/unload`, {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert(`Груз выгружен! Получено: 💰 ${data.reward}`);
            await loadUserData();
            await loadMarket();
            updateUI();
            openShipModal(shipId);
        } else {
            alert(data.error || 'Ошибка выгрузки груза');
        }
    } catch (error) {
        console.error('Ошибка:', error);
        alert('Ошибка выгрузки груза');
    }
}

async function repairShip(shipId) {
    try {
        const response = await fetch(`${API_URL}/ships/${shipId}/repair`, {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert('Судно отремонтировано!');
            await loadUserData();
            updateUI();
            openShipModal(shipId);
        } else {
            alert(data.error || 'Ошибка ремонта');
        }
    } catch (error) {
        console.error('Ошибка:', error);
        alert('Ошибка ремонта');
    }
}

async function buyCargo(cargoId) {
    try {
        const response = await fetch(`${API_URL}/market/${cargoId}/buy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: currentUser.id })
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert('Груз куплен!');
            await loadUserData();
            await loadMarket();
            updateUI();
        } else {
            alert(data.error || 'Ошибка покупки');
        }
    } catch (error) {
        console.error('Ошибка:', error);
        alert('Ошибка покупки');
    }
}

function showBuyShipModal() {
    const shipTypes = [
        { type: 'tanker', name: 'Танкер', price: 1000, description: 'Перевозит нефть' },
        { type: 'cargo', name: 'Грузовое судно', price: 1500, description: 'Перевозит материалы' },
        { type: 'supply', name: 'Снабженец', price: 1200, description: 'Перевозит провизию' }
    ];
    
    const modal = document.getElementById('ship-modal');
    const title = document.getElementById('modal-title');
    const body = document.getElementById('modal-body');
    
    title.textContent = 'Купить судно';
    body.innerHTML = `
        <div class="cargo-selector">
            ${shipTypes.map(st => `
                <div class="cargo-option" onclick="purchaseShip('${st.type}')">
                    <h4>${st.name}</h4>
                    <p>${st.description}</p>
                    <p>💰 ${st.price}</p>
                </div>
            `).join('')}
        </div>
    `;
    
    modal.style.display = 'block';
}

async function purchaseShip(shipType) {
    try {
        const response = await fetch(`${API_URL}/ships/buy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: currentUser.id, type: shipType })
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert('Судно куплено!');
            await loadUserData();
            updateUI();
            document.getElementById('ship-modal').style.display = 'none';
        } else {
            alert(data.error || 'Ошибка покупки судна');
        }
    } catch (error) {
        console.error('Ошибка:', error);
        alert('Ошибка покупки судна');
    }
}

// Вспомогательные функции
function getShipTypeName(type) {
    const names = {
        'tanker': 'Танкер',
        'cargo': 'Грузовое',
        'supply': 'Снабженец'
    };
    return names[type] || type;
}

function getCargoName(type) {
    const names = {
        'oil': 'Нефть',
        'materials': 'Материалы',
        'provisions': 'Провизия'
    };
    return names[type] || type;
}

function getPortName(portId) {
    const port = ports.find(p => p.id === portId);
    return port ? port.name : 'Неизвестно';
}

function getAvailableCargoForPort(portId) {
    const port = ports.find(p => p.id === portId);
    return port ? port.availableCargo : [];
}

function calculateTravelCost(ship, port) {
    // Простая формула: расстояние * базовый расход
    return 10; // Упрощенно
}

// Экспорт функций для использования в HTML
window.openShipModal = openShipModal;
window.openPortModal = openPortModal;
window.sendShipToPort = sendShipToPort;
window.selectCargo = selectCargo;
window.unloadCargo = unloadCargo;
window.repairShip = repairShip;
window.buyCargo = buyCargo;
window.purchaseShip = purchaseShip;