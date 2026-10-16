"""Extract document text, retaining paragraphs and refusing opaque/scanned files."""

import io
import re
import zipfile
from dataclasses import dataclass
from pathlib import Path

from bs4 import BeautifulSoup
from docx import Document
from pypdf import PdfReader

MAX_UPLOAD = 12 * 1024 * 1024
MAX_TEXT = 2_000_000


class ParseError(ValueError):
    pass


@dataclass
class ParsedText:
    title: str
    text: str
    warnings: list[str]


def clean_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\xa0", " ")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.split("\n")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def parse_html(data: bytes) -> ParsedText:
    # Legal HTML sometimes has tables inside unclosed <p> tags. Recover structure
    # before extracting blocks, otherwise entire tables become a single paragraph.
    soup = BeautifulSoup(data, "lxml")
    title_node = soup.find("h1") or soup.find("h2") or soup.title
    title = title_node.get_text(" ", strip=True) if title_node else "Документ"
    selectors = [
        ".akorda-text",
        ".text-block",
        ".article__body",
        ".article-content",
        ".document-content",
        "#document",
        ".doc-body",
        "article",
        "main",
    ]
    candidates = [soup.select_one(selector) for selector in selectors]
    body = next((n for n in candidates if n and len(n.get_text()) > 300), None)
    # Some official pages leave their navigation tags unclosed. Isolate the
    # document before removing navigation ancestors that may contain it.
    scope = body if body is not None else soup
    for node in scope.select("script,style,nav,header,footer,noscript,form,iframe,svg"):
        node.decompose()
    if body is None:
        # Prefer a container with many direct paragraphs over entire navigation-heavy pages.
        nodes = soup.find_all(["div", "section"])
        body = max(
            nodes,
            key=lambda n: sum(len(p.get_text()) for p in n.find_all("p", recursive=False)),
            default=soup.body or soup,
        )
    heading_node = body.find(["h1", "h2"])
    if heading_node:
        title = heading_node.get_text(" ", strip=True)
    for br in body.find_all("br"):
        br.replace_with("\n")
    blocks = []
    for node in body.find_all(["p", "h1", "h2", "h3", "h4", "li", "tr"]):
        if node.find_parent(["p", "li", "tr"]) is not None:
            continue
        text = node.get_text(" | " if node.name == "tr" else " ", strip=True)
        if text:
            blocks.append(text)
    text = clean_text("\n\n".join(blocks) if blocks else body.get_text("\n", strip=True))
    if len(text) < 100:
        raise ParseError("page_has_no_document_text")
    return ParsedText(title[:300], text, [])


def parse_file(data: bytes, filename: str) -> ParsedText:
    if not data or len(data) > MAX_UPLOAD:
        raise ParseError("file_empty_or_too_large")
    extension = Path(filename).suffix.lower()
    warnings = []
    try:
        if extension in {".txt", ".md"}:
            try:
                text = data.decode("utf-8-sig")
            except UnicodeDecodeError:
                text = data.decode("cp1251")
                warnings.append("decoded_as_windows_1251_check_kazakh_letters")
        elif extension in {".html", ".htm"}:
            result = parse_html(data)
            if len(result.text) > MAX_TEXT:
                raise ParseError("document_too_long")
            return result
        elif extension == ".docx":
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                if (
                    len(archive.infolist()) > 1000
                    or sum(i.file_size for i in archive.infolist()) > 40 * 1024 * 1024
                ):
                    raise ParseError("docx_uncompressed_size_exceeded")
                if any(i.flag_bits & 1 for i in archive.infolist()):
                    raise ParseError("encrypted_document")
            doc = Document(io.BytesIO(data))
            # iter_inner_content preserves interleaving of paragraphs and tables.
            blocks = []
            for item in doc.iter_inner_content():
                if hasattr(item, "rows"):
                    blocks.extend(" | ".join(cell.text for cell in row.cells) for row in item.rows)
                else:
                    blocks.append(item.text)
            text = "\n\n".join(blocks)
            warnings.append("check_tables_footnotes_and_tracked_changes")
        elif extension == ".pdf":
            reader = PdfReader(io.BytesIO(data))
            if reader.is_encrypted:
                raise ParseError("encrypted_document")
            if len(reader.pages) > 600:
                raise ParseError("too_many_pages")
            pages, size = [], 0
            empty_pages = 0
            for page in reader.pages:
                page_text = page.extract_text() or ""
                empty_pages += not page_text.strip()
                size += len(page_text)
                if size > MAX_TEXT:
                    raise ParseError("document_too_long")
                pages.append(page_text)
            text = "\n\n".join(pages)
            if empty_pages:
                warnings.append("some_pages_need_ocr")
            warnings.append("check_pdf_reading_order_and_tables")
        else:
            raise ParseError("unsupported_format")
    except ParseError:
        raise
    except Exception as exc:
        raise ParseError("cannot_parse_document") from exc
    text = clean_text(text)
    if len(text) < 30:
        raise ParseError("no_text_found_ocr_may_be_required")
    if len(text) > MAX_TEXT:
        raise ParseError("document_too_long")
    return ParsedText(Path(filename).stem[:300], text, warnings)


def split_sections(text: str) -> list[tuple[str, str]]:
    """Preserve articles where possible; never cut a paragraph or silently drop text."""
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    sections: list[tuple[str, str]] = []
    current: list[str] = []
    heading = "Начало документа"
    part = 1
    for paragraph in paragraphs:
        if len(paragraph) > 8800:
            raise ParseError("paragraph_too_long_split_manually")
        is_article = re.match(r"^(?:Статья\s+\d+[\w.-]*|\d+\s*[-–]\s*бап)\b", paragraph, re.I)
        if is_article and current:
            sections.append((heading, "\n\n".join(current)))
            current = []
            part = 1
        if is_article:
            heading = paragraph[:180]
        if current and sum(len(p) + 2 for p in current) + len(paragraph) > 8800:
            sections.append(
                (heading + (f" · часть {part}" if part > 1 else ""), "\n\n".join(current))
            )
            current = []
            part += 1
        current.append(paragraph)
    if current:
        sections.append((heading + (f" · часть {part}" if part > 1 else ""), "\n\n".join(current)))
    # A short trailing heading still belongs to the preceding chunk.
    merged: list[tuple[str, str]] = []
    prefix = ""
    for heading, body in sections:
        body = prefix + body
        prefix = ""
        if len(body) < 30 and merged and len(merged[-1][1]) + len(body) + 2 <= 9500:
            old_heading, old_body = merged.pop()
            merged.append((old_heading, old_body + "\n\n" + body))
        elif len(body) < 30:
            prefix = body + "\n\n"
        else:
            merged.append((heading, body))
    if prefix or not merged:
        raise ParseError("section_too_short_review_structure")
    return merged
