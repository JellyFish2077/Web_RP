// game.js - ПОЛНЫЙ КОД С УЛУЧШЕНИЯМИ И ОБРАБОТКОЙ ОШИБОК

document.addEventListener('DOMContentLoaded', function() {
    class RoleVerseGame {
        constructor() {
            this.userId = null;
            this.currentUniverse = null;
            this.gameStarted = false;
            this.isProcessing = false;
            this.connectionStatus = 'disconnected';
            this.typingAnimations = new Map(); // Хранит активные анимации
            this.lastActionTime = null;
            this.retryCount = 0;
            this.MAX_RETRIES = 3;

            // Инициализация
            this.init();
        }

        init() {
            console.log('RoleVerse Game Initializing...');
            this.bindEvents();
            this.checkConnection();
            this.setupConnectionMonitor();
            this.setupActivityTracker();

            // Показываем приветственное сообщение
            this.showWelcomeMessage();
        }

        // ========== ОБРАБОТКА СОБЫТИЙ ==========

        bindEvents() {
            // Кнопка возврата в меню
            document.getElementById('back-to-menu').addEventListener('click', () => {
                if (confirm('Вернуться в главное меню? Несохраненный прогресс будет потерян.')) {
                    window.location.href = '/';
                }
            });

            // Кнопка сохранения игры
            document.getElementById('save-game-btn').addEventListener('click', () => {
                this.saveGame();
            });

            // Кнопка отправки действия
            const sendBtn = document.getElementById('send-action');
            const actionInput = document.getElementById('action-input');

            sendBtn.addEventListener('click', () => this.performAction());
            actionInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.performAction();
                }
            });

            // Быстрые действия
            document.querySelectorAll('.quick-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const action = e.currentTarget.getAttribute('data-action');
                    document.getElementById('action-input').value = action;
                    this.performAction();
                });
            });

            // Выбор вселенной
            document.querySelectorAll('.universe-option').forEach(option => {
                option.addEventListener('click', (e) => {
                    const universe = e.currentTarget.getAttribute('data-universe');
                    this.selectUniverse(universe);
                });
            });

            // Своя вселенная
            document.getElementById('confirm-custom-btn').addEventListener('click', () => {
                this.confirmCustomUniverse();
            });

            document.getElementById('cancel-custom-btn').addEventListener('click', () => {
                this.hideCustomUniverse();
            });

            // Создание персонажа
            document.getElementById('create-character').addEventListener('click', () => {
                this.createCharacter();
            });

            // Быстрый ввод персонажа
            document.getElementById('character-input').addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.createCharacter();
                }
            });

            // Вкладки
            document.querySelectorAll('.tab-btn').forEach(tab => {
                tab.addEventListener('click', (e) => {
                    const tabName = e.currentTarget.getAttribute('data-tab');
                    this.switchTab(tabName);
                });
            });

            // Модальные окна
            document.querySelectorAll('.close-modal').forEach(closeBtn => {
                closeBtn.addEventListener('click', () => {
                    closeBtn.closest('.modal').classList.add('hidden');
                });
            });

            // Копирование сохранения
            document.getElementById('copy-save').addEventListener('click', () => {
                this.copySaveData();
            });

            // Загрузка сохранения
            document.getElementById('load-save').addEventListener('click', () => {
                this.loadSaveData();
            });

            // Закрытие модалок по клику вне контента
            document.querySelectorAll('.modal').forEach(modal => {
                modal.addEventListener('click', (e) => {
                    if (e.target === modal) {
                        modal.classList.add('hidden');
                    }
                });
            });
        }

        // ========== СЕТЕВЫЕ ВЫЗОВЫ ==========

        async apiRequest(url, data = null, method = 'POST') {
            this.updateStatus('Отправка запроса...');
            this.lastActionTime = Date.now();

            try {
                const options = {
                    method: method,
                    headers: {
                        'Content-Type': 'application/json',
                    }
                };

                if (data) {
                    options.body = JSON.stringify(data);
                }

                const response = await fetch(url, options);

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.detail || `HTTP ${response.status}`);
                }

                const result = await response.json();
                this.retryCount = 0; // Сброс счетчика при успехе
                return result;

            } catch (error) {
                this.retryCount++;

                if (this.retryCount <= this.MAX_RETRIES) {
                    console.warn(`Retry ${this.retryCount}/${this.MAX_RETRIES} for ${url}`);
                    await this.delay(1000 * this.retryCount); // Экспоненциальная задержка
                    return this.apiRequest(url, data, method);
                }

                this.showError(`Ошибка сети: ${error.message}`);
                this.setConnectionStatus('error');
                throw error;
            }
        }

        async startNewGame() {
            try {
                this.updateStatus('Создание новой игры...');
                const result = await this.apiRequest('/api/start-game');

                if (result.user_id) {
                    this.userId = result.user_id;
                    this.showMessage('system', '🎮 Новая игра создана! Выберите вселенную.');
                    this.showUniverseSelector();
                }

            } catch (error) {
                this.showError('Не удалось создать игру. Проверьте соединение.');
            }
        }

        async selectUniverse(universeId) {
            if (!this.userId) {
                this.showError('Сначала начните новую игру');
                return;
            }

            // Снимаем выделение со всех вариантов
            document.querySelectorAll('.universe-option').forEach(opt => {
                opt.classList.remove('selected');
            });

            // Выделяем выбранный
            const selectedOption = document.querySelector(`[data-universe="${universeId}"]`);
            if (selectedOption) {
                selectedOption.classList.add('selected');
            }

            if (universeId === 'custom') {
                this.showCustomUniverse();
                return;
            }

            try {
                this.updateStatus('Выбор вселенной...');
                const result = await this.apiRequest('/api/choose-universe', {
                    user_id: this.userId,
                    universe_id: universeId
                });

                if (result.success) {
                    this.currentUniverse = universeId;
                    this.showMessage('system', `🌌 Вселенная выбрана: ${this.getUniverseName(universeId)}`);
                    this.showCharacterCreator();
                }

            } catch (error) {
                this.showError('Ошибка при выборе вселенной');
            }
        }

        async createCharacter() {
            const characterInput = document.getElementById('character-input');
            const characterPrompt = characterInput.value.trim();

            if (!characterPrompt) {
                this.showError('Введите описание персонажа');
                characterInput.focus();
                return;
            }

            if (!this.userId) {
                this.showError('Сначала выберите вселенную');
                return;
            }

            try {
                this.updateStatus('Создание персонажа...');

                // Показываем индикатор загрузки
                const loadingId = this.showTypingIndicator('ИИ создает вашего персонажа...');

                const result = await this.apiRequest('/api/create-character', {
                    user_id: this.userId,
                    character_prompt: characterPrompt
                });

                // Убираем индикатор
                this.removeTypingIndicator(loadingId);

                if (result.processing) {
                    this.showMessage('system', '⏳ Персонаж создается... Это может занять несколько секунд.');
                    // Запускаем проверку статуса
                    this.checkCharacterCreation(characterPrompt);
                } else if (result.game_started) {
                    this.handleGameStart(result, characterPrompt);
                }

            } catch (error) {
                this.showError('Ошибка при создании персонажа');
            }
        }

        async checkCharacterCreation(characterPrompt) {
            // Периодически проверяем статус создания персонажа
            const checkInterval = setInterval(async () => {
                try {
                    const status = await this.apiRequest('/api/get-status', {
                        user_id: this.userId
                    }, 'POST');

                    if (status.character === characterPrompt) {
                        clearInterval(checkInterval);
                        this.showMessage('system', '✅ Персонаж успешно создан!');
                        this.loadGameStatus();
                    }
                } catch (error) {
                    // Игнорируем ошибки проверки
                }
            }, 2000);

            // Таймаут через 30 секунд
            setTimeout(() => {
                clearInterval(checkInterval);
                this.showError('Создание персонажа заняло слишком много времени. Попробуйте еще раз.');
            }, 30000);
        }

        async performAction() {
            if (this.isProcessing) {
                this.showError('Дождитесь завершения текущего действия');
                return;
            }

            const actionInput = document.getElementById('action-input');
            const action = actionInput.value.trim();

            if (!action) {
                this.showError('Введите действие');
                actionInput.focus();
                return;
            }

            if (!this.userId || !this.gameStarted) {
                this.showError('Сначала начните игру и создайте персонажа');
                return;
            }

            // Проверяем частоту действий (не чаще 1 раза в 2 секунды)
            if (this.lastActionTime && Date.now() - this.lastActionTime < 2000) {
                this.showError('Вы действуете слишком быстро! Подождите немного.');
                return;
            }

            this.isProcessing = true;
            actionInput.disabled = true;

            try {
                // Показываем действие игрока
                this.showMessage('player', `🗣️ **Вы:** ${action}`);

                // Показываем индикатор обработки
                const loadingId = this.showTypingIndicator('Мастер игры думает...');

                const result = await this.apiRequest('/api/action', {
                    user_id: this.userId,
                    action: action
                });

                // Убираем индикатор
                this.removeTypingIndicator(loadingId);

                if (result.success) {
                    // Показываем результат с анимацией печати
                    this.showAnimatedMessage('ai', result.action_result);

                    // Обновляем статус
                    if (result.inventory) {
                        this.updateInventory(result.inventory, result.new_items || []);
                    }

                    if (result.health !== undefined) {
                        this.updateHealth(result.health);
                    }

                    // Показываем статистику действия
                    if (result.chance !== undefined) {
                        const statsText = `🎲 Шанс: ${result.chance.toFixed(0)}% | 🎯 Выпало: ${result.rolled.toFixed(0)} | 📊 Результат: ${result.outcome}`;
                        this.showMessage('system', statsText);
                    }

                } else if (result.type === 'validation_error') {
                    this.showMessage('error', `❌ ${result.message}`);
                } else if (result.game_over) {
                    this.showMessage('system', '💀 Игра окончена! Начните новую игру.');
                    this.gameStarted = false;
                }

            } catch (error) {
                this.showError('Ошибка при выполнении действия');
            } finally {
                this.isProcessing = false;
                actionInput.disabled = false;
                actionInput.value = '';
                actionInput.focus();
            }
        }

        async saveGame() {
            if (!this.userId) {
                this.showError('Нет активной игры для сохранения');
                return;
            }

            try {
                this.updateStatus('Сохранение игры...');
                const result = await this.apiRequest('/api/save-game', {
                    user_id: this.userId
                });

                if (result.success) {
                    const saveData = JSON.stringify(result.save_data, null, 2);
                    document.getElementById('save-data').value = saveData;
                    document.getElementById('save-modal').classList.remove('hidden');
                    this.showMessage('system', '💾 Игра сохранена!');
                }

            } catch (error) {
                this.showError('Ошибка при сохранении игры');
            }
        }

        async loadGame() {
            const loadData = document.getElementById('load-data').value.trim();

            if (!loadData) {
                this.showError('Введите данные сохранения');
                return;
            }

            try {
                const saveData = JSON.parse(loadData);
                this.updateStatus('Загрузка игры...');

                const result = await this.apiRequest('/api/load-game', {
                    user_id: this.userId || saveData.user_id,
                    save_data: saveData
                });

                if (result.success) {
                    this.userId = saveData.user_id;
                    this.gameStarted = true;
                    this.handleGameStart(result, saveData.character);
                    document.getElementById('load-modal').classList.add('hidden');
                    this.showMessage('system', '✅ Игра загружена!');
                }

            } catch (error) {
                this.showError('Ошибка при загрузке игры. Проверьте данные сохранения.');
            }
        }

        async loadGameStatus() {
            if (!this.userId) return;

            try {
                const status = await this.apiRequest('/api/get-status', {
                    user_id: this.userId
                }, 'POST');

                if (status.character) {
                    this.gameStarted = true;
                    this.updatePlayerInfo(status);
                    this.showGameInterface();
                }

            } catch (error) {
                console.error('Failed to load game status:', error);
            }
        }

        // ========== UI УПРАВЛЕНИЕ ==========

        showWelcomeMessage() {
            const storyDiv = document.getElementById('game-story');
            storyDiv.innerHTML = `
                <div class="welcome-message">
                    <h3><i class="fas fa-dragon"></i> Добро пожаловать в RoleVerse!</h3>
                    <p>Текстовое RPG с ИИ-мастером игры. Каждое ваше действие влияет на мир.</p>

                    <div class="welcome-actions">
                        <button id="start-new-game" class="btn btn-primary">
                            <i class="fas fa-play-circle"></i> Начать новую игру
                        </button>
                        <button id="load-existing-game" class="btn btn-secondary">
                            <i class="fas fa-upload"></i> Загрузить игру
                        </button>
                    </div>

                    <div class="game-features">
                        <h4><i class="fas fa-star"></i> Особенности:</h4>
                        <ul>
                            <li><i class="fas fa-robot"></i> Динамичный ИИ-мастер</li>
                            <li><i class="fas fa-globe"></i> 4 уникальные вселенные</li>
                            <li><i class="fas fa-chart-line"></i> Система характеристик</li>
                            <li><i class="fas fa-backpack"></i> Интерактивный инвентарь</li>
                            <li><i class="fas fa-save"></i> Сохранение прогресса</li>
                        </ul>
                    </div>
                </div>
            `;

            // Добавляем обработчики для кнопок приветствия
            document.getElementById('start-new-game').addEventListener('click', () => {
                this.startNewGame();
            });

            document.getElementById('load-existing-game').addEventListener('click', () => {
                document.getElementById('load-modal').classList.remove('hidden');
            });

            // Назначаем обработчик загрузки
            document.getElementById('load-save').addEventListener('click', () => {
                this.loadGame();
            });
        }

        showUniverseSelector() {
            document.getElementById('universe-selector').classList.remove('hidden');
            document.getElementById('character-creator').classList.add('hidden');
            document.getElementById('character-info').classList.add('hidden');
            document.getElementById('inventory-panel').classList.add('hidden');
            document.getElementById('stats-panel').classList.add('hidden');
        }

        showCustomUniverse() {
            document.getElementById('custom-universe').classList.remove('hidden');
        }

        hideCustomUniverse() {
            document.getElementById('custom-universe').classList.add('hidden');
            document.querySelectorAll('.universe-option').forEach(opt => {
                opt.classList.remove('selected');
            });
        }

        confirmCustomUniverse() {
            const customRules = document.getElementById('custom-rules').value.trim();

            if (!customRules) {
                this.showError('Опишите правила вашей вселенной');
                return;
            }

            if (!this.userId) return;

            // Вызываем API с кастомными правилами
            this.selectUniverse('custom');
        }

        showCharacterCreator() {
            document.getElementById('character-creator').classList.remove('hidden');
            document.getElementById('character-input').focus();
        }

        showGameInterface() {
            // Показываем все игровые панели
            document.getElementById('character-info').classList.remove('hidden');
            document.getElementById('inventory-panel').classList.remove('hidden');
            document.getElementById('stats-panel').classList.remove('hidden');

            // Скрываем создание персонажа
            document.getElementById('character-creator').classList.add('hidden');
            document.getElementById('universe-selector').classList.add('hidden');

            // Фокусируемся на поле ввода действий
            document.getElementById('action-input').focus();
        }

        switchTab(tabName) {
            // Обновляем активную вкладку
            document.querySelectorAll('.tab-btn').forEach(tab => {
                tab.classList.remove('active');
            });

            const activeTab = document.querySelector(`[data-tab="${tabName}"]`);
            if (activeTab) {
                activeTab.classList.add('active');
            }

            // Показываем соответствующую панель
            const panels = ['character-info', 'inventory-panel', 'stats-panel'];
            panels.forEach(panelId => {
                const panel = document.getElementById(panelId);
                if (panelId === `${tabName}-panel` || panelId === 'character-info' && tabName === 'character') {
                    panel.classList.remove('hidden');
                } else {
                    panel.classList.add('hidden');
                }
            });
        }

        // ========== СООБЩЕНИЯ И АНИМАЦИИ ==========

        showMessage(type, content, instant = false) {
            const storyDiv = document.getElementById('game-story');
            const messageDiv = document.createElement('div');

            const messageTypes = {
                'system': { icon: 'fa-info-circle', color: '#0088ff' },
                'ai': { icon: 'fa-robot', color: '#00ff88' },
                'player': { icon: 'fa-user', color: '#ff8800' },
                'error': { icon: 'fa-exclamation-triangle', color: '#ff4444' }
            };

            const config = messageTypes[type] || messageTypes.system;

            messageDiv.className = `message ${type}`;
            messageDiv.innerHTML = `
                <div class="message-header">
                    <i class="fas ${config.icon}"></i>
                    <span class="message-sender">${this.getSenderName(type)}</span>
                    <span class="message-time">${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                </div>
                <div class="message-content">${content}</div>
            `;

            storyDiv.appendChild(messageDiv);

            // Плавная прокрутка к новому сообщению
            setTimeout(() => {
                storyDiv.scrollTo({
                    top: storyDiv.scrollHeight,
                    behavior: 'smooth'
                });
            }, 100);
        }

        showAnimatedMessage(type, content) {
            const storyDiv = document.getElementById('game-story');
            const messageDiv = document.createElement('div');

            const config = type === 'ai'
                ? { icon: 'fa-robot', color: '#00ff88' }
                : { icon: 'fa-info-circle', color: '#0088ff' };

            messageDiv.className = `message ${type} typing-message`;
            messageDiv.innerHTML = `
                <div class="message-header">
                    <i class="fas ${config.icon}"></i>
                    <span class="message-sender">${this.getSenderName(type)}</span>
                    <span class="message-time">${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                </div>
                <div class="message-content typing-content"></div>
                <div class="typing-controls">
                    <button class="skip-btn" onclick="game.skipTyping(this)">
                        <i class="fas fa-forward"></i> Пропустить
                    </button>
                </div>
            `;

            storyDiv.appendChild(messageDiv);

            // Запускаем анимацию печати
            const contentDiv = messageDiv.querySelector('.typing-content');
            this.typeText(contentDiv, content, messageDiv);

            // Прокрутка
            setTimeout(() => {
                storyDiv.scrollTo({
                    top: storyDiv.scrollHeight,
                    behavior: 'smooth'
                });
            }, 100);
        }

        typeText(element, text, container, speed = 20) {
            const animationId = 'typing_' + Date.now() + '_' + Math.random();
            this.typingAnimations.set(animationId, { element, text, index: 0, speed, container });

            const typeNextChar = () => {
                const animation = this.typingAnimations.get(animationId);
                if (!animation) return;

                const { element, text, index, speed, container } = animation;

                if (index < text.length) {
                    // Добавляем следующий символ
                    element.innerHTML = this.formatTextForDisplay(text.substring(0, index + 1));

                    // Прокручиваем к концу
                    container.scrollIntoView({ behavior: 'smooth', block: 'end' });

                    // Обновляем индекс
                    animation.index++;
                    this.typingAnimations.set(animationId, animation);

                    // Рекурсивный вызов с задержкой
                    setTimeout(typeNextChar, this.getTypingSpeed(speed, text.charAt(index)));
                } else {
                    // Анимация завершена
                    this.finishTyping(container, animationId);
                }
            };

            // Запускаем анимацию
            typeNextChar();
            return animationId;
        }

        getTypingSpeed(baseSpeed, char) {
            // Разная скорость для разных символов
            if (char === ' ' || char === '\n') return baseSpeed / 2;
            if (/[.,!?;:]/.test(char)) return baseSpeed * 2;
            if (/[а-яА-Яa-zA-Z0-9]/.test(char)) return baseSpeed;
            return baseSpeed;
        }

        formatTextForDisplay(text) {
            // Базовая обработка форматирования
            return text
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                .replace(/\n/g, '<br>')
                .replace(/`(.*?)`/g, '<code>$1</code>');
        }

        finishTyping(container, animationId) {
            this.typingAnimations.delete(animationId);

            // Убираем кнопку пропуска
            const skipBtn = container.querySelector('.skip-btn');
            if (skipBtn) {
                skipBtn.style.display = 'none';
            }

            // Убираем класс typing-message
            container.classList.remove('typing-message');
        }

        skipTyping(button) {
            const messageDiv = button.closest('.message');
            const contentDiv = messageDiv.querySelector('.typing-content');
            const fullText = messageDiv.getAttribute('data-full-text') ||
                           contentDiv.textContent.replace(/<[^>]*>/g, '');

            // Показываем весь текст сразу
            contentDiv.innerHTML = this.formatTextForDisplay(fullText);

            // Завершаем все анимации для этого сообщения
            this.typingAnimations.forEach((animation, id) => {
                if (animation.container === messageDiv) {
                    this.typingAnimations.delete(id);
                }
            });

            this.finishTyping(messageDiv);
        }

        showTypingIndicator(message = 'Печатает...') {
            const storyDiv = document.getElementById('game-story');
            const indicatorId = 'typing_' + Date.now();

            const indicatorDiv = document.createElement('div');
            indicatorDiv.id = indicatorId;
            indicatorDiv.className = 'typing-indicator';
            indicatorDiv.innerHTML = `
                <div class="typing-avatar">
                    <i class="fas fa-robot"></i>
                </div>
                <div class="typing-content">
                    <div class="typing-dots">
                        <div class="typing-dot"></div>
                        <div class="typing-dot"></div>
                        <div class="typing-dot"></div>
                    </div>
                    <div class="typing-text">${message}</div>
                </div>
            `;

            storyDiv.appendChild(indicatorDiv);
            storyDiv.scrollTop = storyDiv.scrollHeight;

            return indicatorId;
        }

        removeTypingIndicator(indicatorId) {
            const indicator = document.getElementById(indicatorId);
            if (indicator) {
                indicator.remove();
            }
        }

        showError(message) {
            this.showMessage('error', message);

            // Визуальный эффект ошибки
            const actionInput = document.getElementById('action-input');
            actionInput.classList.add('error-shake');

            setTimeout(() => {
                actionInput.classList.remove('error-shake');
            }, 500);
        }

        // ========== ОБНОВЛЕНИЕ ИНТЕРФЕЙСА ==========

        updatePlayerInfo(status) {
            // Обновляем здоровье
            if (status.health !== undefined) {
                this.updateHealth(status.health);
            }

            // Обновляем информацию о персонаже
            if (status.character) {
                this.updateCharacterInfo(status);
            }

            // Обновляем инвентарь
            if (status.inventory) {
                this.updateInventory(status.inventory);
            }

            // Обновляем характеристики
            if (status.stats) {
                this.updateStats(status.stats);
            }
        }

        updateHealth(health) {
            const healthElement = document.getElementById('player-health');
            healthElement.textContent = `❤️ ${health}/100`;

            // Визуальная индикация здоровья
            if (health < 30) {
                healthElement.style.color = '#ff4444';
                healthElement.style.animation = 'pulse 1s infinite';
            } else if (health < 60) {
                healthElement.style.color = '#ffaa00';
                healthElement.style.animation = 'none';
            } else {
                healthElement.style.color = '#00ff88';
                healthElement.style.animation = 'none';
            }
        }

        updateCharacterInfo(status) {
            const detailsDiv = document.getElementById('character-details');
            detailsDiv.innerHTML = `
                <div class="character-card">
                    <div class="character-name">
                        <i class="fas fa-user"></i> ${status.character || 'Неизвестный герой'}
                    </div>
                    <div class="character-universe">
                        <i class="fas fa-globe"></i> ${this.getUniverseName(this.currentUniverse)}
                    </div>
                    <div class="character-abilities">
                        <h5><i class="fas fa-star"></i> Способности:</h5>
                        <div class="abilities-list">
                            ${(status.abilities || []).map(ability =>
                                `<span class="ability-tag">${ability}</span>`
                            ).join('')}
                        </div>
                    </div>
                </div>
            `;
        }

        updateInventory(inventory, newItems = []) {
            const itemsDiv = document.getElementById('inventory-items');

            if (!inventory || inventory.length === 0) {
                itemsDiv.innerHTML = '<div class="empty">Инвентарь пуст</div>';
                return;
            }

            itemsDiv.innerHTML = inventory.map((item, index) => {
                const isNew = newItems.includes(item);
                return `
                    <div class="inventory-item ${isNew ? 'new' : ''}" data-item="${item}">
                        <span class="item-name">
                            <i class="fas fa-box"></i> ${item}
                        </span>
                        <span class="item-actions">
                            <button class="item-action-btn" onclick="game.useItem('${item}')" title="Использовать">
                                <i class="fas fa-hand-pointer"></i>
                            </button>
                        </span>
                    </div>
                `;
            }).join('');

            // Убираем анимацию новизны через 3 секунды
            if (newItems.length > 0) {
                setTimeout(() => {
                    document.querySelectorAll('.inventory-item.new').forEach(item => {
                        item.classList.remove('new');
                    });
                }, 3000);
            }
        }

        updateStats(stats) {
            const statsDiv = document.getElementById('stats-list');

            if (!stats || Object.keys(stats).length === 0) {
                statsDiv.innerHTML = '<div class="empty">Характеристики не заданы</div>';
                return;
            }

            statsDiv.innerHTML = Object.entries(stats).map(([name, value]) => {
                const percentage = (value / 20) * 100;
                return `
                    <div class="stat-item">
                        <div class="stat-name">${name}</div>
                        <div class="stat-value">${value}</div>
                        <div class="stat-bar">
                            <div class="stat-bar-fill" style="width: ${percentage}%"></div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        useItem(itemName) {
            // Предлагаем использовать предмет
            const useAction = `использовать ${itemName}`;
            document.getElementById('action-input').value = useAction;
            this.performAction();
        }

        // ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

        getSenderName(type) {
            const names = {
                'system': 'Система',
                'ai': 'Мастер Игры',
                'player': 'Вы',
                'error': 'Ошибка'
            };
            return names[type] || 'Неизвестно';
        }

        getUniverseName(universeId) {
            const names = {
                'fantasy': 'Фэнтези',
                'cyberpunk': 'Киберпанк',
                'space': 'Космоопера',
                'custom': 'Своя вселенная'
            };
            return names[universeId] || 'Неизвестная вселенная';
        }

        updateStatus(text) {
            const statusElement = document.getElementById('game-status-text');
            if (statusElement) {
                statusElement.textContent = text;
            }
        }

        setConnectionStatus(status) {
            this.connectionStatus = status;
            const dot = document.getElementById('connection-dot');
            const text = document.getElementById('connection-text');

            if (dot && text) {
                const statusConfig = {
                    'connected': { class: 'connected', text: 'Online' },
                    'disconnected': { class: 'disconnected', text: 'Offline' },
                    'error': { class: 'error', text: 'Error' }
                };

                const config = statusConfig[status] || statusConfig.disconnected;
                dot.className = 'dot ' + config.class;
                text.textContent = config.text;
            }
        }

        checkConnection() {
            fetch('/health')
                .then(response => {
                    if (response.ok) {
                        this.setConnectionStatus('connected');
                        this.retryCount = 0;
                    } else {
                        this.setConnectionStatus('error');
                    }
                })
                .catch(() => {
                    this.setConnectionStatus('disconnected');
                });
        }

        setupConnectionMonitor() {
            // Проверяем соединение каждые 30 секунд
            setInterval(() => this.checkConnection(), 30000);

            // Отслеживаем online/offline события браузера
            window.addEventListener('online', () => {
                this.setConnectionStatus('connected');
                this.showMessage('system', '📶 Соединение восстановлено');
            });

            window.addEventListener('offline', () => {
                this.setConnectionStatus('disconnected');
                this.showError('📶 Потеряно соединение с интернетом');
            });
        }

        setupActivityTracker() {
            // Сбрасываем таймер неактивности при любом действии пользователя
            const activityEvents = ['mousemove', 'keypress', 'click', 'scroll'];
            let activityTimeout;

            const resetActivityTimer = () => {
                clearTimeout(activityTimeout);
                activityTimeout = setTimeout(() => {
                    if (this.gameStarted) {
                        this.showMessage('system', '💤 Вы давно не активны...');
                    }
                }, 300000); // 5 минут
            };

            activityEvents.forEach(event => {
                window.addEventListener(event, resetActivityTimer);
            });

            resetActivityTimer();
        }

        delay(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }

        copySaveData() {
            const saveTextarea = document.getElementById('save-data');
            saveTextarea.select();
            saveTextarea.setSelectionRange(0, 99999);

            try {
                document.execCommand('copy');
                this.showMessage('system', '📋 Данные сохранения скопированы в буфер обмена!');

                // Визуальная обратная связь
                const copyBtn = document.getElementById('copy-save');
                const originalText = copyBtn.innerHTML;
                copyBtn.innerHTML = '<i class="fas fa-check"></i> Скопировано!';
                copyBtn.classList.add('success');

                setTimeout(() => {
                    copyBtn.innerHTML = originalText;
                    copyBtn.classList.remove('success');
                }, 2000);

            } catch (err) {
                this.showError('Не удалось скопировать данные');
            }
        }

        loadSaveData() {
            this.loadGame();
        }

        handleGameStart(result, characterPrompt) {
            this.gameStarted = true;
            this.showGameInterface();

            // Показываем начальную историю с анимацией
            if (result.story) {
                this.showAnimatedMessage('ai', result.story);
            }

            // Обновляем информацию о персонаже
            if (result.character) {
                this.updatePlayerInfo(result);
            }

            // Сохраняем промпт персонажа
            if (characterPrompt) {
                document.getElementById('character-input').value = characterPrompt;
            }

            this.showMessage('system', '🎮 Игра началась! Вводите действия в поле ниже.');
        }

        // ========== ПУБЛИЧНЫЕ МЕТОДЫ ==========

        getGameState() {
            return {
                userId: this.userId,
                universe: this.currentUniverse,
                gameStarted: this.gameStarted,
                connectionStatus: this.connectionStatus
            };
        }

        resetGame() {
            this.userId = null;
            this.currentUniverse = null;
            this.gameStarted = false;
            this.isProcessing = false;

            // Очищаем историю
            document.getElementById('game-story').innerHTML = '';

            // Сбрасываем UI
            this.showWelcomeMessage();
            this.updateStatus('Готов к игре');

            // Скрываем игровые панели
            document.getElementById('character-creator').classList.add('hidden');
            document.getElementById('universe-selector').classList.add('hidden');
            document.getElementById('character-info').classList.add('hidden');
            document.getElementById('inventory-panel').classList.add('hidden');
            document.getElementById('stats-panel').classList.add('hidden');

            this.showMessage('system', '🔄 Игра сброшена. Начните новую игру.');
        }
    }

    // Создаем глобальный экземпляр игры
    window.game = new RoleVerseGame();

    // Экспортируем для использования в консоли
    console.log('RoleVerse Game loaded. Type "game" in console to access game instance.');
});

// Добавляем CSS анимации динамически
const style = document.createElement('style');
style.textContent = `
    .error-shake {
        animation: shake 0.5s ease-in-out;
    }

    @keyframes shake {
        0%, 100% { transform: translateX(0); }
        10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
        20%, 40%, 60%, 80% { transform: translateX(5px); }
    }

    @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.7; }
    }

    .success {
        background-color: #00ff88 !important;
        color: #000 !important;
    }

    .typing-message {
        border-left: 4px solid #00d4ff;
    }

    .typing-content {
        min-height: 1.2em;
        line-height: 1.6;
    }

    .typing-controls {
        margin-top: 10px;
        text-align: right;
    }

    .skip-btn {
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 4px;
        color: #aaa;
        padding: 4px 8px;
        font-size: 0.85rem;
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .skip-btn:hover {
        background: rgba(255, 255, 255, 0.2);
        color: #fff;
    }

    .typing-indicator {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 15px;
        background: rgba(255, 255, 255, 0.05);
        border-radius: 10px;
        margin: 10px 0;
        animation: slideIn 0.3s ease;
    }

    .typing-avatar {
        width: 30px;
        height: 30px;
        border-radius: 50%;
        background: rgba(0, 212, 255, 0.2);
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .typing-avatar i {
        color: #00d4ff;
    }

    .typing-content {
        flex: 1;
    }

    .typing-dots {
        display: flex;
        gap: 4px;
        margin-bottom: 4px;
    }

    .typing-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #00d4ff;
        animation: typingBounce 1.4s infinite ease-in-out;
    }

    .typing-dot:nth-child(1) { animation-delay: -0.32s; }
    .typing-dot:nth-child(2) { animation-delay: -0.16s; }

    .typing-text {
        font-size: 0.9rem;
        color: #aaa;
    }

    .welcome-actions {
        display: flex;
        gap: 10px;
        margin: 20px 0;
    }

    .game-features {
        margin-top: 30px;
        padding: 20px;
        background: rgba(255, 255, 255, 0.05);
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .game-features h4 {
        margin-bottom: 15px;
        color: #00d4ff;
    }

    .game-features ul {
        list-style: none;
        padding: 0;
    }

    .game-features li {
        padding: 8px 0;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .game-features li:last-child {
        border-bottom: none;
    }

    .game-features li i {
        color: #00ff88;
        width: 20px;
    }

    .character-card {
        padding: 15px;
        background: rgba(255, 255, 255, 0.05);
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .character-name {
        font-size: 1.2rem;
        font-weight: bold;
        margin-bottom: 10px;
        color: #00ff88;
    }

    .character-universe {
        color: #aaa;
        margin-bottom: 15px;
        font-size: 0.9rem;
    }

    .abilities-list {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
    }

    .ability-tag {
        padding: 4px 8px;
        background: rgba(0, 212, 255, 0.2);
        border-radius: 4px;
        font-size: 0.8rem;
        color: #00d4ff;
    }

    .stat-bar {
        height: 4px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 2px;
        margin-top: 5px;
        overflow: hidden;
    }

    .stat-bar-fill {
        height: 100%;
        background: linear-gradient(90deg, #00d4ff, #0088ff);
        border-radius: 2px;
        transition: width 0.5s ease;
    }

    .item-action-btn {
        background: rgba(255, 255, 255, 0.1);
        border: none;
        border-radius: 4px;
        color: #aaa;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .item-action-btn:hover {
        background: rgba(255, 255, 255, 0.2);
        color: #fff;
    }

    .message-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
        font-size: 0.85rem;
        color: #aaa;
    }

    .message-sender {
        font-weight: bold;
        color: #fff;
    }

    .message-time {
        margin-left: auto;
        opacity: 0.7;
    }
`;
document.head.appendChild(style);