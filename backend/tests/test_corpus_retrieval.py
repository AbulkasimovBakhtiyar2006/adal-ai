from datetime import date, timedelta

import pytest

from app.corpus import load_corpus
from app.retrieval import Retriever, detect_language


def test_corpus_roundtrip(settings, sources):
    settings.corpus_path.write_text(
        "\n".join(s.model_dump_json() for s in sources), encoding="utf-8"
    )
    assert load_corpus(settings.corpus_path, settings.allowed_source_hosts) == sources


@pytest.mark.parametrize(
    "url",
    [
        "https://official.example.evil.com/doc",
        "http://official.example/doc",
        "https://user:password@official.example/doc",
        "https://official.example:8080/doc",
    ],
)
def test_untrusted_source_url_rejected(settings, sources, url):
    sources[0].url = url
    settings.corpus_path.write_text(sources[0].model_dump_json(), encoding="utf-8")
    with pytest.raises(ValueError, match="line 1"):
        load_corpus(settings.corpus_path, settings.allowed_source_hosts)


def test_duplicate_and_future_records_rejected(settings, sources):
    settings.corpus_path.write_text((sources[0].model_dump_json() + "\n") * 2, encoding="utf-8")
    with pytest.raises(ValueError, match="line 2"):
        load_corpus(settings.corpus_path, settings.allowed_source_hosts)
    sources[0].verified_at = date.today() + timedelta(days=1)
    settings.corpus_path.write_text(sources[0].model_dump_json(), encoding="utf-8")
    with pytest.raises(ValueError, match="line 1"):
        load_corpus(settings.corpus_path, settings.allowed_source_hosts)


def test_one_document_bm25_and_russian_inflection(sources):
    retriever = Retriever([sources[0]], 30)
    assert retriever.search("заявления", "ru", 5, 30000) == [sources[0]]


def test_kazakh_synonym(sources):
    assert Retriever(sources, 30).search("шағым", "kk", 5, 30000) == [sources[1]]


def test_language_detection_and_explicit_filter(sources):
    assert detect_language("Как подать заявление?") == "ru"
    assert detect_language("Өтініш қалай беріледі?") == "kk"
    assert all(c.language == "kk" for c in Retriever(sources, 30).search("өтініш", "kk", 5, 30000))
