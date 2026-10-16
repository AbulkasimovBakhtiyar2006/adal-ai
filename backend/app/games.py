"""Live quiz rooms: a host shows a code/QR, players join from their phones.

Rooms live in memory of the single uvicorn worker. Every method is synchronous and
never awaits, so on one event loop a request sees and changes a room atomically.
Phases advance lazily from timestamps whenever a room is read or changed.
"""

import hashlib
import hmac
import secrets
import time
from dataclasses import dataclass, field
from typing import Literal

from fastapi import APIRouter, Header, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Mode = Literal["live", "duel"]
Phase = Literal["lobby", "question", "reveal", "finished"]

AVATARS = (
    "alexey",
    "asylbek",
    "asel",
    "eagle",
    "horse",
    "leopard",
    "wolf",
    "fox",
    "camel",
    "owl",
    "bear",
    "tiger",
)
MAX_GAMES = 300
MAX_PLAYERS = {"live": 60, "duel": 2}
GAME_TTL = 3 * 3600
FINISHED_TTL = 30 * 60
DUEL_REVEAL_SECONDS = 5
LOBBY_TTL = 3600


class LocalizedText(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ru: str = Field(min_length=1, max_length=300)
    kk: str = Field(min_length=1, max_length=300)


class OptionText(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ru: str = Field(min_length=1, max_length=160)
    kk: str = Field(min_length=1, max_length=160)


class GameQuestion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: LocalizedText
    options: list[OptionText] = Field(min_length=2, max_length=4)
    correct: int = Field(ge=0, le=3)
    explanation: LocalizedText | None = None

    @model_validator(mode="after")
    def correct_in_range(self):
        if self.correct >= len(self.options):
            raise ValueError("correct out of range")
        return self


class CreateGame(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Mode = "live"
    title: str = Field(default="", max_length=80)
    seconds: Literal[10, 15, 20, 30] = 20
    questions: list[GameQuestion] = Field(min_length=1, max_length=30)


class JoinGame(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=40)
    avatar: str = "eagle"

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        cleaned = " ".join("".join(ch for ch in value if ch.isprintable()).split())[:20]
        if not cleaned:
            raise ValueError("empty name")
        return cleaned

    @field_validator("avatar")
    @classmethod
    def known_avatar(cls, value: str) -> str:
        if value not in AVATARS:
            raise ValueError("unknown avatar")
        return value


class Answer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    index: int = Field(ge=0, le=29)
    choice: int = Field(ge=0, le=3)


@dataclass
class Player:
    id: str
    token_hash: bytes
    name: str
    avatar: str
    joined: float
    score: int = 0
    streak: int = 0
    correct: int = 0
    # question index -> (choice, points, elapsed seconds)
    answers: dict[int, tuple[int, int, float]] = field(default_factory=dict)


@dataclass
class Game:
    code: str
    host_hash: bytes
    mode: Mode
    title: str
    seconds: int
    questions: list[GameQuestion]
    created: float
    touched: float
    phase: Phase = "lobby"
    index: int = -1
    phase_started: float = 0.0
    players: dict[str, Player] = field(default_factory=dict)


def digest(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()


def points_for(elapsed: float, limit: int, streak: int) -> int:
    # Kahoot-like: a correct answer earns 500..1000 by speed, plus a small streak bonus.
    speed = max(0.0, min(1.0, elapsed / limit))
    return round(1000 * (1 - speed / 2)) + min(max(streak - 1, 0), 5) * 100


class GameRooms:
    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.games: dict[str, Game] = {}

    # ---- lifecycle -------------------------------------------------------------
    def prune(self):
        now = self.clock()
        for code, game in list(self.games.items()):
            idle = now - game.touched
            if (
                idle > GAME_TTL
                or (game.phase == "finished" and idle > FINISHED_TTL)
                or (game.phase == "lobby" and idle > LOBBY_TTL)
            ):
                del self.games[code]

    def create(self, body: CreateGame) -> tuple[Game, str]:
        self.prune()
        if len(self.games) >= MAX_GAMES:
            raise HTTPException(503, "games_busy")
        code = f"{secrets.randbelow(900000) + 100000}"
        while code in self.games:
            code = f"{secrets.randbelow(900000) + 100000}"
        token = secrets.token_urlsafe(24)
        now = self.clock()
        game = Game(
            code=code,
            host_hash=digest(token),
            mode=body.mode,
            title=body.title.strip(),
            seconds=body.seconds,
            questions=body.questions,
            created=now,
            touched=now,
        )
        self.games[code] = game
        return game, token

    def get(self, code: str) -> Game:
        game = self.games.get(code)
        if not game:
            raise HTTPException(404, "game_not_found")
        self.advance(game)
        return game

    def identify(self, game: Game, token: str | None) -> tuple[bool, Player | None]:
        if not token:
            return False, None
        hashed = digest(token)
        if hmac.compare_digest(hashed, game.host_hash):
            return True, None
        for player in game.players.values():
            if hmac.compare_digest(hashed, player.token_hash):
                return False, player
        return False, None

    def require_host(self, game: Game, token: str | None):
        is_host, _ = self.identify(game, token)
        if not is_host:
            raise HTTPException(403, "host_only")

    # ---- state machine ---------------------------------------------------------
    def begin_question(self, game: Game, index: int):
        game.index = index
        game.phase = "question"
        game.phase_started = self.clock()

    def reveal(self, game: Game):
        # Points are settled here, not on answer, so scores and streaks can't leak the key.
        game.phase = "reveal"
        game.phase_started = self.clock()
        question = game.questions[game.index]
        for player in game.players.values():
            answer = player.answers.get(game.index)
            if answer is None or answer[0] != question.correct:
                player.streak = 0
                continue
            player.streak += 1
            player.correct += 1
            earned = points_for(answer[2], game.seconds, player.streak)
            player.score += earned
            player.answers[game.index] = (answer[0], earned, answer[2])

    def finish(self, game: Game):
        game.phase = "finished"
        game.phase_started = self.clock()

    def advance(self, game: Game):
        now = self.clock()
        if game.phase == "question":
            players = game.players.values()
            everyone = bool(players) and all(game.index in p.answers for p in players)
            if everyone or now - game.phase_started >= game.seconds:
                self.reveal(game)
        if (
            game.phase == "reveal"
            and game.mode == "duel"
            and now - game.phase_started >= DUEL_REVEAL_SECONDS
        ):
            self.next(game)

    def next(self, game: Game):
        if game.phase == "question":
            self.reveal(game)
        elif game.phase == "reveal":
            if game.index + 1 >= len(game.questions):
                self.finish(game)
            else:
                self.begin_question(game, game.index + 1)

    # ---- actions ---------------------------------------------------------------
    def join(self, game: Game, body: JoinGame) -> tuple[Player, str]:
        if game.phase != "lobby":
            raise HTTPException(409, "game_started")
        if len(game.players) >= MAX_PLAYERS[game.mode]:
            raise HTTPException(409, "game_full")
        taken = {p.name.casefold() for p in game.players.values()}
        if body.name.casefold() in taken:
            raise HTTPException(409, "name_taken")
        token = secrets.token_urlsafe(24)
        player = Player(
            id=secrets.token_hex(6),
            token_hash=digest(token),
            name=body.name,
            avatar=body.avatar,
            joined=self.clock(),
        )
        game.players[player.id] = player
        game.touched = self.clock()
        return player, token

    def start(self, game: Game):
        if game.phase != "lobby":
            raise HTTPException(409, "game_started")
        if len(game.players) < (2 if game.mode == "duel" else 1):
            raise HTTPException(409, "not_enough_players")
        self.begin_question(game, 0)
        game.touched = self.clock()

    def answer(self, game: Game, player: Player, body: Answer) -> None:
        if game.phase != "question" or body.index != game.index:
            raise HTTPException(409, "question_closed")
        if game.index in player.answers:
            raise HTTPException(409, "already_answered")
        if body.choice >= len(game.questions[game.index].options):
            raise HTTPException(422, "invalid_choice")
        elapsed = self.clock() - game.phase_started
        player.answers[game.index] = (body.choice, 0, elapsed)
        game.touched = self.clock()
        self.advance(game)

    # ---- views -----------------------------------------------------------------
    def ranking(self, game: Game) -> list[Player]:
        return sorted(game.players.values(), key=lambda p: (-p.score, -p.correct, p.joined))

    def view(self, game: Game, is_host: bool, me: Player | None) -> dict:
        now = self.clock()
        ranked = self.ranking(game)
        ranks: dict[str, int] = {}
        for position, player in enumerate(ranked):
            previous = ranked[position - 1] if position else None
            same = previous and (previous.score, previous.correct) == (player.score, player.correct)
            ranks[player.id] = ranks[previous.id] if same else position + 1
        state: dict = {
            "code": game.code,
            "mode": game.mode,
            "title": game.title,
            "phase": game.phase,
            "index": game.index,
            "total": len(game.questions),
            "seconds": game.seconds,
            "is_host": is_host,
            "players": [
                {
                    "id": p.id,
                    "name": p.name,
                    "avatar": p.avatar,
                    "score": p.score,
                    "correct": p.correct,
                    "rank": ranks[p.id],
                    "answered": game.index in p.answers,
                }
                for p in ranked
            ],
            "remaining_ms": 0,
            "question": None,
        }
        if game.phase == "question":
            left = game.seconds - (now - game.phase_started)
            state["remaining_ms"] = max(0, round(left * 1000))
        elif game.phase == "reveal" and game.mode == "duel":
            left = DUEL_REVEAL_SECONDS - (now - game.phase_started)
            state["remaining_ms"] = max(0, round(left * 1000))
        if game.phase in ("question", "reveal"):
            question = game.questions[game.index]
            shown = {
                "text": question.text.model_dump(),
                "options": [option.model_dump() for option in question.options],
            }
            if game.phase == "reveal":
                counts = [0] * len(question.options)
                for player in game.players.values():
                    if game.index in player.answers:
                        counts[player.answers[game.index][0]] += 1
                shown |= {
                    "correct": question.correct,
                    "counts": counts,
                    "explanation": question.explanation.model_dump()
                    if question.explanation
                    else None,
                }
            state["question"] = shown
            state["answered_count"] = sum(game.index in p.answers for p in game.players.values())
        if me:
            mine = me.answers.get(game.index) if game.index >= 0 else None
            state["you"] = {
                "id": me.id,
                "name": me.name,
                "avatar": me.avatar,
                "score": me.score,
                "correct": me.correct,
                "streak": me.streak,
                "rank": ranks[me.id],
                "answer": None
                if mine is None
                else {
                    "choice": mine[0],
                    # Correctness stays hidden until the reveal so phones can't leak it.
                    "points": mine[1] if game.phase != "question" else None,
                    "correct": mine[0] == game.questions[game.index].correct
                    if game.phase != "question"
                    else None,
                },
            }
        return state


def install_games(router: APIRouter):
    def rooms(request: Request) -> GameRooms:
        return request.app.state.games

    def no_store(response: Response):
        response.headers["Cache-Control"] = "no-store"

    @router.post("/games")
    async def create_game(body: CreateGame, request: Request, response: Response):
        game, token = rooms(request).create(body)
        no_store(response)
        return {"code": game.code, "token": token}

    @router.get("/games/{code}")
    async def game_state(
        code: str,
        request: Request,
        response: Response,
        x_game_token: str | None = Header(default=None),
    ):
        store = rooms(request)
        game = store.get(code)
        is_host, me = store.identify(game, x_game_token)
        no_store(response)
        return store.view(game, is_host, me)

    @router.post("/games/{code}/join")
    async def join_game(code: str, body: JoinGame, request: Request, response: Response):
        store = rooms(request)
        game = store.get(code)
        player, token = store.join(game, body)
        no_store(response)
        return {"player_id": player.id, "token": token}

    @router.post("/games/{code}/start")
    async def start_game(
        code: str, request: Request, x_game_token: str | None = Header(default=None)
    ):
        store = rooms(request)
        game = store.get(code)
        store.require_host(game, x_game_token)
        store.start(game)
        return {"ok": True}

    @router.post("/games/{code}/next")
    async def next_step(
        code: str, request: Request, x_game_token: str | None = Header(default=None)
    ):
        store = rooms(request)
        game = store.get(code)
        store.require_host(game, x_game_token)
        if game.phase not in ("question", "reveal"):
            raise HTTPException(409, "nothing_to_advance")
        store.next(game)
        game.touched = store.clock()
        return {"ok": True}

    @router.post("/games/{code}/answer")
    async def answer_question(
        code: str,
        body: Answer,
        request: Request,
        x_game_token: str | None = Header(default=None),
    ):
        store = rooms(request)
        game = store.get(code)
        _, me = store.identify(game, x_game_token)
        if not me:
            raise HTTPException(403, "player_only")
        store.answer(game, me, body)
        return {"ok": True}
