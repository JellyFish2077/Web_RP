import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "active_sessions" in data


def test_start_game():
    response = client.post("/api/start-game")
    assert response.status_code == 200
    data = response.json()
    assert "user_id" in data
    assert "universes" in data
    assert len(data["universes"]) == 4


def test_rate_limiting():
    # Делаем 11 запросов быстро
    responses = []
    for _ in range(11):
        response = client.post("/api/start-game")
        responses.append(response.status_code)

    # Последний должен быть 429
    assert 429 in responses


def test_save_load_validation():
    # Тест с некорректными данными
    invalid_data = {
        "user_id": "test",
        "save_data": {
            "health": 200,  # Невалидное здоровье
            "inventory": ["item" * 100]  # Слишком длинное название
        }
    }

    response = client.post("/api/load-game", json=invalid_data)
    assert response.status_code == 400