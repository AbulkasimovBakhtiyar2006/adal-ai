import json

from fastapi.testclient import TestClient

from app.catalog import catalog
from app.main import create_app
from tests.conftest import FakeProviders
from tests.test_api import write_sources


def test_knowledge_lists_sources_without_document_text(settings, sources, draft):
    write_sources(settings, sources)
    item = catalog()[0]
    record = settings.library_dir / ("a" * 24)
    record.mkdir(parents=True)
    (record / "record.json").write_text(
        json.dumps(
            {
                "id": "a" * 24,
                "title": item["title"],
                "language": item["language"],
                "url": item["url"],
                "status": "pending",
                "catalog_id": item["id"],
            }
        )
    )
    with TestClient(create_app(settings, FakeProviders(draft))) as client:
        body = client.get("/api/knowledge").json()
    statuses = {doc["id"]: doc["status"] for doc in body["documents"]}
    assert statuses[item["id"]] == "downloaded"
    assert statuses[catalog()[1]["id"]] == "source"
    uploaded = [doc for doc in body["documents"] if doc["kind"] == "uploaded"]
    assert {doc["id"] for doc in uploaded} == {"test-ru", "test-kk"}
    assert all(doc["status"] == "indexed" for doc in uploaded)
    assert "akorda.kz" in {site["host"] for site in body["sites"]}
    assert {topic["id"] for topic in body["topics"]} == {
        "adal-azamat",
        "bolashak",
        "taza-kazakhstan",
    }
    assert sources[0].text not in json.dumps(body, ensure_ascii=False)
