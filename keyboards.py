from aiogram.types import ReplyKeyboardMarkup, KeyboardButton

# Главное меню
main_menu_kb = ReplyKeyboardMarkup(
    keyboard=[
        [KeyboardButton(text="🎲 Быстрая игра")],
        [KeyboardButton(text="🧠 Песочница")],
        [KeyboardButton(text="❌ Выйти")]
    ],
    resize_keyboard=True,
    one_time_keyboard=False
)

# Выбор вселенной
universe_choice_kb = ReplyKeyboardMarkup(
    keyboard=[
        [KeyboardButton(text="🧙 Фэнтези")],
        [KeyboardButton(text="🚀 Киберпанк")],
        [KeyboardButton(text="🪐 Космоопера")],
        [KeyboardButton(text="⬅️ Назад")]
    ],
    resize_keyboard=True,
    one_time_keyboard=False
)

# Меню песочницы
advanced_menu_kb = ReplyKeyboardMarkup(
    keyboard=[
        [KeyboardButton(text="▶️ Начать приключение")],
        [KeyboardButton(text="⬅️ Назад")]
    ],
    resize_keyboard=True,
    one_time_keyboard=False
)

# Игровое меню
gameplay_kb = ReplyKeyboardMarkup(
    keyboard=[
        [KeyboardButton(text="🎒 Инвентарь"), KeyboardButton(text="📊 Характеристики")],
        [KeyboardButton(text="💬 Навыки"), KeyboardButton(text="⏸️ Меню")]
    ],
    resize_keyboard=True,
    one_time_keyboard=False
)