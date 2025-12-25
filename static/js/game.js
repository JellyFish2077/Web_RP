// ЗАМЕНИТЕ весь класс RoleVerseGame в game.js:

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

                // Сохраняем выбор
                this.currentUniverse = option.getAttribute('data-universe');
                this.showMessage('system', `Выбрана вселенная: ${option.querySelector('span').textContent}`);

                // Показываем поле для своей вселенной
                if (this.currentUniverse === 'custom') {
                    this.elements.customUniverse.classList.remove('hidden');
                } else {
                    this.elements.customUniverse.classList.add('hidden');
                    // Автоматически переходим к созданию персонажа
                    setTimeout(() => {
                        this.chooseUniverse(this.currentUniverse);
                    }, 500);
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
            this.showMessage('error', 'Не удалось начать игру. Пожалуйста, попробуйте еще раз.');
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

            if (universeId === 'custom') {
                data.custom_rules = this.elements.customRules.value || 'Мой собственный мир';
            }

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
                // Пробуем тестовый метод
                await this.createCharacterTest(universeId);
            }
        } catch (error) {
            console.error('Ошибка при выборе вселенной:', error);
            // Пробуем тестовый метод как запасной вариант
            await this.createCharacterTest(universeId);
        } finally {
            this.hideLoading();
        }
    }

    async createCharacterTest(universeId) {
        // Используем тестовое создание персонажа
        this.showLoading('Создаем мир...');

        const characterPrompt = this.elements.characterInput.value || "храбрый искатель приключений";

        try {
            const response = await fetch('/api/create-character-test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: this.userId,
                    character_prompt: characterPrompt,
                    universe_id: universeId
                })
            });

            const data = await response.json();

            if (data.success && data.game_started) {
                this.showMessage('ai', data.story);
                this.updateCharacterInfo(data);
                this.gameState = 'playing';
                this.updateUI();
                this.showMessage('system', `✨ Игра началась! Вы в мире ${data.universe || 'фэнтези'}.`);
            }
        } catch (error) {
            console.error('Ошибка при создании персонажа:', error);
            this.showMessage('error', 'Не удалось создать персонажа. Пробуем альтернативный вариант...');
            // Аварийное создание
            await this.createEmergencyCharacter(universeId);
        } finally {
            this.hideLoading();
        }
    }

    async createEmergencyCharacter(universeId) {
        // Аварийное создание персонажа если API не работает
        const stories = {
            "fantasy": "Вы стоите на пороге древнего замка. Легенды говорят о сокровищах, скрытых в его глубинах. Ваше приключение начинается здесь.",
            "cyberpunk": "Неоновые огни мегаполиса слепят глаза. Вы получили задание от таинственного работодателя. Риск высок, но награда того стоит.",
            "space": "Ваш корабль выходит из гиперпространства над неизведанной планетой. Сканеры фиксируют аномалии. Что скрывает этот мир?"
        };

        const story = stories[universeId] || stories.fantasy;

        const characterData = {
            success: true,
            game_started: true,
            story: story,
            inventory: ["факел", "нож", "фляга с водой"],
            stats: {"Сила": 8, "Ловкость": 7, "Интеллект": 6, "Мудрость": 5, "Харизма": 4},
            abilities: ["Выживание", "Наблюдение"],
            health: 100
        };

        this.showMessage('ai', story);
        this.updateCharacterInfo(characterData);
        this.gameState = 'playing';
        this.updateUI();
        this.showMessage('system', '⚠️ Игра запущена в упрощенном режиме. AI может быть недоступен.');
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

        // Используем тестовый метод для надежности
        await this.createCharacterTest(this.currentUniverse);
    }

    // ... остальные методы остаются без изменений ...

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
    }

    // ... остальной код остается без изменений ...
}

// Инициализация игры при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    window.game = new RoleVerseGame();
});