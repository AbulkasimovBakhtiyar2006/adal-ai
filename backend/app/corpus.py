"""Only local, reviewed JSONL is read. No user-controlled URLs are fetched."""

import argparse
import json
from datetime import date
from pathlib import Path
from urllib.parse import urlsplit

from app.config import Settings
from app.models import DocumentChunk


def load_corpus(path: Path, allowed_hosts: list[str]) -> list[DocumentChunk]:
    if not path.exists():
        return []
    chunks: list[DocumentChunk] = []
    seen: set[str] = set()
    editions: dict[str, str] = {}
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            chunk = DocumentChunk.model_validate_json(line)
            url = urlsplit(chunk.url)
            if (
                url.scheme != "https"
                or url.hostname not in allowed_hosts
                or url.username
                or url.password
                or url.port not in (None, 443)
            ):
                raise ValueError("Source URL must belong to an allowed official HTTPS host")
            if chunk.id in seen:
                raise ValueError("Duplicate chunk ID")
            if chunk.document_id in editions and editions[chunk.document_id] != chunk.revision:
                raise ValueError("Mixed revisions of one document")
            if chunk.verified_at > date.today():
                raise ValueError("Verification date is in the future")
            if any(ord(c) < 32 and c not in "\n\r\t" for c in chunk.text):
                raise ValueError("Control characters in document")
        except (ValueError, TypeError) as exc:
            # Avoid printing source text or secrets if an operator imports a malformed file.
            raise ValueError(f"Invalid corpus record at line {line_number}") from exc
        seen.add(chunk.id)
        editions[chunk.document_id] = chunk.revision
        chunks.append(chunk)
    return chunks


def is_fresh(chunk: DocumentChunk, max_age_days: int) -> bool:
    return 0 <= (date.today() - chunk.verified_at).days <= max_age_days


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate a reviewed JSONL corpus")
    parser.add_argument("path", type=Path)
    args = parser.parse_args()
    settings = Settings()
    try:
        chunks = load_corpus(args.path, settings.allowed_source_hosts)
    except ValueError as exc:
        parser.exit(1, f"{exc}\n")
    counts = {lang: sum(c.language == lang for c in chunks) for lang in ("ru", "kk")}
    stale = sum(not is_fresh(c, settings.source_max_age_days) for c in chunks)
    print(json.dumps({"chunks": len(chunks), "languages": counts, "stale": stale}))
    if not chunks or stale:
        parser.exit(1, "Corpus is empty or contains expired review dates.\n")


if __name__ == "__main__":
    main()
