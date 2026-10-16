"""Choose browser reply language independently of the interface locale."""

import re

# Do not infer the question language from a quoted program name or source passage.
QUOTED = re.compile(r'«[^»]*»|“[^”]*”|"[^"]*"|`[^`]*`')
WORDS = {
    "kk": set(
        "сәлем салем сәлеметсіз калай қалай қандай қайда қашан неге неліктен кім "
        "туралы деген айтып бер берші түсіндір тусиндир түсіндірші керек болады "
        "болама менің осы бұл және немесе иә иа рахмет жалғастыр жалгастыр "
        "қысқаша кыскаша бағдарламасы багдарламасы мақсаты максаты қазақша казакша "
        "salem qalai kalai turaly degen aityp aitip bershi tusindir bagdarlamasy "
        "bagdarlamasy qazaqsha kazaksha".split()
    ),
    "ru": set(
        "привет здравствуйте что такое как какой какая какие где когда почему зачем "
        "кто расскажи объясни обьясни скажи назови покажи пожалуйста спасибо "
        "продолжи подробнее кратко напиши переведи ответь отвечай пиши программа "
        "программы цели цель про этого этой это да нет".split()
    ),
}


def explicit_language(text: str) -> str | None:
    # Imperative requests only: 'Неге орысша жауап бересің?' is a Kazakh question,
    # not a request to switch to Russian. Quoted instructions are excluded by caller.
    requests = []
    for lang, label in (
        ("kk", "казахском|қазақша|казакша|qazaqsha|kazaksha"),
        ("ru", "русском|орысша"),
    ):
        patterns = (
            rf"\b(?:ответь|отвечай|пиши|напиши|объясни|расскажи|переведи)\b"
            rf"[^.!?\n]{{0,50}}?\b(?:на\s+)?(?:{label})\b",
            rf"\b(?:{label})\s+(?:жауап\s+бер(?:ші|іңіз)?|жаз(?:шы|ыңыз)?|"
            rf"түсіндір(?:ші|іңіз)?)\b",
            rf"^(?:пожалуйста,?\s+)?(?:на\s+)?(?:{label})(?:\s+пожалуйста)?[.!?]*$",
        )
        for pattern in patterns:
            for match in re.finditer(pattern, text):
                if not re.search(r"\b(?:не|нельзя)\s*$", text[: match.start()]):
                    requests.append((match.start(), lang))
    return max(requests)[1] if requests else None


def detected_language(message: str) -> str | None:
    text = QUOTED.sub(" ", message.lower())
    requested = explicit_language(text.strip())
    if requested:
        return requested
    tokens = re.findall(r"[^\W_]+", text)
    scores = {lang: sum(word in words for word in tokens) for lang, words in WORDS.items()}
    if scores["ru"] != scores["kk"]:
        return max(scores, key=scores.get)
    if re.search("[әғқңөұүһі]", text):
        return "kk"
    return None


def reply_language(message: str, interface_lang: str, history: list[dict]) -> str:
    language = detected_language(message)
    if language:
        return language
    # A bare name or number carries no language signal; keep this conversation's
    # last answer language. Only a new, ambiguous chat falls back to UI locale.
    for turn in reversed(history[-6:]):
        language = turn.get("response_language") or detected_language(turn["question"])
        if language in {"ru", "kk"}:
            return language
    return interface_lang
