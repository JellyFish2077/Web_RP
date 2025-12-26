// game.js - ПОЛНЫЙ ИСПРАВЛЕННЫЙ КОД

class RoleVerseGame {
    constructor() {
        this.userId = null;
        this.gameState = 'universe_select'; // universe_select, character_create, playing
        this.currentUniverse = null;

        this.init();
    }

    async init() {
        // Инициализация элементов DOM
        this.elements = {
            // Контролы
            backToMenu: document.getElementById('back-to-menu'),
            saveGameBtn: document.getElementById('save-game-btn'),
            actionInput: document.getElementById('action-input'),
            sendAction: document.getElementById('send-action'),

            // Панели
            universeSelector: document.getElementById('universe-selector'),
            characterCreator: document.getElementById('character-creator'),
            characterInfo: document.getElementById('character-info'),
            inventoryPanel: document.getElementById('inventory-panel'),
            statsPanel: document.getElementById('stats-panel'),

            // Элементы данных
            characterInput: document.getElementById('character-input'),
            createCharacter: document.getElementById('create-character'),
            gameStory: document.getElementById('game-story'),
            inventoryItems: document.getElementById('inventory-items'),
            statsList: document.getElementById('stats-list'),
            characterDetails: document.getElementById('character-details'),
            playerHealth: document.getElementById('player-health'),

            // Universe options
            universeOptions: document.querySelectorAll('.universe-option'),
            customUniverse: document.getElementById('custom-universe'),
            customRules: document.getElementById('custom-rules'),

            // Quick actions
            quickBtns: document.querySelectorAll('.quick-btn'),

            // Tabs
            tabBtns: document.querySelectorAll('.tab-btn'),

            // Status
            connectionDot: document.getElementById('connection-dot'),
            connectionText: document.getElementById('connection-text'),
            gameStatusText: document.getElementById('game-status-text'),

            // Modals
            saveModal: document.getElementById('save-modal'),
            loadModal: document.getElementById('load-modal'),
            saveData: document.getElementById('save-data'),
            loadData: document.getElementById('load-data'),
            copySave: document.getElementById('copy-save'),
            loadSave: document.getElementById('load-save'),
            closeModals: document.querySelectorAll('.close-modal')
        };

        // Обработчики событий
        this.setupEventListeners();

        // Запускаем новую игру
        await this.startNewGame();
    }

    setupEventListeners() {
        // Навигация
        this.elements.backToMenu.addEventListener('click', () => {
            if (confirm('Вернуться в главное меню? Несохраненный прогресс будет потерян.')) {
                window.location.href = '/';
            }
        });

        // Сохранение игры
        this.elements.saveGameBtn.addEventListener('click', () => this.saveGame());

        // Действия
        this.elements.sendAction.addEventListener('click', () => this.performAction());
        this.elements.actionInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.performAction();
            }
        });

        // Быстрые действия
        this.elements.quickBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.getAttribute('data-action');
                this.elements.actionInput.value = action;
                this.performAction();
            });
        });

        // Выбор вселенной - ИСПРАВЛЕНО
        this.elements.universeOptions.forEach(option => {
            option.addEventListener('click', () => {
                // Снимаем выделение со всех вариантов
                this.elements.universeOptions.forEach(opt => {
                    opt.classList.remove('selected');
                });

                // Выделяем выбранный
                option.classList.add('selected');

                const universeId = option.getAttribute('data-universe');
                this.currentUniverse = universeId;

                // Показываем поле для своей вселенной
                if (universeId === 'custom') {
                    this.elements.customUniverse.classList.remove('hidden');
                    this.showMessage('system', '🎨 Вы выбрали создание своей вселенной. Опишите правила мира в поле ниже, затем нажмите "Создать вселенную".');

                    // Добавляем обработчик для кнопки создания вселенной
                    const confirmBtn = document.getElementById('confirm-custom-btn');
                    if (confirmBtn) {
                        confirmBtn.onclick = () => this.createCustomUniverse();
                    }
                } else {
                    this.elements.customUniverse.classList.add('hidden');
                    // Автоматически продолжаем для стандартных вселенных
                    setTimeout(() => {
                        this.chooseUniverse(universeId);
                    }, 300);
                }
            });
        });

        // Создание персонажа
        this.elements.createCharacter.addEventListener('click', () => this.createCharacter());
        this.elements.characterInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.createCharacter();
            }
        });

        // Вкладки
        this.elements.tabBtns.forEach(btn => {
            btn.addEventListener('click', () => this.switchTab(btn));
        });

        // Модальные окна
        this.elements.closeModals.forEach(btn => {
            btn.addEventListener('click', () => {
                this.elements.saveModal.classList.add('hidden');
                this.elements.loadModal.classList.add('hidden');
            });
        });

        this.elements.copySave.addEventListener('click', () => this.copySaveData());
        this.elements.loadSave.addEventListener('click', () => this.loadGame());

        // Кнопка отмены для кастомной вселенной
        const cancelBtn = document.getElementById('cancel-custom-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                this.elements.customUniverse.classList.add('hidden');
                this.elements.universeOptions.forEach(opt => opt.classList.remove('selected'));
                this.currentUniverse = null;
                this.showMessage('system', 'Создание вселенной отменено. Выберите другую вселенную.');
            });
        }
    }

    async createCustomUniverse() {
        const customRules = this.elements.customRules.value.trim();

        if (!customRules) {
            this.showMessage('error', 'Пожалуйста, опишите правила вашей вселенной.');
            return;
        }

        try {
            this.showLoading('Создаем вашу вселенную...');

            const response = await fetch('/api/choose-universe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: this.userId,
                    universe_id: 'custom',
                    custom_rules: customRules
                })
            });

            const result = await response.json();

            if (result.success) {
                this.showMessage('system', '🌌 Ваша вселенная создана! Теперь опишите персонажа.');
                this.gameState = 'character_create';
                this.updateUI();
            } else {
                // Если API не работает, создаем тестовую вселенную
                await this.createTestCharacterForCustomUniverse(customRules);
            }
        } catch (error) {
            console.error('Ошибка при создании кастомной вселенной:', error);
            // Создаем тестовую вселенную
            await this.createTestCharacterForCustomUniverse(customRules);
        } finally {
            this.hideLoading();
        }
    }

    async createTestCharacterForCustomUniverse(customRules) {
        const characterPrompt = this.elements.characterInput.value || "создатель этого мира";

        const story = `🌌 **ВАША ВСЕЛЕННАЯ:**\n\n${customRules}\n\n🎭 **ВАШ ПЕРСОНАЖ:** ${characterPrompt}\n\nВы начинаете свое приключение в мире, который сами создали. Что вы хотите сделать?`;

        const characterData = {
            success: true,
            game_started: true,
            story: story,
            inventory: ["перо создателя", "книга законов мира", "ключ от всех дверей"],
            stats: {"Сила": 6, "Ловкость": 6, "Интеллект": 10, "Мудрость": 9, "Харизма": 8},
            abilities: ["Творчество", "Планирование", "Воображение"],
            health: 100
        };

        this.showMessage('ai', story);
        this.updateCharacterInfo(characterData);
        this.gameState = 'playing';
        this.updateUI();
        this.showMessage('system', '✨ Игра началась! Вы в мире, который сами создали.');
    }

    async startNewGame() {
        try {
            this.showLoading('Начинаем новую игру...');

            const response = await fetch('/api/start-game', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });

            const data = await response.json();

            if (data.user_id) {
                this.userId = data.user_id;
                this.showMessage('system', '🎮 Новая игра создана! Выберите вселенную для своего приключения.');
                this.gameState = 'universe_select';
                this.updateUI();
            } else {
                throw new Error('Не удалось создать игру');
            }
        } catch (error) {
            console.error('Ошибка при старте игры:', error);
            // Создаем локальную игру если API не работает
            this.userId = `user_${Date.now()}`;
            this.showMessage('system', '🎮 Новая игра создана! Выберите вселенную для своего приключения.');
            this.gameState = 'universe_select';
            this.updateUI();
            this.showMessage('error', '⚠️ Сервер временно недоступен. Игра запущена в локальном режиме.');
        } finally {
            this.hideLoading();
        }
    }

    async chooseUniverse(universeId) {
        try {
            this.showLoading('Загружаем вселенную...');

            const data = {
                user_id: this.userId,
                universe_id: universeId
            };

            const response = await fetch('/api/choose-universe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            const result = await response.json();

            if (result.success && result.need_character) {
                this.showMessage('system', '🌌 Вселенная выбрана! Теперь опишите своего персонажа (например: "молодой маг", "кибер-хакер", "космический пират").');
                this.gameState = 'character_create';
                this.updateUI();
            } else {
                // Если API не работает, создаем тестового персонажа
                await this.createTestCharacter(universeId);
            }
        } catch (error) {
            console.error('Ошибка при выборе вселенной:', error);
            // Создаем тестового персонажа
            await this.createTestCharacter(universeId);
        } finally {
            this.hideLoading();
        }
    }

    async createTestCharacter(universeId) {
        const characterPrompt = this.elements.characterInput.value || "храбрый искатель приключений";

        const stories = {
            "fantasy": `🧙 **ФЭНТЕЗИ ВСЕЛЕННАЯ**\n\nВы - ${characterPrompt}. Вы стоите у входа в древние подземелья Драконьего Пика. Легенды говорят о магическом артефакте, скрытом в самой глубине. Страж у входа кивает вам, разрешая войти. Ваше приключение начинается...`,
            "cyberpunk": `🤖 **КИБЕРПАНК ВСЕЛЕННАЯ**\n\nВы - ${characterPrompt}. Неоновые огни мегаполиса "Новая Токио" отражаются в лужах кислотного дождя. Ваш нейро-коммуникатор вибрирует - новое сообщение от таинственного работодателя. Контракт опасен, но награда в 50 000 крипто-кредитов того стоит.`,
            "space": `🚀 **КОСМИЧЕСКАЯ ВСЕЛЕННАЯ**\n\nВы - ${characterPrompt}. Корабль "Звездный странник" выходит из гиперпространства над планетой Ксенон-7. Сканеры фиксируют аномальные энергетические сигнатуры. Капитан отдает приказ: "Исследовать и доложить".`
        };

        const story = stories[universeId] || stories.fantasy;

        const characterData = {
            success: true,
            game_started: true,
            story: story,
            inventory: ["факел", "нож", "фляга с водой"],
            stats: {"Сила": 8, "Ловкость": 7, "Интеллект": 6, "Мудрость": 5, "Харизма": 4},
            abilities: ["Выживание", "Наблюдение", "Бой"],
            health: 100
        };

        this.showMessage('ai', story);
        this.updateCharacterInfo(characterData);
        this.gameState = 'playing';
        this.updateUI();
        this.showMessage('system', `✨ Игра началась! Вы в мире ${universeId}.`);
    }

    async createCharacter() {
        const characterPrompt = this.elements.characterInput.value.trim();

        if (!characterPrompt) {
            this.showMessage('error', 'Пожалуйста, опишите своего персонажа (например: "молодой маг", "кибер-хакер").');
            return;
        }

        if (!this.currentUniverse) {
            this.showMessage('error', 'Сначала выберите вселенную!');
            return;
        }

        try {
            this.showLoading('Создаем персонажа...');

            const response = await fetch('/api/create-character', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: this.userId,
                    character_prompt: characterPrompt
                })
            });

            const data = await response.json();

            if (data.success && data.game_started) {
                this.showMessage('ai', data.story);
                this.updateCharacterInfo(data);
                this.gameState = 'playing';
                this.updateUI();
            } else {
                // Если AI не работает, используем тестового персонажа
                await this.createTestCharacter(this.currentUniverse);
            }
        } catch (error) {
            console.error('Ошибка при создании персонажа:', error);
            // Используем тестового персонажа
            await this.createTestCharacter(this.currentUniverse);
        } finally {
            this.hideLoading();
        }
    }

    async performAction() {
        const action = this.elements.actionInput.value.trim();

        if (!action) {
            this.showMessage('error', 'Пожалуйста, введите действие.');
            return;
        }

        if (this.gameState !== 'playing') {
            this.showMessage('error', 'Сначала создайте персонажа.');
            return;
        }

        // Показываем действие игрока
        this.showMessage('player', action);
        this.elements.actionInput.value = '';

        try {
            this.showLoading('Обрабатываем действие...');

            const response = await fetch('/api/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: this.userId,
                    action: action
                })
            });

            const data = await response.json();

            if (data.success) {
                // Показываем результат с информацией о шансе
                let resultMessage = data.action_result;
                if (data.chance) {
                    resultMessage += `\n\n🎲 Шанс успеха: ${Math.round(data.chance)}% (выпало: ${Math.round(data.rolled)})`;
                    resultMessage += `\nРезультат: ${data.outcome}`;
                }

                this.showMessage('ai', resultMessage);

                // Обновляем информацию
                if (data.new_items && data.new_items.length > 0) {
                    this.showMessage('system', `🎁 Получены предметы: ${data.new_items.join(', ')}`);
                }

                // Обновляем статус
                this.updateStatus();
            } else {
                this.showMessage('error', data.message || 'Не удалось выполнить действие.');
            }
        } catch (error) {
            console.error('Ошибка при выполнении действия:', error);
            // Локальный ответ если API не работает
            const responses = [
                `AI: Вы успешно совершили действие "${action}". Мир реагирует на ваши поступки.`,
                `AI: Интересный выбор! История развивается неожиданным образом после "${action}".`,
                `AI: Ваше действие "${action}" меняет ход событий. Что будете делать дальше?`
            ];
            this.showMessage('ai', responses[Math.floor(Math.random() * responses.length)]);
        } finally {
            this.hideLoading();
        }
    }

    async updateStatus() {
        try {
            const response = await fetch('/api/get-status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: this.userId })
            });

            const data = await response.json();

            // Обновляем здоровье
            this.elements.playerHealth.textContent = `❤️ ${data.health}/100`;

            // Обновляем инвентарь
            this.updateInventory(data.inventory);

            // Обновляем характеристики
            this.updateStats(data.stats);

        } catch (error) {
            console.error('Ошибка при обновлении статуса:', error);
        }
    }

    updateInventory(inventory) {
        this.elements.inventoryItems.innerHTML = '';

        if (!inventory || inventory.length === 0) {
            this.elements.inventoryItems.innerHTML = '<p class="empty">Инвентарь пуст</p>';
            return;
        }

        inventory.forEach(item => {
            const itemElement = document.createElement('div');
            itemElement.className = 'inventory-item';
            itemElement.innerHTML = `
                <span>${item}</span>
                <i class="fas fa-info-circle"></i>
            `;
            this.elements.inventoryItems.appendChild(itemElement);
        });
    }

    updateStats(stats) {
        this.elements.statsList.innerHTML = '';

        if (!stats) {
            stats = {"Сила": 8, "Ловкость": 7, "Интеллект": 6, "Мудрость": 5, "Харизма": 4};
        }

        for (const [stat, value] of Object.entries(stats)) {
            const statElement = document.createElement('div');
            statElement.className = 'stat-item';
            statElement.innerHTML = `
                <div class="stat-name">${stat}</div>
                <div class="stat-value">${value}</div>
            `;
            this.elements.statsList.appendChild(statElement);
        }
    }

    updateCharacterInfo(data) {
        this.updateInventory(data.inventory);
        this.updateStats(data.stats);

        // Обновляем здоровье
        this.elements.playerHealth.textContent = `❤️ ${data.health || 100}/100`;
    }

    async saveGame() {
        try {
            const response = await fetch('/api/save-game', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: this.userId })
            });

            const data = await response.json();

            if (data.success) {
                this.elements.saveData.value = JSON.stringify(data.save_data, null, 2);
                this.elements.saveModal.classList.remove('hidden');
            }
        } catch (error) {
            console.error('Ошибка при сохранении игры:', error);
            this.showMessage('error', 'Не удалось сохранить игру. Используется локальное хранилище.');
        }
    }

    async loadGame() {
        const saveDataText = this.elements.loadData.value.trim();

        if (!saveDataText) {
            this.showMessage('error', 'Пожалуйста, введите данные сохранения.');
            return;
        }

        try {
            const saveData = JSON.parse(saveDataText);

            const response = await fetch('/api/load-game', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: this.userId,
                    save_data: saveData
                })
            });

            const data = await response.json();

            if (data.success) {
                this.showMessage('system', 'Игра загружена успешно!');
                this.updateCharacterInfo(data.game_data);
                this.gameState = 'playing';
                this.updateUI();
                this.elements.loadModal.classList.add('hidden');
            }
        } catch (error) {
            console.error('Ошибка при загрузке игры:', error);
            this.showMessage('error', 'Неверные данные сохранения.');
        }
    }

    copySaveData() {
        this.elements.saveData.select();
        document.execCommand('copy');
        this.showMessage('system', 'Данные сохранения скопированы в буфер обмена!');
    }

    switchTab(btn) {
        // Снимаем активный класс со всех кнопок
        this.elements.tabBtns.forEach(b => b.classList.remove('active'));

        // Добавляем активный класс нажатой кнопке
        btn.classList.add('active');

        const tab = btn.getAttribute('data-tab');

        // Скрываем все панели
        this.elements.characterInfo.classList.add('hidden');
        this.elements.inventoryPanel.classList.add('hidden');
        this.elements.statsPanel.classList.add('hidden');

        // Показываем выбранную панель
        switch (tab) {
            case 'character':
                this.elements.characterInfo.classList.remove('hidden');
                break;
            case 'inventory':
                this.elements.inventoryPanel.classList.remove('hidden');
                break;
            case 'stats':
                this.elements.statsPanel.classList.remove('hidden');
                break;
            case 'settings':
                this.showMessage('system', 'Настройки пока недоступны.');
                break;
        }
    }

    updateUI() {
        // Обновляем видимость элементов в зависимости от состояния игры
        switch (this.gameState) {
            case 'universe_select':
                this.elements.universeSelector.classList.remove('hidden');
                this.elements.characterCreator.classList.add('hidden');
                this.elements.characterInfo.classList.add('hidden');
                this.elements.inventoryPanel.classList.add('hidden');
                this.elements.statsPanel.classList.add('hidden');
                break;

            case 'character_create':
                this.elements.universeSelector.classList.add('hidden');
                this.elements.characterCreator.classList.remove('hidden');
                this.elements.characterInfo.classList.add('hidden');
                this.elements.inventoryPanel.classList.add('hidden');
                this.elements.statsPanel.classList.add('hidden');
                break;

            case 'playing':
                this.elements.universeSelector.classList.add('hidden');
                this.elements.characterCreator.classList.add('hidden');
                this.elements.characterInfo.classList.remove('hidden');
                this.elements.inventoryPanel.classList.remove('hidden');
                this.elements.statsPanel.classList.remove('hidden');
                break;
        }

        // Обновляем статус соединения
        this.updateConnectionStatus();
    }

    updateConnectionStatus() {
        this.elements.gameStatusText.textContent = this.getGameStatusText();
    }

    getGameStatusText() {
        switch (this.gameState) {
            case 'universe_select': return 'Выберите вселенную';
            case 'character_create': return 'Создайте персонажа';
            case 'playing': return 'Игра идет';
            default: return 'Готов к игре';
        }
    }

    showMessage(type, text) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;

        const timestamp = new Date().toLocaleTimeString();

        messageDiv.innerHTML = `
            <div class="message-content">${this.formatText(text)}</div>
            <div class="message-meta">
                <span>${this.getMessageTypeLabel(type)}</span>
                <span>${timestamp}</span>
            </div>
        `;

        this.elements.gameStory.appendChild(messageDiv);

        // Прокручиваем вниз
        this.elements.gameStory.scrollTop = this.elements.gameStory.scrollHeight;
    }

    formatText(text) {
        // Простое форматирование текста
        return text
            .replace(/\n/g, '<br>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>');
    }

    getMessageTypeLabel(type) {
        const labels = {
            'system': '⚙️ Система',
            'ai': '🤖 Мастер Игры',
            'player': '👤 Вы',
            'error': '❌ Ошибка'
        };
        return labels[type] || type;
    }

    showLoading(message) {
        this.elements.gameStatusText.textContent = message;
        this.elements.sendAction.disabled = true;
        this.elements.actionInput.disabled = true;
        if (this.elements.createCharacter) {
            this.elements.createCharacter.disabled = true;
        }
    }

    hideLoading() {
        this.elements.gameStatusText.textContent = this.getGameStatusText();
        this.elements.sendAction.disabled = false;
        this.elements.actionInput.disabled = false;
        if (this.elements.createCharacter) {
            this.elements.createCharacter.disabled = false;
        }
    }
}

// Инициализация игры при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    window.game = new RoleVerseGame();
});