from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from app.config import Settings
from app.models import DocumentChunk
from app.parsing import ParsedText, split_sections
from app.storage import atomic_write


def today():
    return datetime.now(ZoneInfo("Asia/Almaty")).date()


class Library:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.root = settings.library_dir

    def directory(self, record_id: str) -> Path:
        if not re.fullmatch(r"[0-9a-f]{24}", record_id):
            raise ValueError("invalid_document_id")
        return self.root / record_id

    def get(self, record_id: str) -> dict:
        return json.loads((self.directory(record_id) / "record.json").read_text())

    def list(self) -> list[dict]:
        if not self.root.exists():
            return []
        records = [json.loads(p.read_text()) for p in self.root.glob("*/record.json")]
        return sorted(records, key=lambda r: (r["title"], r["language"]))

    def text(self, record_id: str) -> str:
        return (self.directory(record_id) / "text.txt").read_text(encoding="utf-8")

    def save_record(self, record: dict) -> None:
        atomic_write(
            self.directory(record["id"]) / "record.json",
            json.dumps(record, ensure_ascii=False, indent=2).encode(),
        )

    def add(
        self,
        parsed: ParsedText,
        original: bytes,
        filename: str,
        language: str,
        title: str = "",
        url: str = "",
        revision: str = "",
        catalog_id: str | None = None,
        metadata: dict | None = None,
    ) -> dict:
        digest = hashlib.sha256(original).hexdigest()
        # Official pages contain changing counters/tokens. Identical document
        # text and validity metadata are the same snapshot, despite HTML changes.
        if catalog_id:
            for existing in self.list():
                if (
                    existing.get("catalog_id") == catalog_id
                    and existing["language"] == language
                    and existing["url"] == url
                    and existing.get("source_metadata", {}) == (metadata or {})
                    and self.text(existing["id"]) == parsed.text
                ):
                    return existing
        record_id = hashlib.sha256(f"{digest}:{url}:{language}".encode()).hexdigest()[:24]
        directory = self.directory(record_id)
        chunks = split_sections(parsed.text)
        if (directory / "record.json").exists():
            existing = self.get(record_id)
            if self.text(record_id) != parsed.text:
                existing.update(
                    status="pending",
                    verified_at=None,
                    characters=len(parsed.text),
                    chunk_count=len(chunks),
                    warnings=list(
                        dict.fromkeys(parsed.warnings + ["parsed_text_changed_review_again"])
                    ),
                )
                atomic_write(directory / "text.txt", parsed.text.encode())
                self.save_record(existing)
            return existing
        record = {
            "id": record_id,
            "title": (title or parsed.title)[:300],
            "language": language,
            "url": url,
            "revision": revision,
            "status": "pending",
            "verified_at": None,
            "downloaded_at": datetime.now(ZoneInfo("Asia/Almaty")).isoformat(),
            "filename": Path(filename).name,
            "sha256": digest,
            "characters": len(parsed.text),
            "chunk_count": len(chunks),
            "warnings": parsed.warnings,
            "catalog_id": catalog_id,
            "source_metadata": metadata or {},
        }
        atomic_write(directory / "original.bin", original)
        atomic_write(directory / "text.txt", parsed.text.encode())
        self.save_record(record)
        if catalog_id:
            for existing in self.list():
                if (
                    existing["id"] != record_id
                    and existing.get("catalog_id") == catalog_id
                    and existing["language"] == language
                    and existing["status"] == "active"
                ):
                    self.deactivate(existing["id"])
        return record

    def publish(self, record_id: str, title: str, url: str, revision: str, language: str) -> dict:
        record = self.get(record_id)
        source = urlsplit(url)
        if (
            source.scheme != "https"
            or source.hostname not in self.settings.allowed_source_hosts
            or source.username
            or source.password
            or source.port not in (None, 443)
        ):
            raise ValueError("official_source_url_required")
        if not title.strip() or not revision.strip():
            raise ValueError("title_and_verified_revision_required")
        if record.get("source_metadata", {}).get("is_actual") is False:
            raise ValueError("source_marked_not_actual")
        # New snapshot replaces an older active snapshot of the same document/language.
        updated = record | {
            "title": title,
            "url": url,
            "revision": revision,
            "language": language,
            "status": "active",
            "verified_at": today().isoformat(),
        }
        self._chunks(updated)  # Validate everything before changing active status.
        self.save_record(updated)
        for other in self.list():
            if (
                other["id"] != record_id
                and other["status"] == "active"
                and other["language"] == language
                and (
                    other["url"] == url
                    or (
                        record.get("catalog_id") and other.get("catalog_id") == record["catalog_id"]
                    )
                )
            ):
                other["status"] = "archived"
                self.save_record(other)
        return updated

    def deactivate(self, record_id: str) -> dict:
        record = self.get(record_id)
        record["status"] = "pending"
        record["verified_at"] = None
        self.save_record(record)
        return record

    def _chunks(self, record: dict) -> list[DocumentChunk]:
        return [
            DocumentChunk.model_validate_json(
                json.dumps(
                    {
                        "id": f"lib-{record['id']}-{i + 1}",
                        "document_id": f"lib-{record['id']}",
                        "title": record["title"],
                        "section": heading,
                        "language": record["language"],
                        "text": body,
                        "url": record["url"],
                        "revision": record["revision"],
                        "verified_at": record["verified_at"],
                    }
                )
            )
            for i, (heading, body) in enumerate(split_sections(self.text(record["id"])))
        ]

    def active_chunks(self) -> list[DocumentChunk]:
        return [
            chunk
            for record in self.list()
            if record["status"] == "active"
            for chunk in self._chunks(record)
        ]
