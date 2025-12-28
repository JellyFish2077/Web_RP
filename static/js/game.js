// game.js - ПОЛНЫЙ КОД С АНИМАЦИЕЙ ПЕЧАТИ

class RoleVerseGame {
    constructor() {
        this.userId = null;
        this.gameState = 'universe_select';
        this.currentUniverse = null;
        this.isTyping = false;
        this.currentAnimation = null;

        this.init();
    }

    async init() {
        this.elements = {
            backToMenu: document.getElementById('back-to-menu'),
            saveGameBtn: document.getElementById('save-game-btn'),
            actionInput: document.getElementById('action-input'),
            sendAction: document.getElementById('send-action'),
            universeSelector: document.getElementById('universe-selector'),
            characterCreator: document.getElementById('character-creator'),
            characterInfo: document.getElementById('character-info'),
            inventoryPanel: document.getElementById('inventory-panel'),
            statsPanel: document.getElementById('stats-panel'),
            characterInput: document.getElementById('character-input'),
            createCharacter: document.getElementById('create-character'),
            gameStory: document.getElementById('game-story'),
            inventoryItems: document.getElementById('inventory-items'),
            statsList: document.getElementById('stats-list'),
            characterDetails: document.getElementById('character-details'),
            playerHealth: document.getElementById('player-health'),
            universeOptions: document.querySelectorAll('.universe-option'),
            customUniverse: document.getElementById('custom-universe'),
            customRules: document.getElementById('custom-rules'),
            quickBtns: document.querySelectorAll('.quick-btn'),
            tabBtns: document.querySelectorAll('.tab-btn'),
            connectionDot: document.getElementById('connection-dot'),
            connectionText: document.getElementById('connection-text'),
            gameStatusText: document.getElementById('game-status-text'),
            saveModal: document.getElementById('save-modal'),
            loadModal: document.getElementById('load-modal'),
            saveData: document.getElementById('save-data'),
            loadData: document.getElementById('load-data'),
            copySave: document.getElementById('copy-save'),
            loadSave: document.getElementById('load-save'),
            closeModals: document.querySelectorAll('.close-modal')
        };

        this.setupEventListeners();
        await this.startNewGame();
    }

    setupEventListeners() {
        this.elements.backToMenu.addEventListener('click', () => {
            if (confirm('Вернуться в главное меню? Несохраненный прогресс будет потерян.')) {
                window.location.href = '/';
            }
        });

        this.elements.saveGameBtn.addEventListener('click', () => this.saveGame());
        this.elements.sendAction.addEventListener('click', () => this.performAction());

        this.elements.actionInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.performAction();
            }
        });

        this.elements.quickBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.getAttribute('data-action');
                this.elements.actionInput.value = action;
                this.performAction();
            });
        });

        this.elements.universeOptions.forEach(option => {
            option.addEventListener('click', () => {
                this.elements.universeOptions.forEach(opt => {
                    opt.classList.remove('selected');
                });

                option.classList.add('selected');
                const universeId = option.getAttribute('data-universe');
                this.currentUniverse = universeId;

                if (universeId === 'custom') {
                    this.elements.customUniverse.classList.remove('hidden');
                    this.showMessage('system', '🎨 Вы выбрали создание своей вселенной. Опишите правила мира в поле ниже, затем нажмите "Создать вселенную".', true);
                } else {
                    this.elements.customUniverse.classList.add('hidden');
                    setTimeout(() => {
                        this.chooseUniverse(universeId);
                    }, 300);
                }
            });
        });

        this.elements.createCharacter.addEventListener('click', () => this.createCharacter());
        this.elements.characterInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.createCharacter();
            }
        });

        this.elements.tabBtns.forEach(btn => {
            btn.addEventListener('click', () => this.switchTab(btn));
        });

        this.elements.closeModals.forEach(btn => {
            btn.addEventListener('click', () => {
                this.elements.saveModal.classList.add('hidden');
                this.elements.loadModal.classList.add('hidden');
            });
        });

        this.elements.copySave.addEventListener('click', () => this.copySaveData());
        this.elements.loadSave.addEventListener('click', () => this.loadGame());

        const confirmCustomBtn = document.getElementById('confirm-custom-btn');
        if (confirmCustomBtn) {
            confirmCustomBtn.addEventListener('click', () => this.createCustomUniverse());
        }

        const cancelBtn = document.getElementById('cancel-custom-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                this.elements.customUniverse.classList.add('hidden');
                this.elements.universeOptions.forEach(opt => opt.classList.remove('selected'));
                this.currentUniverse = null;
                this.showMessage('system', 'Создание вселенной отменено. Выберите другую вселенную.', true);
            });
        }

        this.addSkipAnimationButton();
    }

    addSkipAnimationButton() {
        const skipBtn = document.createElement('button');
        skipBtn.id = 'skip-animation';
        skipBtn.className = 'btn btn-secondary skip-btn';
        skipBtn.innerHTML = '⏩ Пропустить анимацию';
        skipBtn.style.cssText = `
            position: absolute;
            right: 10px;
            bottom: 10px;
            z-index: 100;
            opacity: 0.7;
            transition: opacity 0.3s;
        `;

        skipBtn.addEventListener('mouseenter', () => {
            skipBtn.style.opacity = '1';
        });

        skipBtn.addEventListener('mouseleave', () => {
            skipBtn.style.opacity = '0.7';
        });

        skipBtn.addEventListener('click', () => {
            this.skipCurrentAnimation();
        });

        const storyContainer = this.elements.gameStory.parentElement;
        storyContainer.style.position = 'relative';
        storyContainer.appendChild(skipBtn);
    }

    skipCurrentAnimation() {
        if (this.currentAnimation) {
            clearTimeout(this.currentAnimation);
            this.currentAnimation = null;
        }

        const typingElements = document.querySelectorAll('.typing');
        typingElements.forEach(el => {
            const fullText = el.dataset.fullText;
            if (fullText) {
                el.innerHTML = this.formatText(fullText);
                el.classList.remove('typing');
                el.classList.add('completed');
            }
        });

        this.isTyping = false;
    }

    async startNewGame() {
        try {
            this.showLoading('Запускаем новую игру...');

            const response = await fetch('/api/start-game', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });

            const data = await response.json();

            if (data.user_id) {
                this.userId = data.user_id;
                this.showMessage('system', '🎮 **Новая игра создана!** Выберите вселенную для своего приключения.', true);
                this.gameState = 'universe_select';
                this.updateUI();
            } else {
                throw new Error('Не удалось создать игру');
            }
        } catch (error) {
            console.error('Ошибка при старте игры:', error);
            this.userId = `user_${Date.now()}`;
            this.showMessage('system', '🎮 **Новая игра создана!** Выберите вселенную для своего приключения.', true);
            this.gameState = 'universe_select';
            this.updateUI();
            this.showMessage('error', '⚠️ Сервер временно недоступен. Игра запущена в локальном режиме.', true);
        } finally {
            this.hideLoading();
        }
    }

    async chooseUniverse(universeId) {
        try {
            this.showLoading('Загружаем вселенную...');

            const response = await fetch('/api/choose-universe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: this.userId,
                    universe_id: universeId
                })
            });

            const result = await response.json();

            if (result.success && result.need_character) {
                this.showMessage('system', '🌌 **Вселенная выбрана!** Теперь опишите своего персонажа (например: "молодой маг", "кибер-хакер", "космический пират").', true);
                this.gameState = 'character_create';
                this.updateUI();
            } else {
                await this.createTestCharacter(universeId);
            }
        } catch (error) {
            console.error('Ошибка при выборе вселенной:', error);
            await this.createTestCharacter(universeId);
        } finally {
            this.hideLoading();
        }
    }

    async createCustomUniverse() {
        const customRules = this.elements.customRules.value.trim();

        if (!customRules) {
            this.showMessage('error', '❌ **Ошибка:** Пожалуйста, опишите правила вашей вселенной.', true);
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
                this.showMessage('system', '🌌 **Ваша вселенная создана!** Теперь опишите персонажа для этого мира.', true);
                this.gameState = 'character_create';
                this.updateUI();
            } else {
                await this.createTestCharacter('custom');
            }
        } catch (error) {
            console.error('Ошибка при создании кастомной вселенной:', error);
            await this.createTestCharacter('custom');
        } finally {
            this.hideLoading();
        }
    }

    async createCharacter() {
        const characterPrompt = this.elements.characterInput.value.trim();

        if (!characterPrompt) {
            this.showMessage('error', '❌ **Ошибка:** Пожалуйста, опишите своего персонажа (например: "молодой маг", "кибер-хакер").', true);
            return;
        }

        if (!this.currentUniverse) {
            this.showMessage('error', '❌ **Ошибка:** Сначала выберите вселенную!', true);
            return;
        }

        this.showMessage('player', `🎭 **Я хочу играть за:** ${characterPrompt}`, true);

        try {
            this.showLoading('✨ Создаю мир и персонажа...');

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
                this.showMessage('ai', data.story, false);
                this.updateCharacterInfo(data);
                this.gameState = 'playing';
                this.updateUI();

                setTimeout(() => {
                    this.showMessage('system', '💡 **Совет:** Начинайте с простых действий, например: "осмотреть комнату", "проверить инвентарь", "идти на север"', true);
                }, 2000);

            } else {
                await this.createTestCharacter(this.currentUniverse);
            }
        } catch (error) {
            console.error('Ошибка при создании персонажа:', error);
            await this.createTestCharacter(this.currentUniverse);
        } finally {
            this.hideLoading();
        }
    }

    async createTestCharacter(universeId) {
        const characterPrompt = this.elements.characterInput.value || "храбрый искатель приключений";

        const stories = {
            "fantasy": `## 🐉 Фэнтези Мир\n\nВы - **${characterPrompt}**. Стоите у входа в древние подземелья **Драконьего Пика**. \n\n*Легенды говорят*, что в самой глубине этих катакомб хранится **Потерянный Артефакт Древних** - магический кристалл, способный исполнить любое желание.\n\nСтраж у входа, старый гном по имени **Торрин**, кивает вам: \n- "Много смельчаков вошло туда, неменные вернулись... Удачи, ${characterPrompt}."\n\n**Что будете делать?**`,

            "cyberpunk": `## 🤖 Киберпанк Мир\n\nВы - **${characterPrompt}**. Неоновые огни мегаполиса **"Новая Токио-3"** отражаются в лужах кислотного дождя.\n\nВаш нейро-коммуникатор вибрирует. *Новое сообщение*:\n\n> **От:** Анонимный Работодатель\n> **Тема:** Контракт #X7B-229\n> **Награда:** 50,000 крипто-кредитов\n> **Задание:** Проникнуть в серверную корпорации **"КиберТек"** и скачать чертежи нового импланта.\n> **Риск:** Максимальный. Системы безопасности уровня "Альфа".\n\n**Принимаете контракт?**`,

            "space": `## 🚀 Космический Мир\n\nВы - **${characterPrompt}**. Корабль **"Звездный Странник"** выходит из гиперпространства над планетой **Ксенон-7**.\n\n*Сканеры показывают:*\n- Атмосфера: пригодна для дыхания\n- Температура: +22°C\n- Аномалии: **неизвестные энергетические сигнатуры**\n- Жизнь: признаки разумной цивилизации\n\nКапитан **Алекс Рейдерс** отдает приказ через комсвязь:\n- "Экипаж, готовьтесь к посадке. Миссия: исследовать и установить контакт."\n\n**Ваши действия?**`,

            "custom": `## 🎨 Ваша Вселенная\n\nВы - **${characterPrompt}**. Стоите на пороге мира, который сами создали. Воздух пахнет возможностями, каждый камень хранит историю, которую вы еще не написали.\n\n*Это ваш мир. Ваши правила. Ваше приключение.*\n\n**С чего начнете?**`
        };

        const story = stories[universeId] || stories.fantasy;

        const characterData = {
            success: true,
            game_started: true,
            story: `${story}\n\n**🎭 Ваш персонаж:** ${characterPrompt}\n**❤️ Здоровье:** 100/100\n**🎒 Стартовый инвентарь:** факел, нож, фляга с водой`,
            inventory: ["факел", "нож", "фляга с водой", "карта местности"],
            stats: {"💪 Сила": 8, "🏃 Ловкость": 7, "🧠 Интеллект": 6, "👁️ Мудрость": 5, "💬 Харизма": 4},
            abilities: ["Выживание", "Наблюдение", "Базовый бой"],
            health: 100
        };

        this.showMessage('ai', story, false);
        this.updateCharacterInfo(characterData);
        this.gameState = 'playing';
        this.updateUI();

        setTimeout(() => {
            this.showMessage('system', '💡 **Совет:** Попробуйте "осмотреть окрестности" чтобы узнать больше о локации', true);
        }, 1500);
    }

    async performAction() {
        const action = this.elements.actionInput.value.trim();

        if (!action) {
            this.showMessage('error', '❌ **Ошибка:** Пожалуйста, введите действие.', true);
            return;
        }

        if (this.gameState !== 'playing') {
            this.showMessage('error', '❌ **Ошибка:** Сначала создайте персонажа.', true);
            return;
        }

        this.showMessage('player', `🎯 **Действие:** ${action}`, true);
        this.elements.actionInput.value = '';

        try {
            this.showLoading('🤔 Думаю над результатом...');

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
                this.showMessage('ai', data.action_result, false);

                if (data.new_items && data.new_items.length > 0) {
                    this.showMessage('system', `🎁 **Получены предметы:** ${data.new_items.join(', ')}`, true);
                }

                this.updateStatus();

            } else {
                this.showMessage('error', data.message || 'Не удалось выполнить действие.', true);
            }
        } catch (error) {
            console.error('Ошибка при выполнении действия:', error);

            const responses = [
                `## 📖 Результат\n\nВаше действие **"${action}"** было успешным! Мир реагирует на ваши поступки, открывая новые возможности для исследования.\n\n*Что будете делать дальше?*`,
                `## 📖 Результат\n\n**"${action}"** - интересный выбор! История развивается неожиданным образом. Персонажи вокруг вас реагируют на ваше решение.\n\n*Продолжайте исследовать мир!*`,
                `## 📖 Результат\n\nВы совершили **"${action}"**. Это действие меняет ход событий и открывает новые пути. Мир вокруг вас живет своей жизнью.\n\n*Куда направитесь теперь?*`
            ];

            this.showMessage('ai', responses[Math.floor(Math.random() * responses.length)], false);
        } finally {
            this.hideLoading();
        }
    }

    showMessage(type, text, instant = false) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;

        const timestamp = new Date().toLocaleTimeString();

        const messageContent = document.createElement('div');
        messageContent.className = 'message-content';

        const messageMeta = document.createElement('div');
        messageMeta.className = 'message-meta';
        messageMeta.innerHTML = `
            <span>${this.getMessageTypeLabel(type)}</span>
            <span>${timestamp}</span>
        `;

        messageDiv.appendChild(messageContent);
        messageDiv.appendChild(messageMeta);
        this.elements.gameStory.appendChild(messageDiv);
        this.elements.gameStory.scrollTop = this.elements.gameStory.scrollHeight;

        if (instant || type === 'player' || type === 'system' || type === 'error') {
            messageContent.innerHTML = this.formatText(text);
            return;
        }

        this.typeWriterEffect(messageContent, text);
    }

    typeWriterEffect(element, text, speed = 30) {
        if (this.isTyping) {
            this.skipCurrentAnimation();
        }

        this.isTyping = true;
        element.classList.add('typing');
        element.dataset.fullText = text;

        const paragraphs = this.splitIntoParagraphs(text);
        let currentParagraph = 0;
        let currentChar = 0;

        element.innerHTML = '';

        const typeNext = () => {
            if (!this.isTyping) return;

            if (currentParagraph >= paragraphs.length) {
                element.classList.remove('typing');
                element.classList.add('completed');
                this.isTyping = false;
                this.currentAnimation = null;
                return;
            }

            if (currentChar === 0) {
                const p = document.createElement('div');
                p.className = 'typing-paragraph';
                element.appendChild(p);
            }

            const currentP = element.lastChild;
            const currentText = paragraphs[currentParagraph];

            if (currentChar < currentText.length) {
                currentP.innerHTML = this.formatText(
                    currentText.substring(0, currentChar + 1)
                );
                currentChar++;

                this.elements.gameStory.scrollTop = this.elements.gameStory.scrollHeight;

                const randomSpeed = speed + Math.random() * 15 - 5;
                this.currentAnimation = setTimeout(typeNext, randomSpeed);
            } else {
                currentParagraph++;
                currentChar = 0;

                if (currentParagraph < paragraphs.length) {
                    this.currentAnimation = setTimeout(typeNext, 200);
                } else {
                    element.classList.remove('typing');
                    element.classList.add('completed');
                    this.isTyping = false;
                    this.currentAnimation = null;
                }
            }
        };

        typeNext();
    }

    splitIntoParagraphs(text) {
        const sentences = text
            .replace(/\n+/g, '\n')
            .replace(/\.\s+/g, '.\n')
            .replace(/!\s+/g, '!\n')
            .replace(/\?\s+/g, '?\n')
            .split('\n')
            .filter(s => s.trim().length > 0);

        const paragraphs = [];
        let currentParagraph = '';
        let sentenceCount = 0;

        for (const sentence of sentences) {
            const trimmedSentence = sentence.trim();

            if (currentParagraph.length + trimmedSentence.length < 120 || sentenceCount < 2) {
                currentParagraph = currentParagraph ? currentParagraph + ' ' + trimmedSentence : trimmedSentence;
                sentenceCount++;
            } else {
                if (currentParagraph) paragraphs.push(currentParagraph);
                currentParagraph = trimmedSentence;
                sentenceCount = 1;
            }
        }

        if (currentParagraph) paragraphs.push(currentParagraph);
        return paragraphs;
    }

    formatText(text) {
        let formatted = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        formatted = formatted
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/__(.*?)__/g, '<u>$1</u>')
            .replace(/~~(.*?)~~/g, '<s>$1</s>')
            .replace(/`(.*?)`/g, '<code>$1</code>')
            .replace(/^-\s+(.*)$/gm, '<li>$1</li>')
            .replace(/^\d+\.\s+(.*)$/gm, '<li>$1</li>')
            .replace(/\n/g, '<br>');

        return formatted;
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

    updateCharacterInfo(data) {
        this.updateInventory(data.inventory || []);
        this.updateStats(data.stats || {});
        this.elements.playerHealth.textContent = `❤️ ${data.health || 100}/100`;
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
            `;
            this.elements.inventoryItems.appendChild(itemElement);
        });
    }

    updateStats(stats) {
        this.elements.statsList.innerHTML = '';

        if (!stats) {
            stats = {"💪 Сила": 8, "🏃 Ловкость": 7, "🧠 Интеллект": 6, "👁️ Мудрость": 5, "💬 Харизма": 4};
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

    async updateStatus() {
        try {
            const response = await fetch('/api/get-status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: this.userId })
            });

            const data = await response.json();
            this.elements.playerHealth.textContent = `❤️ ${data.health}/100`;
            this.updateInventory(data.inventory);
            this.updateStats(data.stats);
        } catch (error) {
            console.error('Ошибка при обновлении статуса:', error);
        }
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
            this.showMessage('error', '❌ Не удалось сохранить игру.', true);
        }
    }

    async loadGame() {
        const saveDataText = this.elements.loadData.value.trim();

        if (!saveDataText) {
            this.showMessage('error', '❌ Пожалуйста, введите данные сохранения.', true);
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
                this.showMessage('system', '✅ Игра загружена успешно!', true);
                this.updateCharacterInfo(data.game_data);
                this.gameState = 'playing';
                this.updateUI();
                this.elements.loadModal.classList.add('hidden');
            }
        } catch (error) {
            console.error('Ошибка при загрузке игры:', error);
            this.showMessage('error', '❌ Неверные данные сохранения.', true);
        }
    }

    copySaveData() {
        this.elements.saveData.select();
        document.execCommand('copy');
        this.showMessage('system', '📋 Данные сохранения скопированы!', true);
    }

    switchTab(btn) {
        this.elements.tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const tab = btn.getAttribute('data-tab');
        this.elements.characterInfo.classList.add('hidden');
        this.elements.inventoryPanel.classList.add('hidden');
        this.elements.statsPanel.classList.add('hidden');

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
        }
    }

    updateUI() {
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

    showLoading(message) {
        this.elements.gameStatusText.textContent = message;
        this.elements.sendAction.disabled = true;
        this.elements.actionInput.disabled = true;
        if (this.elements.createCharacter) this.elements.createCharacter.disabled = true;

        this.showTypingIndicator();
    }

    hideLoading() {
        this.elements.gameStatusText.textContent = this.getGameStatusText();
        this.elements.sendAction.disabled = false;
        this.elements.actionInput.disabled = false;
        if (this.elements.createCharacter) this.elements.createCharacter.disabled = false;

        this.hideTypingIndicator();
    }

    showTypingIndicator() {
        this.hideTypingIndicator();

        const indicator = document.createElement('div');
        indicator.id = 'typing-indicator';
        indicator.className = 'typing-indicator';
        indicator.innerHTML = `
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
        `;

        this.elements.gameStory.appendChild(indicator);
        this.elements.gameStory.scrollTop = this.elements.gameStory.scrollHeight;
    }

    hideTypingIndicator() {
        const indicator = document.getElementById('typing-indicator');
        if (indicator) indicator.remove();
    }

    getGameStatusText() {
        switch (this.gameState) {
            case 'universe_select': return 'Выберите вселенную';
            case 'character_create': return 'Создайте персонажа';
            case 'playing': return 'Игра идет';
            default: return 'Готов к игре';
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.game = new RoleVerseGame();
});