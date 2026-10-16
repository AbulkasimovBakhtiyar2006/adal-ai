from fastapi.testclient import TestClient

from app.games import DUEL_REVEAL_SECONDS, GameRooms, points_for
from app.main import create_app
from tests.conftest import FakeProviders


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


def question(n: int, correct: int = 0):
    return {
        "text": {"ru": f"Вопрос {n}", "kk": f"Сұрақ {n}"},
        "options": [{"ru": f"Ответ {i}", "kk": f"Жауап {i}"} for i in range(4)],
        "correct": correct,
        "explanation": {"ru": "Пояснение", "kk": "Түсіндірме"},
    }


def setup(client, mode="live", count=2, clock=None):
    clock = clock or Clock()
    client.app.state.games = GameRooms(clock)
    body = {"mode": mode, "seconds": 20, "questions": [question(i, i % 4) for i in range(count)]}
    created = client.post("/api/games", json=body).json()
    return created["code"], {"X-Game-Token": created["token"]}, clock


def join(client, code, name, avatar="eagle"):
    response = client.post(f"/api/games/{code}/join", json={"name": name, "avatar": avatar})
    assert response.status_code == 200, response.text
    return {"X-Game-Token": response.json()["token"]}


def test_live_game_flow_scores_speed_and_announces_winner(settings, draft):
    with TestClient(create_app(settings, FakeProviders(draft))) as client:
        code, host, clock = setup(client)
        assert len(code) == 6 and code.isdigit()
        aru = join(client, code, "  Аружан  ", "asel")
        dias = join(client, code, "Диас", "wolf")
        assert client.post(f"/api/games/{code}/join", json={"name": "аружан"}).status_code == 409

        lobby = client.get(f"/api/games/{code}", headers=host).json()
        assert lobby["phase"] == "lobby" and lobby["is_host"]
        assert [p["name"] for p in lobby["players"]] == ["Аружан", "Диас"]
        assert client.post(f"/api/games/{code}/start", headers=aru).status_code == 403
        assert client.post(f"/api/games/{code}/start", headers=host).status_code == 200
        assert client.post(f"/api/games/{code}/join", json={"name": "Поздно"}).status_code == 409

        playing = client.get(f"/api/games/{code}", headers=aru).json()
        assert playing["phase"] == "question" and "correct" not in playing["question"]
        assert playing["remaining_ms"] == 20000

        clock.now += 2
        assert (
            client.post(
                f"/api/games/{code}/answer", headers=aru, json={"index": 0, "choice": 0}
            ).status_code
            == 200
        )
        you = client.get(f"/api/games/{code}", headers=aru).json()["you"]
        assert you["answer"] == {"choice": 0, "points": None, "correct": None}
        # Score and streak don't move until the reveal, so they can't leak the key.
        assert (you["score"], you["streak"], you["correct"]) == (0, 0, 0)
        assert (
            client.post(
                f"/api/games/{code}/answer", headers=aru, json={"index": 0, "choice": 1}
            ).status_code
            == 409
        )
        clock.now += 8
        client.post(f"/api/games/{code}/answer", headers=dias, json={"index": 0, "choice": 0})

        # Everyone answered: the reveal shows the key, counts and points.
        reveal = client.get(f"/api/games/{code}", headers=aru).json()
        assert reveal["phase"] == "reveal"
        assert reveal["question"]["correct"] == 0 and reveal["question"]["counts"] == [2, 0, 0, 0]
        assert reveal["you"]["answer"]["points"] == points_for(2, 20, 1) == 950
        assert reveal["players"][0]["name"] == "Аружан"

        client.post(f"/api/games/{code}/next", headers=host)
        clock.now += 21  # nobody answers question 2: time runs out
        timed_out = client.get(f"/api/games/{code}", headers=dias).json()
        assert timed_out["phase"] == "reveal" and timed_out["you"]["answer"] is None
        assert timed_out["you"]["streak"] == 0

        client.post(f"/api/games/{code}/next", headers=host)
        final = client.get(f"/api/games/{code}").json()
        assert final["phase"] == "finished"
        assert [(p["name"], p["rank"]) for p in final["players"]] == [("Аружан", 1), ("Диас", 2)]
        assert "you" not in final and not final["is_host"]


def test_duel_needs_two_players_and_advances_on_its_own(settings, draft):
    with TestClient(create_app(settings, FakeProviders(draft))) as client:
        code, host, clock = setup(client, mode="duel", count=1)
        first = join(client, code, "Игрок 1")
        assert client.post(f"/api/games/{code}/start", headers=host).status_code == 409
        second = join(client, code, "Игрок 2")
        assert client.post(f"/api/games/{code}/join", json={"name": "Третий"}).status_code == 409
        assert client.post(f"/api/games/{code}/start", headers=host).status_code == 200
        client.post(f"/api/games/{code}/answer", headers=first, json={"index": 0, "choice": 1})
        client.post(f"/api/games/{code}/answer", headers=second, json={"index": 0, "choice": 0})
        assert client.get(f"/api/games/{code}").json()["phase"] == "reveal"
        clock.now += DUEL_REVEAL_SECONDS
        final = client.get(f"/api/games/{code}", headers=first).json()
        assert final["phase"] == "finished"
        assert final["players"][0]["name"] == "Игрок 2"
        assert final["you"]["rank"] == 2


def test_tied_players_share_rank_and_bad_input_is_rejected(settings, draft):
    with TestClient(create_app(settings, FakeProviders(draft))) as client:
        code, host, _ = setup(client, count=1)
        join(client, code, "A")
        join(client, code, "B")
        client.post(f"/api/games/{code}/start", headers=host)
        client.post(f"/api/games/{code}/next", headers=host)
        ranks = [p["rank"] for p in client.get(f"/api/games/{code}").json()["players"]]
        assert ranks == [1, 1]

        assert client.get("/api/games/000000").status_code == 404
        bad = {"name": "X", "avatar": "<script>"}
        assert client.post(f"/api/games/{code}/join", json=bad).status_code == 422
        broken = {
            "questions": [question(0) | {"correct": 3, "options": question(0)["options"][:2]}]
        }
        assert client.post("/api/games", json=broken).status_code == 422
        assert client.post("/api/games", json={"questions": []}).status_code == 422


def test_idle_rooms_expire():
    clock = Clock()
    rooms = GameRooms(clock)
    from app.games import CreateGame

    game, _ = rooms.create(CreateGame.model_validate({"questions": [question(0)]}))
    clock.now += 3601
    rooms.prune()
    assert game.code not in rooms.games
