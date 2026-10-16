import argparse
import asyncio
import json
from datetime import datetime
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

import httpx

from app.catalog import catalog
from app.config import Settings
from app.library import Library
from app.parsing import MAX_UPLOAD, ParseError, parse_html
from app.storage import atomic_write


async def bounded_get(client: httpx.AsyncClient, url: str) -> bytes:
    # Only catalog URLs and IDs returned by the official API are used. No arbitrary URL fetch API.
    if urlsplit(url).hostname not in {"adilet.zan.kz", "www.akorda.kz"}:
        raise ValueError("source_host_not_allowed")
    async with client.stream("GET", url) as response:
        response.raise_for_status()
        if response.is_redirect:
            raise ValueError("unexpected_source_redirect")
        data = bytearray()
        async for part in response.aiter_bytes():
            data.extend(part)
            if len(data) > MAX_UPLOAD:
                raise ValueError("download_too_large")
        return bytes(data)


async def download_source(item: dict, client: httpx.AsyncClient, library: Library) -> dict:
    metadata = {}
    title = item["title"]
    if item["kind"] == "adilet":
        language = "rus" if item["language"] == "ru" else "kaz"
        endpoint = f"https://adilet.zan.kz/api/documents/by-ngr/{item['ngr']}?language={language}"
        raw = await bounded_get(client, endpoint)
        response = json.loads(raw)
        doc = response.get("document", response)
        if doc.get("language") != language or doc.get("group_number") != item["ngr"]:
            raise ValueError("source_identity_mismatch")
        html = doc.get("text_content")
        if not html:
            document_id = str(doc.get("id", ""))
            if not document_id or any(c not in "0123456789abcdef-" for c in document_id):
                raise ValueError("invalid_remote_document_id")
            content_raw = await bounded_get(
                client, f"https://adilet.zan.kz/api/documents/{document_id}/content"
            )
            content = json.loads(content_raw)
            html = content.get("text_content") or content.get("content")
            # Preserve both official metadata and content in the downloadable original.
            raw = json.dumps(
                {"document": doc, "downloaded_content": content}, ensure_ascii=False
            ).encode()
        if not isinstance(html, str) or not html.strip():
            raise ValueError("official_text_unavailable")
        parsed = parse_html(html.encode())
        title = doc.get("title_ru") or title
        metadata = {
            key: doc.get(key)
            for key in [
                "id",
                "language",
                "group_number",
                "is_actual",
                "status",
                "official_name",
                "adoption_date",
                "end_date",
                "updated_at",
                "publication_reference",
            ]
        }
        metadata["download_url"] = endpoint
        filename = f"{item['id']}.json"
    else:
        raw = await bounded_get(client, item["url"])
        parsed = parse_html(raw)
        filename = f"{item['id']}.html"
    if len(parsed.text) < 300:
        raise ParseError("official_document_too_short")
    parsed.warnings.append("verify_current_revision_before_activation")
    if metadata.get("is_actual") is False:
        parsed.warnings.append("source_marked_not_actual")
    return await asyncio.to_thread(
        library.add,
        parsed,
        raw,
        filename,
        item["language"],
        title,
        item["url"],
        "",
        item["id"],
        metadata,
    )


async def collect(settings: Settings, progress: dict | None = None) -> dict:
    progress = progress if progress is not None else {}
    items = catalog()
    progress.update(status="running", total=len(items), completed=0, downloaded=0, errors=[])
    library = Library(settings)
    semaphore = asyncio.Semaphore(3)
    async with httpx.AsyncClient(
        timeout=25, follow_redirects=False, headers={"User-Agent": "AdalAI-DocumentCollector/0.1"}
    ) as client:

        async def one(item):
            async with semaphore:
                try:
                    await download_source(item, client, library)
                    progress["downloaded"] += 1
                except (httpx.HTTPError, ValueError, TypeError, KeyError) as exc:
                    reason = (
                        f"http_{exc.response.status_code}"
                        if isinstance(exc, httpx.HTTPStatusError)
                        else type(exc).__name__
                    )
                    progress["errors"].append(
                        {
                            "id": item["id"],
                            "title": item["title"],
                            "url": item["url"],
                            "reason": reason,
                        }
                    )
                finally:
                    progress["completed"] += 1

        await asyncio.gather(*(one(item) for item in items))
    progress["status"] = "completed"
    progress["finished_at"] = datetime.now(ZoneInfo("Asia/Almaty")).isoformat()
    await asyncio.to_thread(
        atomic_write,
        settings.library_dir / "collection-report.json",
        json.dumps(progress, ensure_ascii=False, indent=2).encode(),
    )
    return progress


def main():
    parser = argparse.ArgumentParser(description="Download curated official sources for review")
    parser.parse_args()
    report = asyncio.run(collect(Settings()))
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
