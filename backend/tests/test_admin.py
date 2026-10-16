import json
import stat

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.library import Library
from app.main import create_app
from app.parsing import ParsedText
from app.storage import read_settings

HEADERS = {"X-Adal-Admin": "1"}


def local_client(settings):
    return TestClient(create_app(settings), base_url="http://localhost", client=("127.0.0.1", 5000))


def test_admin_access_and_csrf(settings):
    with local_client(settings) as client:
        assert client.get("/admin").status_code == 200
        assert "frame-ancestors 'none'" in client.get("/admin").headers["content-security-policy"]
        assert client.get("/admin/api/status").status_code == 403
        assert client.get("/admin/api/status", headers=HEADERS).status_code == 200
        assert (
            client.get(
                "/admin/api/status", headers=HEADERS | {"Origin": "https://evil.example"}
            ).status_code
            == 403
        )
    with TestClient(
        create_app(settings), base_url="http://localhost", client=("192.0.2.1", 5000)
    ) as client:
        assert client.get("/admin/api/status", headers=HEADERS).status_code == 403
    with TestClient(
        create_app(settings), base_url="http://evil.example", client=("127.0.0.1", 5000)
    ) as client:
        assert client.get("/admin/api/status", headers=HEADERS).status_code == 403


def test_remote_admin_requires_distinct_token(settings):
    settings.admin_api_key = SecretStr("admin-test")
    settings.backend_api_key = SecretStr("backend-test")
    with TestClient(create_app(settings)) as client:
        assert client.get("/admin/api/status", headers=HEADERS).status_code == 401
        assert (
            client.get(
                "/admin/api/status", headers=HEADERS | {"Authorization": "Bearer backend-test"}
            ).status_code
            == 401
        )
        assert (
            client.get(
                "/admin/api/status", headers=HEADERS | {"Authorization": "Bearer admin-test"}
            ).status_code
            == 200
        )


def test_settings_persist_without_echoing_keys(settings):
    with local_client(settings) as client:
        response = client.patch(
            "/admin/api/settings",
            headers=HEADERS,
            json={
                "deepseek_api_key": "SECRET-TEST",
                "generator_provider": "deepseek",
                "critic_api_key": "",
                "deepseek_model": "test-model",
            },
        )
        assert response.status_code == 200
        assert "SECRET-TEST" not in response.text
        assert response.json()["configured_keys"]["deepseek_api_key"] is True
        assert "test-gemini" not in client.get("/admin/api/status", headers=HEADERS).text
        saved = read_settings(settings)
        assert saved.deepseek_api_key.get_secret_value() == "SECRET-TEST"
        assert saved.generator_provider == "deepseek"
        path = settings.runtime_dir / "settings.json"
        assert stat.S_IMODE(path.stat().st_mode) == 0o600
        assert stat.S_IMODE(path.parent.stat().st_mode) == 0o700
        client.patch("/admin/api/settings", headers=HEADERS, json={"deepseek_api_key": ""})
        assert read_settings(settings).deepseek_api_key.get_secret_value() == "SECRET-TEST"
        client.patch(
            "/admin/api/settings", headers=HEADERS, json={"clear_keys": ["deepseek_api_key"]}
        )
        assert not read_settings(settings).deepseek_api_key
        response = client.patch(
            "/admin/api/settings", headers=HEADERS, json={"critic_base_url": "https://evil.example"}
        )
        assert response.status_code == 422
        assert "evil.example" not in response.text


def test_upload_review_activation_and_deactivation(settings, sources):
    with local_client(settings) as client:
        response = client.post(
            "/admin/api/documents",
            headers=HEADERS,
            files={
                "file": ("sample.txt", sources[0].text.encode(), "text/plain"),
            },
            data={"language": "ru"},
        )
        assert response.status_code == 200
        record = response.json()
        assert record["status"] == "pending"
        assert client.get("/admin/api/status", headers=HEADERS).json()["fresh_chunks"] == 0
        prefix = f"/admin/api/documents/{record['id']}"
        assert client.get(prefix, headers=HEADERS).json()["text"] == sources[0].text
        assert client.get(prefix + "/original", headers=HEADERS).content == sources[0].text.encode()
        body = {
            "title": "Учебный документ",
            "url": sources[0].url,
            "revision": "test-only",
            "language": "ru",
        }
        assert client.post(prefix + "/activate", headers=HEADERS, json=body).status_code == 422
        body["reviewed"] = True
        assert (
            client.post(
                prefix + "/activate", headers=HEADERS, json=body | {"url": "https://evil.example"}
            ).status_code
            == 422
        )
        assert client.post(prefix + "/activate", headers=HEADERS, json=body).status_code == 200
        assert client.get("/admin/api/status", headers=HEADERS).json()["fresh_chunks"] == 1
        assert client.post(prefix + "/deactivate", headers=HEADERS).status_code == 200
        assert client.get("/admin/api/status", headers=HEADERS).json()["fresh_chunks"] == 0


@pytest.mark.parametrize("path", ["invalid", "a" * 24])
def test_missing_document_safe(settings, path):
    with local_client(settings) as client:
        assert client.get(f"/admin/api/documents/{path}", headers=HEADERS).status_code == 404


def test_reparse_requires_review_and_preserves_original(settings, sources):
    library = Library(settings)
    parsed = ParsedText("Test", sources[0].text, [])
    record = library.add(parsed, b"ORIGINAL", "sample.txt", "ru", url=sources[0].url)
    library.publish(record["id"], "Test", sources[0].url, "test-only", "ru")
    assert (
        library.add(parsed, b"ORIGINAL", "sample.txt", "ru", url=sources[0].url)["status"]
        == "active"
    )
    parsed.text += " Новый абзац, восстановленный при повторном разборе."
    updated = library.add(parsed, b"ORIGINAL", "sample.txt", "ru", url=sources[0].url)
    assert updated["status"] == "pending"
    assert updated["verified_at"] is None
    assert (library.directory(record["id"]) / "original.bin").read_bytes() == b"ORIGINAL"


def test_inactive_source_rejected(settings, sources):
    library = Library(settings)
    record = library.add(
        ParsedText("Test", sources[0].text, []),
        b"ORIGINAL",
        "sample.txt",
        "ru",
        metadata={"is_actual": False},
    )
    with pytest.raises(ValueError, match="not_actual"):
        library.publish(record["id"], "Test", sources[0].url, "test", "ru")


def test_audio_endpoint_auth_and_missing_config(settings):
    settings.gemini_api_key = SecretStr("")
    settings.backend_api_key = SecretStr("backend-test")
    with local_client(settings) as client:
        files = {"file": ("a.wav", b"fake", "audio/wav")}
        assert client.post("/api/audio/transcribe", files=files).status_code == 401
        response = client.post(
            "/api/audio/transcribe", files=files, headers={"Authorization": "Bearer backend-test"}
        )
        assert response.status_code == 503
        assert "fake" not in json.dumps(response.json())
