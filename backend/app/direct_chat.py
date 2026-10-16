"""Explicit DeepSeek chat mode; does not claim document verification."""

import httpx

from app.config import Settings
from app.network_chat import answer as network_answer
from app.providers import InvalidModelOutput, ProviderUnavailable

NOTICES = {
    "ru": "Ответ DeepSeek без проверки по базе документов. "
    "Важные факты нужно сверить с официальными источниками.",
    "kk": "DeepSeek жауабы құжаттар базасы бойынша тексерілмеген. "
    "Маңызды деректерді ресми дереккөздермен салыстырыңыз.",
}


async def answer(
    settings: Settings, client: httpx.AsyncClient, message: str, lang: str, history: list[dict]
) -> dict:
    if settings.web_search_enabled:
        reply = await network_answer(settings, client, message, lang, history)
        if reply is not None:
            return reply
    language = "Russian" if lang == "ru" else "Kazakh"
    messages = [
        {
            "role": "system",
            "content": (
                "You are Adal AI, a helpful assistant for Kazakhstan. "
                f"Respond in {language}. Be clear and practical. "
                "You have no verified document retrieval or live web access in this chat mode. "
                "Never claim to have checked official documents, Google, or current legislation. "
                "Do not invent sources, URLs, legal citations, "
                "or exact current legal requirements. "
                "For legal questions explain concepts, state uncertainty, and suggest "
                "checking current official sources. Ask for clarification when needed."
            ),
        }
    ]
    for turn in history[-6:]:
        messages.extend(
            [
                {"role": "user", "content": turn["question"][:2000]},
                {"role": "assistant", "content": turn["answer"][:8000]},
            ]
        )
    messages.append({"role": "user", "content": message})
    try:
        response = await client.post(
            "https://api.deepseek.com/chat/completions",
            headers={"Authorization": f"Bearer {settings.deepseek_api_key.get_secret_value()}"},
            json={
                "model": settings.deepseek_model,
                "messages": messages,
                "max_tokens": 2048,
                "stream": False,
                "thinking": {"type": "disabled"},
            },
            timeout=settings.request_timeout_seconds,
        )
        response.raise_for_status()
    except httpx.TimeoutException as exc:
        raise TimeoutError("deepseek_timeout") from exc
    except httpx.HTTPError as exc:
        raise ProviderUnavailable("deepseek_request_failed") from exc
    try:
        choice = response.json()["choices"][0]
        content = choice["message"]["content"]
        if (
            choice.get("finish_reason") != "stop"
            or not isinstance(content, str)
            or not content.strip()
        ):
            raise ValueError("Incomplete answer")
    except (KeyError, IndexError, AttributeError, TypeError, ValueError) as exc:
        raise InvalidModelOutput("invalid_deepseek_reply") from exc
    return {
        "answer": f"{content.strip()}\n\n---\n*{NOTICES[lang]}*",
        "ai_mode": "real",
        "status": "answered",
        "sources": [],
        "verification_mode": "model_only",
    }
