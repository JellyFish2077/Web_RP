import asyncio
import logging
import os
import sys
import re
import random
import json
from typing import Dict, Any
from dotenv import load_dotenv

from fastapi import FastAPI, Request, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse, HTMLResponse
from contextlib import asynccontextmanager

from aiogram import Bot, Dispatcher, Router, F
from aiogram.filters import CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import Message, ReplyKeyboardRemove, Update, WebhookInfo
from aiogram.enums import ParseMode
from aiogram.client.default import DefaultBotProperties
from aiogram.webhook.aiohttp_server import SimpleRequestHandler, setup_application
from aiohttp import web
from openai import AsyncOpenAI

import keyboards as kb
import states as st
import universes as uv

# --- НАСТРОЙКА ---
load_dotenv()
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    stream=sys.stdout
)

# Конфигурация вебхука
WEBHOOK_PATH = "/webhook"
WEBHOOK_URL = os.getenv("WEBHOOK_URL", "")
WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET", "my-secret-token")
WEBAPP_HOST = os.getenv("WEBAPP_HOST", "0.0.0.0")
WEBAPP_PORT = int(os.getenv("PORT", 8000))

# Инициализация бота
bot = Bot(
    token=os.getenv("TELEGRAM_BOT_TOKEN"),
    default=DefaultBotProperties(parse_mode=ParseMode.HTML)
)

# Инициализация хранилища и диспетчера
storage = MemoryStorage()
dp = Dispatcher(storage=storage)
router = Router()

try:
    ds_client = AsyncOpenAI(
        api_key=os.getenv("DEEPSEEK_API_KEY"),
        base_url="https://api.deepseek.com"
    )
    logging.info("Клиент DeepSeek успешно инициализирован.")
except Exception as e:
    logging.error(f"Ошибка при инициализации клиента DeepSeek: {e}")
    ds_client = None


# --- Создание FastAPI приложения ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Контекстный менеджер для управления жизненным циклом приложения.
    """
    # Запуск приложения
    await bot.set_webhook(
        url=f"{WEBHOOK_URL}{WEBHOOK_PATH}",
        secret_token=WEBHOOK_SECRET,
        drop_pending_updates=True
    )
    webhook_info = await bot.get_webhook_info()
    logging.info(f"Webhook установлен: {webhook_info.url}")

    yield

    # Завершение работы приложения
    await bot.delete_webhook()
    await bot.session.close()
    logging.info("Бот остановлен, вебхук удален")


app = FastAPI(title="RoleVerse Bot", lifespan=lifespan)


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


# --- ОБРАБОТЧИКИ СОСТОЯНИЙ И КОМАНД ---

@router.message(CommandStart())
async def cmd_start(message: Message, state: FSMContext):
    await state.clear()
    await message.answer(
        "<b>🌌 Добро пожаловать в RoleVerse Bot!</b>\n\n"
        "Готовы к приключениям? Выберите, как хотите начать:",
        reply_markup=kb.main_menu_kb
    )
    await state.set_state(st.GameStates.main_menu)


@router.message(st.GameStates.main_menu, F.text == "🎲 Быстрая игра")
async def simple_game_start(message: Message, state: FSMContext):
    await state.set_state(st.GameStates.choosing_universe)
    await message.answer(
        "Отличный выбор! <b>Быстрая игра</b> погрузит вас в готовый мир.\n\n"
        "Выберите вселенную для вашего приключения:",
        reply_markup=kb.universe_choice_kb
    )


@router.message(st.GameStates.main_menu, F.text == "🧠 Песочница")
async def advanced_game_start(message: Message, state: FSMContext):
    await message.answer(
        "<b>Песочница</b> — это полный творческий контроль.\n\n"
        "Здесь вы — создатель. Определите законы мира и создайте легендарного героя (или злодея!).",
        reply_markup=kb.advanced_menu_kb
    )
    await state.set_state(st.GameStates.creating_character)


@router.message(st.GameStates.main_menu, F.text == "❌ Выйти")
async def exit_handler(message: Message, state: FSMContext):
    await state.clear()
    await message.answer("До встречи в других мирах! ⭐", reply_markup=ReplyKeyboardRemove())


@router.message(st.GameStates.choosing_universe, F.text.in_(uv.UNIVERSES.keys()))
async def choose_universe(message: Message, state: FSMContext):
    universe_data = uv.UNIVERSES[message.text]
    await state.update_data(universe=message.text, ruleset=universe_data['ruleset'])
    await message.answer(
        f"Вы выбрали вселенную <b>{message.text}</b>.\n\n"
        "Теперь опишите в двух словах, какого персонажа вы хотели бы сыграть.\n\n"
        "<i>Например: 'циничный наемник', 'молодой и амбициозный маг', 'изобретательная воровка'.</i>",
        reply_markup=ReplyKeyboardRemove()
    )
    await state.set_state(st.GameStates.creating_character)


@router.message(st.GameStates.choosing_universe, F.text == "⬅️ Назад")
async def back_to_main_from_universe(message: Message, state: FSMContext):
    await cmd_start(message, state)


@router.message(st.GameStates.creating_character)
async def start_game_from_prompt(message: Message, state: FSMContext):
    user_data = await state.get_data()
    character_prompt = message.text
    ruleset = user_data.get('ruleset', "Правила определены игроком.")

    await message.answer("Отлично! Создаю мир и вашего персонажа... Это может занять несколько секунд.",
                         reply_markup=ReplyKeyboardRemove())

    full_prompt = (
        f"Ты - Мастер Игры. Создай начало истории.\n\n"
        f"ПРАВИЛА МИРА: {ruleset}\n"
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

    initial_world_context = player_visible_message.strip()

    await state.update_data(
        character=player_visible_message,
        inventory=items_to_add,
        health=100,
        stats=stats,
        abilities=abilities,
        messages=[{"role": "assistant", "content": response_text}],
        world_context=initial_world_context,
        game_over=False
    )
    logging.info(f"STATE UPDATE: inventory={items_to_add}, stats={stats}, abilities={abilities}")

    await state.set_state(st.GameStates.playing)
    await message.answer(player_visible_message, reply_markup=kb.gameplay_kb)


@router.message(st.GameStates.creating_character, F.text == "▶️ Начать приключение")
async def start_advanced_game(message: Message, state: FSMContext):
    data = await state.get_data()
    if not data.get('character') or not data.get('ruleset'):
        await message.answer("Пожалуйста, сначала создайте персонажа и опишите мир!")
        return
    await start_game_from_prompt(message, state)


@router.message(st.GameStates.creating_character, F.text == "⬅️ Назад")
async def back_to_main_from_advanced(message: Message, state: FSMContext):
    await cmd_start(message, state)


@router.message(st.GameStates.playing, F.text == "🎒 Инвентарь")
async def show_inventory(message: Message, state: FSMContext):
    user_data = await state.get_data()
    inventory = user_data.get('inventory', [])
    if not inventory:
        await message.answer("🎒 <b>Ваш инвентарь пуст.</b>")
    else:
        inventory_list = "\n".join(f"• {item}" for item in inventory)
        await message.answer(f"🎒 <b>Ваш инвентарь:</b>\n\n{inventory_list}")


@router.message(st.GameStates.playing, F.text == "📊 Характеристики")
async def show_status(message: Message, state: FSMContext):
    user_data = await state.get_data()
    character = user_data.get('character', 'Неизвестен')
    health = user_data.get('health', 100)
    stats = user_data.get('stats', {})

    status_text = f"📊 <b>Характеристики:</b>\n\n<i>{character}</i>\n\n❤️ Здоровье: {health}/100"

    if stats:
        status_text += "\n\n<b>Параметры:</b>"
        for stat_name, stat_value in stats.items():
            status_text += f"\n• {stat_name}: {stat_value}"

    await message.answer(status_text)


@router.message(st.GameStates.playing, F.text == "💬 Навыки")
async def show_skills(message: Message, state: FSMContext):
    user_data = await state.get_data()
    abilities = user_data.get('abilities', {})

    if not abilities:
        await message.answer("💬 <b>У вашего персонажа нет особых навыков.</b>")
    else:
        skills_text = "💬 <b>Навыки вашего персонажа:</b>\n\n"
        for ability_name in abilities.keys():
            skills_text += f"• {ability_name}\n"

        await message.answer(skills_text)


@router.message(st.GameStates.playing, F.text == "⏸️ Меню")
async def pause_game(message: Message, state: FSMContext):
    await message.answer("Игра на паузе. Вы можете вернуться в главное меню.", reply_markup=kb.main_menu_kb)
    await state.set_state(st.GameStates.main_menu)


@router.message(st.GameStates.playing)
async def gameplay_handler(message: Message, state: FSMContext):
    user_data = await state.get_data()
    messages_history = user_data.get('messages', [])
    world_context = user_data.get('world_context', 'Мир только начинает создаваться.')

    if not messages_history:
        await message.answer(
            "Что-то пошло не так, история диалога утеряна. Пожалуйста, начните игру заново с помощью /start.")
        await state.clear()
        return

    player_action = message.text

    # --- Шаг 0: Проверка логичности действия (ИЗМЕНЕНО) ---
    validation_response = await validate_action_logic(player_action, world_context)

    if validation_response.upper() != "ДА":
        # Отправляем ответ от ИИ напрямую, без префикса
        await message.answer(validation_response)
        return

    # --- Шаг 1: Ожидание и оценка ---
    wait_message = await message.answer("🎲 <i>Оцениваю ситуацию и рассчитываю шансы...</i>")
    await bot.send_chat_action(chat_id=message.chat.id, action="typing")

    # --- Шаг 2: Расчет шанса ---
    stats = user_data.get('stats', {})
    abilities = user_data.get('abilities', {})
    inventory = user_data.get('inventory', [])

    difficulty = await get_action_difficulty(player_action, world_context)
    success_chance = calculate_action_chance(player_action, stats, abilities, inventory, difficulty)

    # --- Шаг 3: Отображение шанса ---
    chance_message = get_chance_message(success_chance)
    await bot.edit_message_text(chat_id=message.chat.id, message_id=wait_message.message_id, text=chance_message)

    # --- Шаг 4: Определение результата ---
    roll = random.random() * 100
    is_success = roll < success_chance
    outcome = "УСПЕХ" if is_success else "НЕУДАЧА"

    logging.info(f"Action: {player_action}, Chance: {success_chance:.2f}, Roll: {roll:.2f}, Outcome: {outcome}")

    # --- Шаг 5: Запрос исхода у ИИ ---
    prompt_for_outcome = (
        f"Игрок совершил действие: '{player_action}'.\n\n"
        f"Это действие было {outcome}ОМ.\n\n"
        f"Опиши подробный исход этого действия, исходя из результата ({outcome}). "
        f"Если неудача - опиши, почему не получилось. Если успех - опиши, что произошло. "
        f"Будь лаконичным, но красочным (не более 300 символов)."
    )

    messages_history.append({"role": "user", "content": prompt_for_outcome})
    response_text = await get_ai_response(messages_history)

    processed_message, new_items = process_inventory_command(response_text)
    if new_items:
        current_inventory_names = [item.lower() for item in inventory]
        for item in new_items:
            if item.lower() not in current_inventory_names:
                inventory.append(item)
        await state.update_data(inventory=inventory)

    messages_history.append({"role": "assistant", "content": response_text})
    await state.update_data(messages=messages_history)

    new_world_context = await update_world_context(processed_message, world_context)
    await state.update_data(world_context=new_world_context)
    logging.info(f"World context updated: {new_world_context}")

    await message.answer(processed_message)


# --- РОУТЫ FASTAPI ---

@app.get("/")
async def root():
    """Корневой маршрут для проверки работы."""
    return {"message": "RoleVerse Bot API is running!", "status": "active"}


@app.get("/health")
async def health_check():
    """Маршрут для проверки здоровья приложения."""
    return JSONResponse(
        content={
            "status": "healthy",
            "bot": await bot.get_me() is not None,
            "webhook": (await bot.get_webhook_info()).url if WEBHOOK_URL else "Not set"
        }
    )


@app.post(WEBHOOK_PATH)
async def bot_webhook(request: Request):
    """
    Основной вебхук для получения обновлений от Telegram.
    """
    # Проверка секретного токена
    if WEBHOOK_SECRET:
        secret_token = request.headers.get("X-Telegram-Bot-Api-Secret-Token")
        if secret_token != WEBHOOK_SECRET:
            logging.warning(f"Неверный секретный токен: {secret_token}")
            raise HTTPException(status_code=403, detail="Forbidden")

    # Получение и обработка обновления
    try:
        update_data = await request.json()
        update = Update(**update_data)

        # Асинхронная обработка обновления
        asyncio.create_task(process_update(update))

        return {"ok": True}
    except Exception as e:
        logging.error(f"Ошибка обработки вебхука: {e}")
        return JSONResponse(
            status_code=500,
            content={"ok": False, "error": str(e)}
        )


async def process_update(update: Update):
    """
    Обработка обновления Telegram в фоновом режиме.
    """
    try:
        await dp.feed_update(bot, update)
    except Exception as e:
        logging.error(f"Ошибка при обработке обновления: {e}")


@app.get("/set-webhook")
async def set_webhook_endpoint():
    """
    Ручная установка вебхука (для отладки).
    """
    try:
        if not WEBHOOK_URL:
            return {"error": "WEBHOOK_URL не установлен в .env файле"}

        await bot.set_webhook(
            url=f"{WEBHOOK_URL}{WEBHOOK_PATH}",
            secret_token=WEBHOOK_SECRET,
            drop_pending_updates=True
        )
        webhook_info = await bot.get_webhook_info()

        return {
            "success": True,
            "webhook_url": webhook_info.url,
            "pending_updates_count": webhook_info.pending_update_count
        }
    except Exception as e:
        logging.error(f"Ошибка установки вебхука: {e}")
        return JSONResponse(
            status_code=500,
            content={"error": str(e)}
        )


@app.get("/delete-webhook")
async def delete_webhook_endpoint():
    """
    Удаление вебхука (для отладки).
    """
    try:
        await bot.delete_webhook()
        return {"success": True, "message": "Webhook deleted"}
    except Exception as e:
        logging.error(f"Ошибка удаления вебхука: {e}")
        return JSONResponse(
            status_code=500,
            content={"error": str(e)}
        )


# Регистрация роутера aiogram
dp.include_router(router)

if __name__ == "__main__":
    import uvicorn

    logging.info(f"Запуск сервера на {WEBAPP_HOST}:{WEBAPP_PORT}")

    uvicorn.run(
        app,
        host=WEBAPP_HOST,
        port=WEBAPP_PORT,
        log_level="info"
    )