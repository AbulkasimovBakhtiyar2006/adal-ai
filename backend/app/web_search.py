"""Bounded public search and live official-page retrieval. No model-created URLs."""

import asyncio
import re
from datetime import UTC, datetime
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx
from bs4 import BeautifulSoup
from lxml import etree

HOSTS = {
    "www.gov.kz",
    "gov.kz",
    "www.akorda.kz",
    "akorda.kz",
    "primeminister.kz",
    "www.primeminister.kz",
    "egov.kz",
    "www.egov.kz",
    "adilet.zan.kz",
    "adilet.gov.kz",
    "bolashak.gov.kz",
    "www.bolashak.gov.kz",
}
ADAL_PAGES = [
    "https://www.gov.kz/org/edu/press/news/details/1171026?lang=ru",
    "https://primeminister.kz/news/reviews/adal-azamat-birtutas-tarbie-bagdarlamasy-"
    "bilim-beru-uyymdaryndagy-tarbie-zhumysynyn-negizine-aynalady-29885",
]


def safe_url(url: str) -> bool:
    try:
        u = urlsplit(url)
        return (
            u.scheme == "https"
            and u.hostname in HOSTS
            and not u.username
            and not u.password
            and u.port in (None, 443)
        )
    except ValueError:
        return False


async def download(client: httpx.AsyncClient, url: str, *, search=False) -> tuple[bytes, str]:
    for _ in range(4):
        if not (search and urlsplit(url).hostname == "www.bing.com") and not safe_url(url):
            raise ValueError("unapproved_source")
        async with client.stream("GET", url, timeout=12, follow_redirects=False) as response:
            if response.is_redirect:
                url = urljoin(url, response.headers["location"])
                continue
            response.raise_for_status()
            content_type = response.headers.get("content-type", "")
            if not any(t in content_type for t in ("html", "xml", "text/plain")):
                raise ValueError("unsupported_source_type")
            data = bytearray()
            async for part in response.aiter_bytes():
                data.extend(part)
                if len(data) > 1_000_000:
                    raise ValueError("source_too_large")
            return bytes(data), url
    raise ValueError("redirect_limit")


def excerpt(html: bytes, query: str) -> tuple[str, str]:
    soup = BeautifulSoup(html, "html.parser")
    title = soup.title.get_text(" ", strip=True)[:250] if soup.title else "Официальный источник"
    for tag in soup.select("script,style,nav,footer,header,form,aside"):
        tag.decompose()
    text = (soup.find("article") or soup.find("main") or soup.body or soup).get_text(
        "\n", strip=True
    )
    paragraphs = [re.sub(r"\s+", " ", p).strip() for p in text.splitlines() if len(p.strip()) > 50]
    terms = set(re.findall(r"[\w]{4,}", query.lower()))
    if len(text) > 14000:
        ranked = sorted(
            range(len(paragraphs)),
            key=lambda i: sum(t in paragraphs[i].lower() for t in terms),
            reverse=True,
        )
        selected = set(ranked[:12]) | {0, 1}
        paragraphs = [p for i, p in enumerate(paragraphs) if i in selected]
    return title, "\n".join(paragraphs)[:9000]


async def search(client: httpx.AsyncClient, query: str) -> list[dict]:
    # The search query is a short topic generated from the question, never raw chat history.
    query = re.sub(r"https?://\S+", "", query)[:180].strip()
    if not query:
        return []
    generic = {
        "программа",
        "программы",
        "стипендия",
        "стипендии",
        "международная",
        "государственная",
        "официальная",
        "казахстан",
        "бағдарламасы",
        "бағдарлама",
    }
    topic = " ".join(w for w in query.split() if w.lower() not in generic) or query
    urls = []
    for term in dict.fromkeys([query + " site:gov.kz", topic]):
        url = str(httpx.URL("https://www.bing.com/search", params={"q": term, "format": "rss"}))
        try:
            async with asyncio.timeout(10):
                raw, _ = await download(client, url, search=True)
            root = etree.fromstring(
                raw, parser=etree.XMLParser(resolve_entities=False, no_network=True)
            )
            for item in root.findall(".//item"):
                link = item.findtext("link", "")
                parsed = urlsplit(link)
                if parsed.hostname == "beta.egov.kz" and parsed.path.startswith("/memleket/"):
                    link = urlunsplit(("https", "www.gov.kz", parsed.path, parsed.query, ""))
                if safe_url(link):
                    urls.append(link)
            if urls:
                break
        except (httpx.HTTPError, ValueError, etree.XMLSyntaxError, TimeoutError):
            continue
    # Known Ministry pages are fetched live, also when search is temporarily unavailable.
    if "адал" in query.lower() and "азамат" in query.lower():
        urls = ADAL_PAGES + urls
    urls = list(dict.fromkeys(u for u in urls if safe_url(u)))[:5]

    async def fetch(url):
        try:
            raw, final_url = await download(client, url)
            title, text = await asyncio.to_thread(excerpt, raw, query)
            if len(text) < 180:
                return None
            return {
                "title": title,
                "url": final_url,
                "text": text,
                "retrieved_at": datetime.now(UTC).isoformat(),
            }
        except (httpx.HTTPError, ValueError, KeyError):
            return None

    results = await asyncio.gather(*(fetch(url) for url in urls))
    sources = []
    seen = set()
    for item in results:
        if item and item["url"] not in seen:
            seen.add(item["url"])
            sources.append(item)
    return [{"id": i + 1, **item} for i, item in enumerate(sources[:4])]
