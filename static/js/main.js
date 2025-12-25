// Основной JavaScript для главной страницы

document.addEventListener('DOMContentLoaded', function() {
    // Элементы DOM
    const startGameBtn = document.getElementById('start-game-btn');
    const aboutBtn = document.getElementById('about-btn');
    const apiBtn = document.getElementById('api-btn');
    const aboutModal = document.getElementById('about-modal');
    const closeModalBtns = document.querySelectorAll('.close-modal');
    const playerCount = document.getElementById('player-count');
    const gamesCount = document.getElementById('games-count');

    // Инициализация
    updateStats();

    // Обработчики событий
    startGameBtn.addEventListener('click', startNewGame);
    aboutBtn.addEventListener('click', () => showModal(aboutModal));
    apiBtn.addEventListener('click', showApiInfo);

    closeModalBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            aboutModal.classList.add('hidden');
        });
    });

    // Закрытие модального окна при клике вне его
    aboutModal.addEventListener('click', (e) => {
        if (e.target === aboutModal) {
            aboutModal.classList.add('hidden');
        }
    });

    // Функции
    function startNewGame() {
        // Переход на страницу игры
        window.location.href = '/game';
    }

    function showModal(modal) {
        modal.classList.remove('hidden');
    }

    function showApiInfo() {
        alert('API доступно по адресу: /api/...\n\nДоступные эндпоинты:\n' +
              'POST /api/start-game - Начать новую игру\n' +
              'POST /api/choose-universe - Выбрать вселенную\n' +
              'POST /api/create-character - Создать персонажа\n' +
              'POST /api/action - Выполнить действие\n' +
              'POST /api/get-status - Получить статус\n' +
              'POST /api/save-game - Сохранить игру\n' +
              'POST /api/load-game - Загрузить игру\n' +
              'GET /health - Проверка здоровья');
    }

    async function updateStats() {
        try {
            const response = await fetch('/health');
            const data = await response.json();

            // Обновляем статистику
            playerCount.textContent = data.active_sessions;
            gamesCount.textContent = Math.floor(data.active_sessions * 0.7); // Примерная логика

            // Показываем статус AI
            if (!data.ai_available) {
                showNotification('AI сервис временно недоступен', 'warning');
            }
        } catch (error) {
            console.error('Ошибка при получении статистики:', error);
            playerCount.textContent = '?';
            gamesCount.textContent = '?';
        }
    }

    function showNotification(message, type = 'info') {
        // Создаем уведомление
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            background: ${type === 'warning' ? '#ff9900' : '#00d4ff'};
            color: white;
            border-radius: 5px;
            z-index: 1000;
            animation: slideIn 0.3s ease;
        `;

        document.body.appendChild(notification);

        // Удаляем через 5 секунд
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 5000);
    }

    // Добавляем стили для анимаций
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }

        @keyframes slideOut {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(100%); opacity: 0; }
        }
    `;
    document.head.appendChild(style);

    // Обновляем статистику каждые 30 секунд
    setInterval(updateStats, 30000);
});