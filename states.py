from aiogram.fsm.state import State, StatesGroup

class GameStates(StatesGroup):
    main_menu = State()
    choosing_universe = State()
    creating_character = State()
    playing = State()