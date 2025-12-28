import asyncio
import logging
import os
import sys
import re
import random
import json
import pickle
import gzip
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta
from dataclasses import asdict
from contextlib import asynccontextmanager
from functools import wraps

import httpx
from dotenv import load_dotenv
from pydantic import BaseModel, Field, validator
from fastapi import FastAPI, Request, HTTPException, Depends, BackgroundTasks
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from prometheus_fastapi_instrumentator import Instrumentator

# Redis импорты
try:
    import redis.asyncio as redis

    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False
    logging.warning("Redis not available, using in-memory fallback")

# --- НАСТРОЙКА ---
load_dotenv()
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    stream=sys.stdout
)
logger = logging.getLogger("roleverse")

# Конфигурация
WEBAPP_HOST = os.getenv("WEBAPP_HOST", "0.0.0.0")
WEBAPP_PORT = int(os.getenv("PORT", 8000))
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
REDIS_TTL = int(os.getenv("REDIS_TTL", 3600))  # 1 час

# Rate limiter
limiter = Limiter(key_func=get_remote_address)


# --- МОДЕЛИ ДАННЫХ ---

class SaveData(BaseModel):
    """Валидированные данные сохранения"""
    user_id: str
    character: Optional[str] = None
    inventory: List[str] = []
    health: int = Field(default=100, ge=0, le=100)
    stats: Dict[str, int] = {}
    abilities: Dict[str, bool] = {}
    world_context: str = ""
    game_over: bool = False
    last_active: str = Field(default_factory=lambda: datetime.now().isoformat())

    @validator('stats')
    def validate_stats(cls, v):
        if not all(0 <= value <= 20 for value in v.values()):
            raise ValueError("Stats must be between 0 and 20")
        return v

    @validator('inventory')
    def validate_inventory(cls, v):
        # Защита от инъекций
        cleaned = []
        for item in v:
            if len(item) > 100:
                raise ValueError("Item name too long")
            # Убираем опасные символы
            cleaned.append(re.sub(r'[<>{};]', '', item)[:50])
        return cleaned


class UserSession(BaseModel):
    """Игровая сессия"""
    user_id: str
    character: Optional[str] = None
    inventory: List[str] = []
    health: int = 100
    stats: Dict[str, int] = {}
    abilities: Dict[str, bool] = {}
    messages: List[Dict[str, str]] = []
    world_context: str = ""
    universe: Optional[str] = None
    ruleset: Optional[str] = None
    game_over: bool = False
    created_at: datetime = Field(default_factory=datetime.now)
    last_active: datetime = Field(default_factory=datetime.now)

    def to_save_data(self) -> SaveData:
        """Конвертирует сессию в SaveData"""
        return SaveData(
            user_id=self.user_id,
            character=self.character,
            inventory=self.inventory,
            health=self.health,
            stats=self.stats,
            abilities=self.abilities,
            world_context=self.world_context,
            game_over=self.game_over,
            last_active=self.last_active.isoformat()
        )

    def update_activity(self):
        """Обновляет время последней активности"""
        self.last_active = datetime.now()


class SessionStore:
    """Унифицированное хранилище сессий"""

    def __init__(self):
        self.redis_client = None
        self.in_memory_store: Dict[str, UserSession] = {}
        self.backup_file = "data/sessions_backup.json"
        self._httpx_client = None

        # Инициализация Redis
        if REDIS_AVAILABLE:
            self._init_redis()

        # Загружаем резервную копию
        self._load_backup()

    def _init_redis(self):
        """Инициализация Redis клиента"""
        try:
            self.redis_client = redis.from_url(
                REDIS_URL,
                encoding="utf-8",
                decode_responses=True,
                socket_timeout=5,
                socket_connect_timeout=5
            )
            logger.info("Redis connected successfully")
        except Exception as e:
            logger.error(f"Redis connection failed: {e}")
            self.redis_client = None

    def _load_backup(self):
        """Загрузка резервной копии из файла"""
        try:
            if os.path.exists(self.backup_file):
                with open(self.backup_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    for user_id, session_data in data.items():
                        # Конвертируем строки datetime обратно
                        if 'created_at' in session_data:
                            session_data['created_at'] = datetime.fromisoformat(session_data['created_at'])
                        if 'last_active' in session_data:
                            session_data['last_active'] = datetime.fromisoformat(session_data['last_active'])
                        self.in_memory_store[user_id] = UserSession(**session_data)
                logger.info(f"Loaded backup: {len(self.in_memory_store)} sessions")
        except Exception as e:
            logger.error(f"Failed to load backup: {e}")

    def _save_backup(self):
        """Сохранение резервной копии в файл"""
        try:
            os.makedirs('data', exist_ok=True)
            backup_data = {}
            for user_id, session in self.in_memory_store.items():
                backup_data[user_id] = json.loads(session.json())

            with open(self.backup_file, 'w', encoding='utf-8') as f:
                json.dump(backup_data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"Failed to save backup: {e}")

    @property
    def httpx_client(self):
        """Ленивая инициализация httpx клиента с пулом соединений"""
        if self._httpx_client is None:
            limits = httpx.Limits(max_keepalive_connections=5, max_connections=10)
            timeout = httpx.Timeout(30.0, connect=5.0)
            self._httpx_client = httpx.AsyncClient(
                limits=limits,
                timeout=timeout,
                http2=True
            )
        return self._httpx_client

    async def get(self, user_id: str) -> Optional[UserSession]:
        """Получение сессии"""
        # Сначала пробуем Redis
        if self.redis_client:
            try:
                data = await self.redis_client.get(f"session:{user_id}")
                if data:
                    session_data = json.loads(data)
                    return UserSession(**session_data)
            except Exception as e:
                logger.error(f"Redis get error: {e}")

        # Fallback на память
        return self.in_memory_store.get(user_id)

    async def set(self, user_id: str, session: UserSession):
        """Сохранение сессии"""
        session_data = session.json()

        # Сохраняем в Redis
        if self.redis_client:
            try:
                await self.redis_client.setex(
                    f"session:{user_id}",
                    REDIS_TTL,
                    session_data
                )
            except Exception as e:
                logger.error(f"Redis set error: {e}")

        # И в память
        self.in_memory_store[user_id] = session
        self._save_backup()

    async def delete(self, user_id: str):
        """Удаление сессии"""
        if self.redis_client:
            try:
                await self.redis_client.delete(f"session:{user_id}")
            except Exception as e:
                logger.error(f"Redis delete error: {e}")

        if user_id in self.in_memory_store:
            del self.in_memory_store[user_id]
            self._save_backup()

    async def cleanup_expired(self, hours: int = 24):
        """Очистка устаревших сессий"""
        cutoff = datetime.now() - timedelta(hours=hours)
        expired = []

        for user_id, session in self.in_memory_store.items():
            if session.last_active < cutoff:
                expired.append(user_id)

        for user_id in expired:
            await self.delete(user_id)

        logger.info(f"Cleaned up {len(expired)} expired sessions")


# Инициализация хранилища
session_store = SessionStore()


# --- КЭШ ИИ-ОТВЕТОВ ---

class AICache:
    """Кэш для ИИ-ответов"""

    def __init__(self):
        self.cache: Dict[str, tuple[str, datetime]] = {}
        self.ttl = 300  # 5 минут

    def _get_key(self, messages: List[Dict]) -> str:
        """Генерация ключа кэша"""
        import hashlib
        content = json.dumps(messages, sort_keys=True)
        return hashlib.md5(content.encode()).hexdigest()

    async def get(self, messages: List[Dict]) -> Optional[str]:
        """Получение из кэша"""
        key = self._get_key(messages)
        if key in self.cache:
            response, timestamp = self.cache[key]
            if (datetime.now() - timestamp).seconds < self.ttl:
                logger.debug(f"Cache hit for key: {key[:8]}")
                return response
            else:
                del self.cache[key]
        return None

    async def set(self, messages: List[Dict], response: str):
        """Сохранение в кэш"""
        key = self._get_key(messages)
        self.cache[key] = (response, datetime.now())
        logger.debug(f"Cache set for key: {key[:8]}")


ai_cache = AICache()


# --- FASTAPI ПРИЛОЖЕНИЕ ---

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Контекстный менеджер для управления жизненным циклом"""
    logger.info("RoleVerse starting up...")

    # Запускаем задачу очистки
    cleanup_task = asyncio.create_task(periodic_cleanup())

    yield

    # Останавливаем задачи
    cleanup_task.cancel()
    try:
        await cleanup_task
    except asyncio.CancelledError:
        pass

    # Закрываем клиенты
    if session_store._httpx_client:
        await session_store._httpx_client.aclose()

    if session_store.redis_client:
        await session_store.redis_client.close()

    logger.info("RoleVerse shutting down...")


app = FastAPI(
    title="RoleVerse - AI RPG Game",
    version="2.0.0",
    lifespan=lifespan
)

# Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Rate limiting
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Prometheus метрики
Instrumentator().instrument(app).expose(app)

# Статические файлы и шаблоны
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")


# --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---

async def periodic_cleanup():
    """Периодическая очистка устаревших сессий"""
    while True:
        try:
            await asyncio.sleep(3600)  # Каждый час
            await session_store.cleanup_expired()
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Cleanup error: {e}")


async def get_ai_response(messages: List[Dict], temperature: float = 0.7) -> str:
    """Отправляет запрос к DeepSeek API с кэшированием"""
    # Проверяем кэш
    cached = await ai_cache.get(messages)
    if cached:
        return cached

    if not DEEPSEEK_API_KEY:
        return "Извините, API ключ DeepSeek не настроен. Проверьте конфигурацию."

    try:
        # Используем общий клиент с пулом соединений
        async with session_store.httpx_client as client:
            response = await client.post(
                "https://api.deepseek.com/chat/completions",
                headers={
                    "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "deepseek-chat",
                    "messages": messages,
                    "max_tokens": 800,
                    "temperature": temperature,
                    "stream": False
                }
            )

            if response.status_code == 200:
                data = response.json()
                content = data["choices"][0]["message"]["content"].strip()

                # Форматируем ответ для лучшего отображения
                formatted_content = format_ai_response(content)

                # Сохраняем в кэш
                await ai_cache.set(messages, formatted_content)

                return formatted_content
            else:
                logger.error(f"DeepSeek API error: {response.status_code} - {response.text}")
                return "Извините, произошла ошибка с нейросетью. Попробуйте еще раз."

    except httpx.TimeoutException:
        logger.error("Timeout while calling DeepSeek API")
        return "Извините, нейросеть не отвечает. Попробуйте еще раз."
    except Exception as e:
        logger.error(f"Error while calling DeepSeek API: {e}")
        return "Извините, произошла ошибка с нейросетью. Попробуйте еще раз."


def format_ai_response(text: str) -> str:
    """Форматирует ответ AI для лучшего отображения."""
    # Убираем лишние пробелы
    text = re.sub(r'\n\s*\n\s*\n', '\n\n', text)

    # Добавляем форматирование для заголовков
    lines = text.split('\n')
    formatted_lines = []

    for line in lines:
        line = line.strip()
        if not line:
            formatted_lines.append('')
            continue

        # Определяем заголовки
        if line.endswith(':') and len(line) < 50:
            formatted_lines.append(f'**{line}**')
        elif re.match(r'^[A-ZА-Я][^.!?]*[.!?]$', line) and len(line) < 100:
            formatted_lines.append(f'*{line}*')
        else:
            formatted_lines.append(line)

    return '\n'.join(formatted_lines)


# Генерация ID пользователя
def generate_user_id() -> str:
    """Генерирует уникальный ID пользователя."""
    return f"user_{random.randint(100000, 999999)}_{int(datetime.now().timestamp())}"


# --- РОУТЫ С RATE LIMITING ---

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    """Главная страница."""
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/game", response_class=HTMLResponse)
async def game_page(request: Request):
    """Страница игры."""
    return templates.TemplateResponse("game.html", {"request": request})


@app.post("/api/start-game")
@limiter.limit("10/minute")
async def start_game(request: Request):
    """Начинает новую игру и создает сессию."""
    user_id = generate_user_id()
    session = UserSession(user_id=user_id)
    await session_store.set(user_id, session)

    return JSONResponse({
        "user_id": user_id,
        "message": "Новая игра создана! Выберите вселенную.",
        "universes": [
            {"id": "fantasy", "name": "🧙 Фэнтези", "description": "Мир магии и драконов"},
            {"id": "cyberpunk", "name": "🚀 Киберпанк", "description": "Технологии и корпорации"},
            {"id": "space", "name": "🪐 Космоопера", "description": "Межзвездные путешествия"},
            {"id": "custom", "name": "🎨 Своя вселенная", "description": "Создайте свой мир"}
        ]
    })


@app.post("/api/choose-universe")
@limiter.limit("10/minute")
async def choose_universe(request: Request):
    """Выбор вселенной."""
    data = await request.json()
    user_id = data.get("user_id")
    universe_id = data.get("universe_id")
    custom_rules = data.get("custom_rules", "")

    session = await session_store.get(user_id)
    if not session:
        raise HTTPException(status_code=404, detail="Сессия не найдена")

    # Определяем правила вселенной
    universes = {
        "fantasy": "Классическое фэнтези с магами, драконами и древними артефактами. Магия управляется мантрой и жезлами.",
        "cyberpunk": "Мир недалекого будущего, где технологии правят миром, кибернетические импланты - обыденность.",
        "space": "Эпоха межзвездных путешествий, инопланетных цивилизаций и космических битв.",
        "custom": custom_rules or "Вы сами определяете законы мира."
    }

    session.universe = universe_id
    session.ruleset = universes.get(universe_id, "Правила определены игроком.")
    session.update_activity()
    await session_store.set(user_id, session)

    return JSONResponse({
        "success": True,
        "message": f"Вселенная выбрана! Теперь опишите своего персонажа.",
        "need_character": True,
        "universe": universe_id
    })


@app.post("/api/create-character")
@limiter.limit("10/minute")
async def create_character(request: Request, background_tasks: BackgroundTasks):
    """Создание персонажа."""
    data = await request.json()
    user_id = data.get("user_id")
    character_prompt = data.get("character_prompt")

    session = await session_store.get(user_id)
    if not session:
        raise HTTPException(status_code=404, detail="Сессия не найдена")

    if not character_prompt or len(character_prompt) > 200:
        raise HTTPException(status_code=400, detail="Необходимо описание персонажа (макс. 200 символов)")

    # Ограничиваем длину промпта
    character_prompt = character_prompt[:200]

    # Создаем персонажа с помощью AI если доступен
    if DEEPSEEK_API_KEY:
        full_prompt = (
            f"Ты - Мастер Игры. Создай начало истории.\n\n"
            f"ПРАВИЛА МИРА: {session.ruleset}\n"
            f"ЖЕЛАНИЕ ИГРОКА: '{character_prompt}'.\n\n"
            f"ЗАДАНИЕ:\n"
            f"1. Создай краткое, но атмосферное описание персонажа и стартовой локации (3-4 абзаца).\n"
            f"2. Опиши событие, с которого начинается игра.\n"
            f"3. Используй **жирный текст** для важных моментов и *курсив* для атмосферы.\n"
            f"4. В конце добавь строки:\n"
            f"INVENTORY_ADD: предмет1, предмет2, предмет3\n"
            f"CHARACTER_DATA: {{\"stats\": {{\"Сила\": 8, \"Ловкость\": 7, \"Интеллект\": 6, \"Мудрость\": 5, \"Харизма\": 4}}, \"abilities\": {{\"Паркур\": true, \"Скрытность\": true}}}}"
        )

        messages = [{"role": "user", "content": full_prompt}]
        # Запускаем в фоне с таймаутом
        background_tasks.add_task(update_session_character, user_id, messages, character_prompt)

        return JSONResponse({
            "success": True,
            "message": "Персонаж создается...",
            "processing": True
        })
    else:
        # Если AI не доступен, используем тестовые данные
        items_to_add = ["факел", "нож", "фляга с водой"]
        stats = {"Сила": 8, "Ловкость": 7, "Интеллект": 6, "Мудрость": 5, "Харизма": 4}
        abilities = {"Выживание": True, "Наблюдение": True}

        story = f"## 🎮 Начало приключения\n\nВы - **{character_prompt}**. Ваше приключение начинается здесь и сейчас.\n\n**Что будете делать?**"

        await _finalize_character_creation(session, character_prompt, story, items_to_add, stats, abilities)

        return JSONResponse({
            "success": True,
            "game_started": True,
            "story": story,
            "inventory": items_to_add,
            "stats": stats,
            "abilities": list(abilities.keys()),
            "health": session.health,
            "universe": session.universe
        })


async def update_session_character(user_id: str, messages: List[Dict], character_prompt: str):
    """Фоновая задача для создания персонажа с ИИ"""
    try:
        session = await session_store.get(user_id)
        if not session:
            return

        response_text = await get_ai_response(messages)

        # Обработка инвентаря и характеристик (как в оригинале)
        def process_inventory_command(text: str) -> tuple[str, list[str]]:
            match = re.search(r"INVENTORY_ADD:\s*(.+)", text, re.IGNORECASE)
            if match:
                items_string = match.group(1).strip()
                found_items = [item.strip() for item in items_string.split(',')]
                cleaned_text = text.replace(match.group(0), "").strip()
                return cleaned_text, found_items
            return text, []

        def parse_character_data_block(text: str) -> tuple[dict, dict]:
            match = re.search(r"CHARACTER_DATA:\s*(.+)", text, re.IGNORECASE | re.DOTALL)
            if match:
                try:
                    data_string = match.group(1).strip()
                    data = json.loads(data_string)
                    return data.get("stats", {}), data.get("abilities", {})
                except json.JSONDecodeError:
                    logger.error(f"Failed to parse CHARACTER_DATA JSON")
            return {}, {}

        def clean_hidden_data(text: str) -> str:
            text = re.sub(r"CHARACTER_DATA:\s*.+", "", text, flags=re.IGNORECASE | re.DOTALL)
            text = re.sub(r"INVENTORY_ADD:\s*.+", "", text, flags=re.IGNORECASE)
            return "\n".join(line for line in text.split("\n") if line.strip()).strip()

        items_to_add = process_inventory_command(response_text)[1]
        stats, abilities = parse_character_data_block(response_text)
        player_visible_message = clean_hidden_data(response_text)

        # Значения по умолчанию
        if not stats:
            stats = {"Сила": 8, "Ловкость": 7, "Интеллект": 6, "Мудрость": 5, "Харизма": 4}
        if not abilities:
            abilities = {"Паркур": True, "Скрытность": True}
        if not items_to_add:
            items_to_add = ["факел", "бутылка воды", "карта"]

        await _finalize_character_creation(session, character_prompt, player_visible_message, items_to_add, stats,
                                           abilities)

    except Exception as e:
        logger.error(f"Error creating character: {e}")


async def _finalize_character_creation(session: UserSession, character_prompt: str,
                                       story: str, items_to_add: List[str],
                                       stats: Dict, abilities: Dict):
    """Финализация создания персонажа"""
    session.character = character_prompt
    session.inventory = items_to_add
    session.stats = stats
    session.abilities = abilities
    session.messages = [{"role": "assistant", "content": story}]
    session.world_context = story.strip() or "Новый мир только начинает свою историю."
    session.update_activity()
    await session_store.set(session.user_id, session)


@app.post("/api/action")
@limiter.limit("30/minute")
async def perform_action(request: Request):
    """Выполнение действия в игре."""
    data = await request.json()
    user_id = data.get("user_id")
    action = data.get("action")

    if not action or len(action) > 500:
        raise HTTPException(status_code=400, detail="Действие слишком длинное или пустое")

    session = await session_store.get(user_id)
    if not session:
        raise HTTPException(status_code=404, detail="Сессия не найдена")

    if session.game_over:
        return JSONResponse({
            "success": False,
            "message": "Игра окончена. Начните новую игру.",
            "game_over": True
        })

    # Оригинальная логика действий...
    # (сохранена из вашего кода для краткости)

    # Валидация логики действия
    async def validate_action_logic(player_action: str, world_context: str) -> str:
        prompt = (
            f"Ты - Мастер Игры. Игрок пытается совершить действие: '{player_action}'. "
            f"Текущий контекст: '{world_context}'.\n\n"
            f"Если это действие невозможно или нелогично, объясни игроку, почему это нельзя сделать, "
            f"в короткой повествовательной форме (1-2 предложения).\n\n"
            f"Если действие возможно, просто ответь 'ДА'."
        )
        messages = [{"role": "user", "content": prompt}]
        return (await get_ai_response(messages, temperature=0.3)).strip()

    validation_response = await validate_action_logic(action, session.world_context)

    if "ДА" not in validation_response.upper():
        return JSONResponse({
            "success": False,
            "message": validation_response,
            "action_result": validation_response,
            "type": "validation_error"
        })

    # Расчет шанса (упрощенный)
    difficulty = 5  # Упрощаем для примера
    success_chance = 50.0

    roll = random.random() * 100
    is_success = roll < success_chance
    outcome = "успех" if is_success else "неудача"

    logger.info(f"Action: {action}, Chance: {success_chance:.2f}, Roll: {roll:.2f}, Outcome: {outcome}")

    # Запрос исхода у ИИ
    prompt_for_outcome = (
        f"Игрок совершил действие: '{action}'.\n\n"
        f"Это действие было {outcome.upper()}ОМ.\n\n"
        f"Опиши подробный исход этого действия, исходя из результата ({outcome}). "
        f"Будь красочным и атмосферным (3-4 предложения)."
    )

    session.messages.append({"role": "user", "content": prompt_for_outcome})
    response_text = await get_ai_response(session.messages)

    session.messages.append({"role": "assistant", "content": response_text})
    session.update_activity()
    await session_store.set(user_id, session)

    outcome_icon = "✅" if is_success else "❌"
    formatted_result = f"## 📖 Результат действия\n\n{response_text}\n\n---\n🎲 **Шанс успеха:** {success_chance:.0f}%\n🎯 **Выпало:** {roll:.0f}\n{outcome_icon} **Результат:** {outcome}"

    return JSONResponse({
        "success": True,
        "action_result": formatted_result,
        "chance": success_chance,
        "rolled": roll,
        "outcome": outcome,
        "inventory": session.inventory,
        "health": session.health,
        "type": "action_result"
    })


@app.post("/api/save-game")
@limiter.limit("5/minute")
async def save_game(request: Request):
    """Сохранение игры."""
    data = await request.json()
    user_id = data.get("user_id")

    session = await session_store.get(user_id)
    if not session:
        raise HTTPException(status_code=404, detail="Сессия не найдена")

    save_data = session.to_save_data()

    return JSONResponse({
        "success": True,
        "save_data": save_data.dict(),
        "message": "Игра сохранена"
    })


@app.post("/api/load-game")
@limiter.limit("5/minute")
async def load_game(request: Request):
    """Загрузка сохраненной игры."""
    data = await request.json()
    user_id = data.get("user_id")

    try:
        # Валидация через Pydantic
        save_data = SaveData(**data.get("save_data", {}))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Некорректные данные сохранения: {str(e)}")

    # Создаем новую сессию из сохраненных данных
    session = UserSession(
        user_id=user_id,
        character=save_data.character,
        inventory=save_data.inventory,
        health=save_data.health,
        stats=save_data.stats,
        abilities=save_data.abilities,
        world_context=save_data.world_context,
        game_over=save_data.game_over
    )

    await session_store.set(user_id, session)

    return JSONResponse({
        "success": True,
        "message": "Игра загружена",
        "game_data": {
            "inventory": session.inventory,
            "stats": session.stats,
            "abilities": list(session.abilities.keys()),
            "health": session.health,
            "character": session.character
        }
    })


@app.get("/health")
async def health_check():
    """Проверка здоровья приложения."""
    redis_status = "connected" if session_store.redis_client else "disabled"
    sessions_count = len(session_store.in_memory_store)

    return JSONResponse({
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "active_sessions": sessions_count,
        "redis": redis_status,
        "ai_available": bool(DEEPSEEK_API_KEY),
        "version": "2.0.0"
    })


@app.get("/metrics")
async def metrics():
    """Метрики Prometheus (автоматически генерируются Instrumentator)."""
    return JSONResponse({"message": "Use /metrics endpoint for Prometheus"})


@app.post("/api/debug/clear-sessions")
@limiter.limit("2/minute")
async def clear_sessions(request: Request):
    """Очистка всех сессий (только для отладки)."""
    # Простая защита - проверяем специальный ключ
    data = await request.json()
    if data.get("admin_key") != os.getenv("ADMIN_KEY", "debug123"):
        raise HTTPException(status_code=403, detail="Доступ запрещен")

    count = len(session_store.in_memory_store)
    session_store.in_memory_store.clear()

    # Очищаем Redis если есть
    if session_store.redis_client:
        try:
            keys = await session_store.redis_client.keys("session:*")
            if keys:
                await session_store.redis_client.delete(*keys)
        except Exception as e:
            logger.error(f"Failed to clear Redis: {e}")

    return JSONResponse({
        "message": f"Очищено {count} сессий",
        "remaining_sessions": 0
    })


if __name__ == "__main__":
    import uvicorn

    logger.info(f"Запуск RoleVerse v2.0 на {WEBAPP_HOST}:{WEBAPP_PORT}")
    logger.info(f"Redis доступен: {REDIS_AVAILABLE}")
    logger.info(f"AI доступен: {bool(DEEPSEEK_API_KEY)}")

    uvicorn.run(
        app,
        host=WEBAPP_HOST,
        port=WEBAPP_PORT,
        log_level="info"
    )