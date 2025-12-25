import asyncio
import logging
import os
import sys
import re
import random
import json
from typing import Dict, Any, Optional
from datetime import datetime
from dotenv import load_dotenv

from fastapi import FastAPI, Request, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from contextlib import asynccontextmanager
from pydantic import BaseModel

from openai import AsyncOpenAI


# Модели данных
class UserAction(BaseModel):
    user_id: str
    action: str


class UserSession(BaseModel):
    user_id: str
    character: Optional[str] = None
    inventory: list = []
    health: int = 100
    stats: Dict = {}
    abilities: Dict = {}
    messages: list = []
    world_context: str = ""
    universe: Optional[str] = None
    ruleset: Optional[str] = None
    game_over: bool = False
    created_at: datetime = datetime.now()
    last_active: datetime = datetime.now()


# --- НАСТРОЙКА ---
load_dotenv()
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    stream=sys.stdout
)

# Конфигурация
WEBAPP_HOST = os.getenv("WEBAPP_HOST", "0.0.0.0")
WEBAPP_PORT = int(os.getenv("PORT", 8000))

try:
    ds_client = AsyncOpenAI(
        api_key=os.getenv("DEEPSEEK_API_KEY"),
        base_url="https://api.deepseek.com"
    )
    logging.info("Клиент DeepSeek успешно инициализирован.")
except Exception as e:
    logging.error(f"Ошибка при инициализации клиента DeepSeek: {e}")
    ds_client = None

# Хранилище сессий (в production заменить на Redis/DB)
user_sessions: Dict[str, UserSession] = {}
websocket_connections: Dict[str, WebSocket] = {}


# --- Создание FastAPI приложения ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Контекстный менеджер для управления жизненным циклом приложения."""
    yield

    # Завершение работы приложения
    logging.info("Приложение останавливается")


app = FastAPI(title="RoleVerse - AI RPG Game", lifespan=lifespan)

# Статические файлы и шаблоны
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")


# --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---

async def get_ai_response(messages: list, temperature: float = 0.7) -> str:
    """Отправляет запрос к AI и возвращает ответ."""
    if not ds_client:
        return "Извините, нейросеть недоступна. Проверьте конфигурацию."
    try:
        response = await ds_client.chat.completions.create(
            model="deepseek-chat",
            messages=messages,
            max_tokens=600,
            temperature=temperature,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        logging.error(f"Error while calling DeepSeek API: {e}")
        return "Извините, произошла ошибка с нейросетью. Попробуйте еще раз."


def get_chance_message(chance: float) -> str:
    """Генерирует стилизованное и понятное сообщение для шанса действия."""
    chance = round(chance)

    if chance >= 80:
        return f"✅ <b>Почти наверняка!</b>\n(Шанс: {chance}%)"
    elif chance >= 60:
        return f"👍 <b>Довольно неплохо.</b>\n(Шанс: {chance}%)"
    elif chance >= 40:
        return f"🤔 <b>Пятьдесят на пятьдесят.</b>\n(Шанс: {chance}%)"
    elif chance >= 20:
        return f"😰 <b>Рискованно...</b>\n(Шанс: {chance}%)"
    else:
        return f"⚠️ <b>Очень сомнительно.</b>\n(Шанс: {chance}%)"


async def validate_action_logic(player_action: str, world_context: str) -> str:
    """
    Проверяет, является ли действие игрока логичным, и возвращает ответ от ИИ.
    Если действие невозможно, ИИ объяснит почему в повествовательной форме.
    Если возможно, ИИ вернет 'ДА'.
    """
    prompt = (
        f"Ты - Мастер Игры. Игрок пытается совершить действие: '{player_action}'. "
        f"Текущий контекст: '{world_context}'.\n\n"
        f"Если это действие невозможно или нелогично, объясни игроку, почему это нельзя сделать, "
        f"в короткой повествовательной форме (1-2 предложения). Не используй фразу 'Невозможное действие'.\n\n"
        f"Если действие возможно, просто ответь 'ДА'."
    )
    messages = [{"role": "user", "content": prompt}]
    validation_response = await get_ai_response(messages, temperature=0.3)

    return validation_response.strip()


async def update_world_context(last_ai_response: str, current_context: str) -> str:
    """Обновляет контекст мира на основе последнего события."""
    prompt = (
        f"На основе следующего события в игре, обнови краткое описание состояния мира. "
        f"Сохраняй главное, опускай мелкие детали. Ответ должен быть 1-2 предложениями.\n\n"
        f"ПРЕДЫДУЩИЙ КОНТЕКСТ:\n{current_context}\n\n"
        f"НОВОЕ СОБЫТИЕ:\n{last_ai_response}\n\n"
        f"ОБНОВЛЕННЫЙ КОНТЕКСТ:"
    )
    messages = [{"role": "user", "content": prompt}]
    new_context = await get_ai_response(messages, temperature=0.3)
    return new_context


async def get_action_difficulty(player_action: str, context: str) -> int:
    """Запрашивает у ИИ оценку сложности действия от 1 до 10."""
    prompt = f"Оцени сложность действия игрока по шкале от 1 (очень легко) до 10 (почти невозможно). " \
             f"Ответь только одним числом. Контекст: {context}. Действие: '{player_action}'."
    messages = [{"role": "user", "content": prompt}]
    difficulty_str = await get_ai_response(messages, temperature=0.2)
    try:
        difficulty = int(difficulty_str)
        return max(1, min(10, difficulty))
    except (ValueError, TypeError):
        logging.warning(f"Could not parse difficulty from AI response: {difficulty_str}")
        return 5


def calculate_action_chance(player_action: str, stats: dict, abilities: dict, inventory: list,
                            difficulty: int) -> float:
    """Рассчитывает шанс выполнения действия в процентах."""
    base_chance = 50.0
    stat_bonus = 0
    if any(kw in player_action.lower() for kw in ["сила", "сдвинуть", "пробить", "сломать"]):
        stat_bonus += stats.get("Сила", 0) * 3
    if any(kw in player_action.lower() for kw in ["ловкость", "уклониться", "прыгнуть", "схватить"]):
        stat_bonus += stats.get("Ловкость", 0) * 3
    if any(kw in player_action.lower() for kw in ["интеллект", "загадка", "узнать", "понять"]):
        stat_bonus += stats.get("Интеллект", 0) * 3
    if any(kw in player_action.lower() for kw in ["мудрость", "убедить", "восприятие", "заметить"]):
        stat_bonus += stats.get("Мудрость", 0) * 3
    if any(kw in player_action.lower() for kw in ["харизма", "соблазнить", "обмануть", "запугать"]):
        stat_bonus += stats.get("Харизма", 0) * 3
    ability_bonus = 0
    if abilities.get("Магия") and "магия" in player_action.lower():
        ability_bonus += 25
    if abilities.get("Взлом") and "замок" in player_action.lower():
        ability_bonus += 30
    if abilities.get("Скрытность") and "скрытно" in player_action.lower():
        ability_bonus += 25
    item_bonus = 0
    if any("отмычка" in item.lower() for item in inventory) and "замок" in player_action.lower():
        item_bonus += 20
    if any("зелье" in item.lower() for item in inventory) and "выпить" in player_action.lower():
        item_bonus += 15
    difficulty_penalty = difficulty * 5
    final_chance = base_chance + stat_bonus + ability_bonus + item_bonus - difficulty_penalty
    return max(5.0, min(95.0, final_chance))


def process_inventory_command(text: str) -> tuple[str, list[str]]:
    """Ищет в тексте команду INVENTORY_ADD и возвращает очищенный текст и список предметов."""
    match = re.search(r"INVENTORY_ADD:\s*(.+)", text, re.IGNORECASE)
    if match:
        items_string = match.group(1).strip()
        found_items = [item.strip() for item in items_string.split(',')]
        cleaned_text = text.replace(match.group(0), "").strip()
        return cleaned_text, found_items
    return text, []


def parse_character_data_block(text: str) -> tuple[dict, dict]:
    """Ищет в тексте команду CHARACTER_DATA и парсит из нее JSON."""
    match = re.search(r"CHARACTER_DATA:\s*(.+)", text, re.IGNORECASE | re.DOTALL)
    if match:
        try:
            data_string = match.group(1).strip()
            data = json.loads(data_string)
            stats = data.get("stats", {})
            abilities = data.get("abilities", {})
            return stats, abilities
        except json.JSONDecodeError:
            logging.error(f"Failed to parse CHARACTER_DATA JSON: {match.group(1)}")
            return {}, {}
    return {}, {}


def clean_hidden_data(text: str) -> str:
    """Удаляет из текста все служебные команды (INVENTORY_ADD, CHARACTER_DATA)."""
    text = re.sub(r"CHARACTER_DATA:\s*.+", "", text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"INVENTORY_ADD:\s*.+", "", text, flags=re.IGNORECASE)
    return "\n".join(line for line in text.split("\n") if line.strip()).strip()


def generate_user_id() -> str:
    """Генерирует уникальный ID пользователя."""
    return f"user_{random.randint(100000, 999999)}_{int(datetime.now().timestamp())}"


async def send_to_websocket(user_id: str, message_type: str, data: dict):
    """Отправляет сообщение через WebSocket."""
    if user_id in websocket_connections:
        try:
            await websocket_connections[user_id].send_json({
                "type": message_type,
                "data": data,
                "timestamp": datetime.now().isoformat()
            })
        except Exception as e:
            logging.error(f"Ошибка отправки WebSocket: {e}")
            # Удаляем нерабочее соединение
            websocket_connections.pop(user_id, None)


# --- РОУТЫ FASTAPI ---

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    """Главная страница."""
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/game", response_class=HTMLResponse)
async def game_page(request: Request):
    """Страница игры."""
    return templates.TemplateResponse("game.html", {"request": request})


@app.post("/api/start-game")
async def start_game():
    """Начинает новую игру и создает сессию."""
    user_id = generate_user_id()
    session = UserSession(user_id=user_id)
    user_sessions[user_id] = session

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
async def choose_universe(request: Request):
    """Выбор вселенной."""
    data = await request.json()
    user_id = data.get("user_id")
    universe_id = data.get("universe_id")

    if user_id not in user_sessions:
        raise HTTPException(status_code=404, detail="Сессия не найдена")

    session = user_sessions[user_id]

    # Определяем правила вселенной
    universes = {
        "fantasy": "Классическое фэнтези с магами, драконами и древними артефактами. Магия управляется мантрой и жезлами.",
        "cyberpunk": "Мир недалекого будущего, где технологии правят миром, кибернетические импланты - обыденность.",
        "space": "Эпоха межзвездных путешествий, инопланетных цивилизаций и космических битв.",
        "custom": data.get("custom_rules", "Вы сами определяете законы мира.")
    }

    session.universe = universe_id
    session.ruleset = universes.get(universe_id, "Правила определены игроком.")

    return JSONResponse({
        "success": True,
        "message": f"Вселенная выбрана! Теперь опишите своего персонажа.",
        "need_character": True
    })


@app.post("/api/create-character")
async def create_character(request: Request):
    """Создание персонажа."""
    data = await request.json()
    user_id = data.get("user_id")
    character_prompt = data.get("character_prompt")

    if user_id not in user_sessions:
        raise HTTPException(status_code=404, detail="Сессия не найдена")

    session = user_sessions[user_id]

    if not character_prompt:
        raise HTTPException(status_code=400, detail="Необходимо описание персонажа")

    # Создаем персонажа с помощью AI
    full_prompt = (
        f"Ты - Мастер Игры. Создай начало истории.\n\n"
        f"ПРАВИЛА МИРА: {session.ruleset}\n"
        f"ЖЕЛАНИЕ ИГРОКА: '{character_prompt}'.\n\n"
        f"ЗАДАНИЕ:\n"
        f"1. Создай краткое описание персонажа и стартовой локации. Опиши событие, с которого начинается игра.\n\n"
        f"ВАЖНО: Не показывай игроку его характеристики и способности в тексте. Он узнает их через отдельные команды.\n\n"
        f"!!! КРИТИЧЕСКИ ВАЖНОЕ ПРАВИЛО !!!\n"
        f"Твой ответ должен закончиться двумя строками. Сначала инвентарь, потом данные персонажа.\n"
        f"Формат:\n"
        f"INVENTORY_ADD: предмет1, предмет2, предмет3\n"
        f"CHARACTER_DATA: {{\"stats\": {{\"Сила\": 8, \"Ловкость\": 7, \"Интеллект\": 6, \"Мудрость\": 5, \"Харизма\": 4}}, \"abilities\": {{\"Паркур\": true, \"Скрытность\": true}}}}\n"
        f"ВЫПОЛНИТЬ ОБЯЗАТЕЛЬНО."
    )

    messages = [{"role": "user", "content": full_prompt}]
    response_text = await get_ai_response(messages)
    logging.info(f"AI RAW RESPONSE:\n{response_text}")

    items_to_add = process_inventory_command(response_text)[1]
    stats, abilities = parse_character_data_block(response_text)
    player_visible_message = clean_hidden_data(response_text)

    # Обновляем сессию
    session.character = player_visible_message
    session.inventory = items_to_add
    session.stats = stats
    session.abilities = abilities
    session.messages = [{"role": "assistant", "content": response_text}]
    session.world_context = player_visible_message.strip()
    session.last_active = datetime.now()

    return JSONResponse({
        "success": True,
        "game_started": True,
        "story": player_visible_message,
        "inventory": items_to_add,
        "stats": stats,
        "abilities": list(abilities.keys()),
        "health": session.health
    })


@app.post("/api/action")
async def perform_action(request: Request):
    """Выполнение действия в игре."""
    data = await request.json()
    user_id = data.get("user_id")
    action = data.get("action")

    if user_id not in user_sessions:
        raise HTTPException(status_code=404, detail="Сессия не найдена")

    session = user_sessions[user_id]

    if session.game_over:
        return JSONResponse({
            "success": False,
            "message": "Игра окончена. Начните новую игру.",
            "game_over": True
        })

    # --- Шаг 0: Проверка логичности действия ---
    validation_response = await validate_action_logic(action, session.world_context)

    if validation_response.upper() != "ДА":
        return JSONResponse({
            "success": False,
            "message": validation_response,
            "action_result": validation_response,
            "type": "validation_error"
        })

    # --- Шаг 1: Расчет шанса ---
    difficulty = await get_action_difficulty(action, session.world_context)
    success_chance = calculate_action_chance(
        action,
        session.stats,
        session.abilities,
        session.inventory,
        difficulty
    )

    # --- Шаг 2: Определение результата ---
    roll = random.random() * 100
    is_success = roll < success_chance
    outcome = "УСПЕХ" if is_success else "НЕУДАЧА"

    logging.info(f"Action: {action}, Chance: {success_chance:.2f}, Roll: {roll:.2f}, Outcome: {outcome}")

    # --- Шаг 3: Запрос исхода у ИИ ---
    prompt_for_outcome = (
        f"Игрок совершил действие: '{action}'.\n\n"
        f"Это действие было {outcome}ОМ.\n\n"
        f"Опиши подробный исход этого действия, исходя из результата ({outcome}). "
        f"Если неудача - опиши, почему не получилось. Если успех - опиши, что произошло. "
        f"Будь лаконичным, но красочным (не более 300 символов)."
    )

    session.messages.append({"role": "user", "content": prompt_for_outcome})
    response_text = await get_ai_response(session.messages)

    # Обработка добавления предметов
    processed_message, new_items = process_inventory_command(response_text)
    if new_items:
        current_inventory_names = [item.lower() for item in session.inventory]
        for item in new_items:
            if item.lower() not in current_inventory_names:
                session.inventory.append(item)

    session.messages.append({"role": "assistant", "content": response_text})

    # Обновление контекста мира
    session.world_context = await update_world_context(processed_message, session.world_context)
    session.last_active = datetime.now()

    # Проверка на конец игры
    game_over_keywords = ["умер", "погиб", "проиграл", "конец", "game over"]
    game_over = any(keyword in processed_message.lower() for keyword in game_over_keywords)
    if game_over:
        session.game_over = True

    return JSONResponse({
        "success": True,
        "action_result": processed_message,
        "chance": success_chance,
        "rolled": roll,
        "outcome": outcome.lower(),
        "new_items": new_items,
        "inventory": session.inventory,
        "health": session.health,
        "game_over": session.game_over,
        "world_context": session.world_context,
        "type": "action_result"
    })


@app.post("/api/get-status")
async def get_status(request: Request):
    """Получение статуса игрока."""
    data = await request.json()
    user_id = data.get("user_id")

    if user_id not in user_sessions:
        raise HTTPException(status_code=404, detail="Сессия не найдена")

    session = user_sessions[user_id]

    return JSONResponse({
        "inventory": session.inventory,
        "stats": session.stats,
        "abilities": list(session.abilities.keys()),
        "health": session.health,
        "character": session.character,
        "world_context": session.world_context,
        "game_over": session.game_over
    })


@app.post("/api/save-game")
async def save_game(request: Request):
    """Сохранение игры."""
    data = await request.json()
    user_id = data.get("user_id")

    if user_id not in user_sessions:
        raise HTTPException(status_code=404, detail="Сессия не найдена")

    session = user_sessions[user_id]

    # В production здесь было бы сохранение в базу данных
    save_data = {
        "user_id": session.user_id,
        "character": session.character,
        "inventory": session.inventory,
        "health": session.health,
        "stats": session.stats,
        "abilities": session.abilities,
        "world_context": session.world_context,
        "game_over": session.game_over,
        "last_active": session.last_active.isoformat()
    }

    # Здесь можно сохранить в файл или базу данных
    # Пока просто возвращаем данные
    return JSONResponse({
        "success": True,
        "save_data": save_data,
        "message": "Игра сохранена"
    })


@app.post("/api/load-game")
async def load_game(request: Request):
    """Загрузка сохраненной игры."""
    data = await request.json()
    user_id = data.get("user_id")
    save_data = data.get("save_data")

    if not save_data:
        raise HTTPException(status_code=400, detail="Нет данных для загрузки")

    # Создаем новую сессию из сохраненных данных
    session = UserSession(
        user_id=user_id,
        character=save_data.get("character"),
        inventory=save_data.get("inventory", []),
        health=save_data.get("health", 100),
        stats=save_data.get("stats", {}),
        abilities=save_data.get("abilities", {}),
        world_context=save_data.get("world_context", ""),
        game_over=save_data.get("game_over", False)
    )

    user_sessions[user_id] = session

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


@app.post("/api/new-game")
async def new_game(request: Request):
    """Начать новую игру (сброс текущей)."""
    data = await request.json()
    user_id = data.get("user_id")

    # Удаляем старую сессию
    if user_id in user_sessions:
        user_sessions.pop(user_id)

    # Создаем новую сессию
    new_user_id = generate_user_id()
    session = UserSession(user_id=new_user_id)
    user_sessions[new_user_id] = session

    return JSONResponse({
        "user_id": new_user_id,
        "message": "Новая игра создана!",
        "universes": [
            {"id": "fantasy", "name": "🧙 Фэнтези", "description": "Мир магии и драконов"},
            {"id": "cyberpunk", "name": "🚀 Киберпанк", "description": "Технологии и корпорации"},
            {"id": "space", "name": "🪐 Космоопера", "description": "Межзвездные путешествия"},
            {"id": "custom", "name": "🎨 Своя вселенная", "description": "Создайте свой мир"}
        ]
    })


@app.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    """WebSocket соединение для real-time обновлений."""
    await websocket.accept()
    websocket_connections[user_id] = websocket

    try:
        while True:
            # Поддерживаем соединение открытым
            data = await websocket.receive_text()
            # Можно обрабатывать сообщения от клиента
            await websocket.send_json({
                "type": "ping",
                "data": {"message": "pong"}
            })
    except WebSocketDisconnect:
        logging.info(f"WebSocket отключен для пользователя {user_id}")
        websocket_connections.pop(user_id, None)
    except Exception as e:
        logging.error(f"Ошибка WebSocket: {e}")
        websocket_connections.pop(user_id, None)


@app.get("/health")
async def health_check():
    """Проверка здоровья приложения."""
    return JSONResponse({
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "active_sessions": len(user_sessions),
        "active_connections": len(websocket_connections),
        "ai_available": ds_client is not None
    })


@app.get("/api/clear-sessions")
async def clear_sessions():
    """Очистка всех сессий (для отладки)."""
    count = len(user_sessions)
    user_sessions.clear()
    websocket_connections.clear()

    return JSONResponse({
        "message": f"Очищено {count} сессий",
        "remaining_sessions": 0
    })


if __name__ == "__main__":
    import uvicorn

    logging.info(f"Запуск RoleVerse Web App на {WEBAPP_HOST}:{WEBAPP_PORT}")

    uvicorn.run(
        app,
        host=WEBAPP_HOST,
        port=WEBAPP_PORT,
        log_level="info"
    )