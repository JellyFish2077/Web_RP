import multiprocessing

# Количество воркеров = ядра * 2 + 1
workers = multiprocessing.cpu_count() * 2 + 1

# Тип воркера для ASGI приложений
worker_class = "uvicorn.workers.UvicornWorker"

# Таймауты
timeout = 120
keepalive = 5

# Логирование
accesslog = "-"
errorlog = "-"