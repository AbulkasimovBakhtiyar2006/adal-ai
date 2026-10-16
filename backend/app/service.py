import asyncio

from app.config import Settings
from app.models import AnswerClaim, AskRequest, AskResponse, Source, Verification
from app.providers import InvalidModelOutput, Providers, ProviderUnavailable
from app.retrieval import Retriever, detect_language
from app.verification import answer_text, check_critic, check_grounding, check_local, normalize

MESSAGES = {
    "ru": {
        "insufficient_evidence": "Не удалось подтвердить ответ по доступным материалам. "
        "Уточните вопрос или обратитесь к указанным источникам, если они приведены ниже.",
        "temporarily_unavailable": "Сервис проверки временно недоступен. Попробуйте позже.",
    },
    "kk": {
        "insufficient_evidence": "Қолда бар материалдар бойынша жауапты растау мүмкін болмады. "
        "Сұрақты нақтылаңыз немесе төменде көрсетілген дереккөздер болса, соларға жүгініңіз.",
        "temporarily_unavailable": "Тексеру қызметі уақытша қолжетімсіз. "
        "Кейінірек қайталап көріңіз.",
    },
}


class AnswerService:
    def __init__(self, settings: Settings, retriever: Retriever, providers: Providers):
        self.settings = settings
        self.retriever = retriever
        self.providers = providers

    async def ask(self, request: AskRequest, request_id: str) -> AskResponse:
        language = (
            detect_language(request.question) if request.language == "auto" else request.language
        )
        verification = Verification()
        sources = self.retriever.search(
            request.question,
            language,
            self.settings.retrieval_top_k,
            self.settings.context_max_characters,
        )

        def result(status, draft=None):
            chosen = sources
            if draft:
                cited = {e.source_id for c in draft.claims for e in c.evidence}
                chosen = [s for s in sources if s.id in cited]
            return AskResponse(
                request_id=request_id,
                status=status,
                language=language,
                answer=answer_text(draft) if draft else MESSAGES[language][status],
                claims=[
                    AnswerClaim(
                        text=c.text,
                        evidence=[
                            e.model_copy(update={"quote": normalize(e.quote)}) for e in c.evidence
                        ],
                    )
                    for c in draft.claims
                ]
                if draft
                else [],
                sources=[
                    Source(
                        **s.model_dump(
                            include={"id", "title", "section", "url", "revision", "verified_at"}
                        )
                    )
                    for s in chosen
                ],
                verification=verification,
            )

        if not self.retriever.chunks:
            verification.reason_codes = ["corpus_not_configured"]
            return result("temporarily_unavailable")
        if not sources:
            verification.reason_codes = ["no_fresh_matching_sources"]
            return result("insufficient_evidence")
        if self.settings.missing_configuration():
            verification.reason_codes = ["providers_not_configured"]
            return result("temporarily_unavailable")

        feedback: list[str] = []
        active_stage = "local"
        try:
            async with asyncio.timeout(self.settings.request_timeout_seconds):
                for attempt in (1, 2):
                    verification = Verification(attempts=attempt)
                    active_stage = "local"
                    try:
                        draft = await self.providers.generate(
                            request.question, language, sources, feedback
                        )
                    except InvalidModelOutput:
                        verification.local = "rejected"
                        feedback = ["invalid_generator_output"]
                        verification.reason_codes = feedback
                        continue
                    if draft.insufficient_evidence:
                        verification.reason_codes = ["generator_insufficient_evidence"]
                        return result("insufficient_evidence")
                    feedback = check_local(draft, sources, language)
                    verification.local = "rejected" if feedback else "passed"
                    if feedback:
                        verification.reason_codes = feedback
                        continue
                    active_stage = "grounding"
                    grounding = await self.providers.ground(draft, sources)
                    verification.support_score = grounding.support_score
                    scores = [c.score for c in grounding.claims if c.score is not None]
                    verification.minimum_claim_score = min(scores) if scores else None
                    feedback = check_grounding(grounding, draft, sources, self.settings)
                    verification.grounding = "rejected" if feedback else "passed"
                    if feedback:
                        verification.reason_codes = feedback
                        continue
                    active_stage = "critic"
                    critic = await self.providers.critique(
                        request.question, language, draft, sources
                    )
                    feedback = check_critic(critic, draft)
                    verification.critic = "rejected" if feedback else "passed"
                    if feedback:
                        verification.reason_codes = feedback
                        continue
                    return result("answered", draft)
        except (ProviderUnavailable, TimeoutError):
            setattr(verification, active_stage, "error")
            verification.reason_codes = ["verification_unavailable"]
            return result("temporarily_unavailable")
        return result("insufficient_evidence")
