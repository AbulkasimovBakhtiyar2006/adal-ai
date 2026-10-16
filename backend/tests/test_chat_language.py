import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app import web
from app.chat_language import reply_language
from app.main import create_app


@pytest.mark.parametrize(
    ("message", "interface", "expected"),
    [
        ("Адал азамат бағдарламасы туралы айтып бер", "ru", "kk"),
        ("Адал азамат деген не?", "ru", "kk"),
        ("Адал азамат багдарламасы туралы айтып бер", "ru", "kk"),
        ("Adal azamat bagdarlamasy turaly aityp ber", "ru", "kk"),
        ("Қандай құжаттар қажет?", "ru", "kk"),
        ("Что такое Таза Қазақстан?", "kk", "ru"),
        ("Расскажи о программе «Адал азамат»", "kk", "ru"),
        ("Қазақша жауап берші: что такое Адал азамат?", "ru", "kk"),
        ("Адал азамат деген не? Ответь на русском.", "kk", "ru"),
        ("Неге орысша жауап бересің?", "ru", "kk"),
        ("Не отвечай на русском. Қазақша жауап бер.", "ru", "kk"),
        ("Что означает «қазақша жауап бер»?", "kk", "ru"),
    ],
)
def test_question_language_overrides_interface(message, interface, expected):
    assert reply_language(message, interface, []) == expected


def test_ambiguous_followup_retains_conversation_language():
    history = [{"question": "Қазақша жауап бер", "response_language": "kk"}]
    assert reply_language("2026", "ru", history) == "kk"
    assert reply_language("2026", "ru", []) == "ru"
    assert reply_language("Теперь расскажи подробнее", "kk", history) == "ru"


def test_browser_uses_question_language_and_keeps_retry_contract(settings, monkeypatch):
    calls = []

    async def answer(settings, client, message, lang, history, response_mode="text"):
        calls.append(lang)
        return {"answer": "Жауап" if lang == "kk" else "Ответ", "sources": [], "status": "answered"}

    settings.web_chat_mode = "deepseek"
    settings.deepseek_api_key = SecretStr("test")
    monkeypatch.setattr(web, "direct_answer", answer)
    with TestClient(create_app(settings)) as client:
        client.get("/api/history")
        body = {"message": "Адал азамат деген не?", "lang": "ru", "client_id": "language-1"}
        reply = client.post("/api/chat", json=body)
        assert reply.json()["response_language"] == "kk"
        assert client.post("/api/chat", json=body).json() == reply.json()
        assert calls == ["kk"]
        body.update(message="2026", client_id="language-2")
        assert client.post("/api/chat", json=body).json()["response_language"] == "kk"
        body.update(message="Расскажи подробнее", lang="kk", client_id="language-3")
        assert client.post("/api/chat", json=body).json()["response_language"] == "ru"
        assert calls == ["kk", "kk", "ru"]
