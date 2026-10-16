"""Curated official source list for the competition, not an exhaustive legal database."""

ACTS = [
    ("Z1500000410", "Противодействие коррупции"),
    ("Z1500000401", "Доступ к информации"),
    ("K2000000350", "Административные процедуры и обращения граждан"),
    ("Z2600000290", "Государственная служба · 2026"),
    ("Z1500000383", "Общественные советы"),
    ("Z1300000088", "Государственные услуги"),
    ("Z1600000480", "Правовые акты"),
    ("Z1500000285", "Государственная молодёжная политика"),
    ("U1500000153", "Этический кодекс государственных служащих"),
    ("U2200000802", "Антикоррупционная политика · 2022–2026"),
    ("U2400000611", "Национальный план развития · до 2029"),
    ("U2000000390", "Развитие гражданского общества"),
    ("P2400000910", "Таза Қазақстан · 2024–2029"),
    ("U2100000674", "Концепция правовой политики · до 2030"),
]

AKORDA = [
    (
        "constitution-2026-ru",
        "ru",
        "Конституция Республики Казахстан · 2026",
        "https://www.akorda.kz/ru/konstituciya-respubliki-kazahstan-3053339",
    ),
    (
        "constitution-2026-kk",
        "kk",
        "Қазақстан Республикасының Конституциясы · 2026",
        "https://www.akorda.kz/kz/kazakstan-respublikasynyn-konstituciyasy-3053334",
    ),
    (
        "internal-policy-ru",
        "ru",
        "Основные принципы, ценности и направления внутренней политики",
        "https://www.akorda.kz/ru/ob-utverzhdenii-osnovnyh-principov-cennostey-i-napravleniy-vnutrenney-politiki-respubliki-kazahstan-5105824",
    ),
    (
        "kurultai-2023-ru",
        "ru",
        "Әділетті Қазақстан – Адал азамат · Курултай 2023",
        "https://www.akorda.kz/ru/vystuplenie-glavy-gosudarstva-kasym-zhomarta-tokaeva-na-vtorom-zasedanii-nacionalnogo-kurultayaadiletti-kazakstan-adal-azamat-175233",
    ),
    (
        "kurultai-2023-kk",
        "kk",
        "Әділетті Қазақстан – Адал азамат · Құрылтай 2023",
        "https://www.akorda.kz/kz/memleket-basshysy-kasym-zhomart-tokaevtyn-ulttyk-kuryltaydyn-adiletti-kazakstan-adal-azamat-atty-ekinshi-otyrysynda-soylegen-sozi-1752959",
    ),
    (
        "kurultai-2024-ru",
        "ru",
        "Адал адам – Адал еңбек – Адал табыс · Курултай 2024",
        "https://www.akorda.kz/ru/vystuplenieglavy-gosudarstva-ktokaevana-tretem-zasedaniinacionalnogo-kurultaya-1525116",
    ),
    (
        "kurultai-2024-kk",
        "kk",
        "Адал адам – Адал еңбек – Адал табыс · Құрылтай 2024",
        "https://www.akorda.kz/kz/memleket-basshysy-kasym-zhomart-tokaevtyn-ulttyk-kuryltaydyn-adal-adam-adal-enbek-adal-tabys-atty-ushinshi-otyrysynda-soylegen-sozi-1525727",
    ),
    (
        "address-2024-ru",
        "ru",
        "Послание · Справедливый Казахстан: закон и порядок · 2024",
        "https://www.akorda.kz/ru/poslanie-glavy-gosudarstva-kasym-zhomarta-tokaeva-narodu-kazahstana-spravedlivyy-kazahstan-zakon-i-poryadok-ekonomicheskiy-rost-obshchestvennyy-optimizm-285014",
    ),
    (
        "address-2025-ru",
        "ru",
        "Послание · Казахстан в эпоху искусственного интеллекта · 2025",
        "https://www.akorda.kz/ru/poslanie-glavy-gosudarstva-kasym-zhomarta-tokaeva-narodu-kazahstana-kazahstan-v-epohu-iskusstvennogo-intellekta-aktualnye-zadachi-i-ih-resheniya-cherez-cifrovuyu-transformaciyu-885145",
    ),
]


def catalog() -> list[dict]:
    result = [
        {
            "id": f"{ngr}-{language}",
            "kind": "adilet",
            "ngr": ngr,
            "language": language,
            "title": title,
            "url": f"https://adilet.zan.kz/{'rus' if language == 'ru' else 'kaz'}/docs/{ngr}",
        }
        for ngr, title in ACTS
        for language in ("ru", "kk")
    ]
    result += [
        {"id": key, "kind": "akorda", "language": language, "title": title, "url": url}
        for key, language, title, url in AKORDA
    ]
    return result
