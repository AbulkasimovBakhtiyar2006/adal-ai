import math
import re
import unicodedata
from collections import Counter

import snowballstemmer

from app.corpus import is_fresh
from app.models import DocumentChunk, Language

STEMMER = snowballstemmer.stemmer("russian")
STOPWORDS = set(
    "и в во на с со к по а но или за от до из у для о об это как что кто где когда "
    "ли мне меня мой мы вы он она они я не бы же так есть туралы және мен не "
    "қалай қандай қайда бұл осы үшін ма ме ба бе па пе".split()
)
CONCEPTS = {
    "corruption": (
        r"коррупц\w*",
        r"взят\w*",
        r"жемқор\w*",
        r"пара\w*",
        r"чиновник\w*\s+треб\w*\s+ден\w*",
        r"шенеунік\w*\s+ақша\s+сұра\w*",
    ),
    "appeal": (r"обращени\w*", r"заявлени\w*", r"жалоб\w*", r"өтініш\w*", r"шағым\w*"),
    "constitution": (r"конституци\w*", r"ата\s+заң\w*"),
    "honesty": (r"честност\w*", r"адал\w*"),
}


def detect_language(question: str) -> Language:
    lower = question.lower()
    if re.search("[әғқңөұүһі]", lower) or re.search(r"\b(мен|сен|болады|керек|туралы)\b", lower):
        return "kk"
    return "ru"


def tokenize(text: str) -> list[str]:
    lower = unicodedata.normalize("NFC", text).lower().replace("ё", "е")
    words = re.findall(r"[^\W_]+", lower)
    tokens = STEMMER.stemWords([w for w in words if w not in STOPWORDS and len(w) > 1])
    for name, patterns in CONCEPTS.items():
        if any(re.search(r"\b(?:" + pattern + r")\b", lower) for pattern in patterns):
            tokens.append("concept_" + name)
    return tokens


class Retriever:
    """BM25 with positive IDF, suitable even for a one-document starter corpus."""

    def __init__(self, chunks: list[DocumentChunk], max_age_days: int):
        self.chunks = chunks
        self.max_age_days = max_age_days
        self.tokens = {c.id: Counter(tokenize(f"{c.title} {c.section} {c.text}")) for c in chunks}

    def search(
        self, question: str, language: Language, top_k: int, max_characters: int
    ) -> list[DocumentChunk]:
        candidates = [
            c for c in self.chunks if c.language == language and is_fresh(c, self.max_age_days)
        ]
        query = set(tokenize(question))
        if not candidates or not query:
            return []
        n = len(candidates)
        lengths = {c.id: sum(self.tokens[c.id].values()) for c in candidates}
        average = sum(lengths.values()) / n or 1
        frequencies = Counter(t for c in candidates for t in self.tokens[c.id])
        ranked = []
        for chunk in candidates:
            score = 0.0
            for term in query:
                frequency = self.tokens[chunk.id].get(term, 0)
                if not frequency:
                    continue
                idf = math.log(1 + (n - frequencies[term] + 0.5) / (frequencies[term] + 0.5))
                score += (
                    idf
                    * frequency
                    * 2.5
                    / (frequency + 1.5 * (0.25 + 0.75 * lengths[chunk.id] / average))
                )
            if score > 0:
                ranked.append((score, chunk))
        ranked.sort(key=lambda item: (-item[0], item[1].id))
        selected, used = [], 0
        for _, chunk in ranked:
            if len(selected) >= top_k:
                break
            if used + len(chunk.text) <= max_characters:
                selected.append(chunk)
                used += len(chunk.text)
        return selected
