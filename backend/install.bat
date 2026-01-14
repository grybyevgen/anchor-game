@echo off
echo Установка зависимостей для backend...
cd /d %~dp0
npm install
if %errorlevel% == 0 (
    echo.
    echo ✅ Зависимости успешно установлены!
    echo.
    echo Теперь вы можете запустить сервер командой: npm start
) else (
    echo.
    echo ❌ Ошибка при установке зависимостей
    echo Убедитесь, что Node.js установлен: https://nodejs.org/
)
pause
