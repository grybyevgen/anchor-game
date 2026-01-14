#!/bin/bash
echo "Установка зависимостей для backend..."
cd "$(dirname "$0")"
npm install
if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Зависимости успешно установлены!"
    echo ""
    echo "Теперь вы можете запустить сервер командой: npm start"
else
    echo ""
    echo "❌ Ошибка при установке зависимостей"
    echo "Убедитесь, что Node.js установлен: https://nodejs.org/"
fi
