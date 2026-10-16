"""Public overview of what the assistant relies on. Only titles and official URLs, no texts."""

from app.catalog import catalog
from app.web_search import ADAL_PAGES, HOSTS, TAZA_PAGES

SITES = {
    "akorda.kz": "Акорда · Президент Республики Казахстан",
    "adilet.zan.kz": "Әділет · база нормативных правовых актов",
    "adilet.gov.kz": "Әділет · Министерство юстиции",
    "old.adilet.zan.kz": "Әділет · архив редакций",
    "gov.kz": "Единая платформа госорганов gov.kz",
    "egov.kz": "Электронное правительство eGov",
    "primeminister.kz": "Премьер-министр Республики Казахстан",
    "bolashak.gov.kz": "Международная стипендия «Болашак»",
}

TOPICS = [
    ("adal-azamat", "Адал азамат", ADAL_PAGES),
    (
        "bolashak",
        "Болашак",
        ["https://bolashak.gov.kz/ru/o-stipendii", "https://bolashak.gov.kz/ru"],
    ),
    ("taza-kazakhstan", "Таза Қазақстан", TAZA_PAGES),
]


def _site(host: str) -> str:
    return host.removeprefix("www.")


def overview(settings, library_records: list[dict], chunks) -> dict:
    by_catalog = {}
    for record in library_records:
        if record.get("catalog_id") and record["status"] in ("active", "pending"):
            current = by_catalog.get(record["catalog_id"])
            if current != "active":
                by_catalog[record["catalog_id"]] = record["status"]

    documents = [
        {
            "id": item["id"],
            "kind": item["kind"],
            "title": item["title"],
            "language": item["language"],
            "url": item["url"],
            "status": {"active": "indexed", "pending": "downloaded"}.get(
                by_catalog.get(item["id"]), "source"
            ),
        }
        for item in catalog()
    ]

    # Indexed documents outside the curated catalog (uploaded by admins or local corpus).
    catalog_records = {f"lib-{r['id']}" for r in library_records if r.get("catalog_id")}
    extra: dict[str, dict] = {}
    for chunk in chunks:
        if chunk.document_id in catalog_records or chunk.document_id in extra:
            continue
        extra[chunk.document_id] = {
            "id": chunk.document_id,
            "kind": "uploaded",
            "title": chunk.title,
            "language": chunk.language,
            "url": chunk.url,
            "status": "indexed",
            "verified_at": chunk.verified_at.isoformat(),
        }

    search = settings.web_chat_mode == "deepseek" and settings.web_search_enabled
    hosts = sorted({_site(h) for h in HOSTS} | {_site(h) for h in settings.allowed_source_hosts})
    if settings.web_chat_mode == "deepseek":
        models = ["DeepSeek", "Gemini · Google Search"] if search else ["DeepSeek"]
    else:
        models = ["Gemini", "DeepSeek · независимая проверка", "Google Cloud Check Grounding"]
    return {
        "mode": settings.web_chat_mode,
        "web_search": search,
        "models": models,
        "sites": [
            {"host": host, "title": SITES.get(host, host), "url": f"https://{host}"}
            for host in hosts
        ],
        "topics": [{"id": key, "title": title, "urls": urls} for key, title, urls in TOPICS],
        "documents": documents + list(extra.values()),
    }
