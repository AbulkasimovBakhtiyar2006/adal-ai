import asyncio
from datetime import date, timedelta

import pytest

from app.models import AskRequest
from app.providers import InvalidModelOutput, ProviderUnavailable
from app.retrieval import Retriever
from app.service import AnswerService
from tests.conftest import FakeProviders, critic_for


def service(settings, sources, fake):
    return AnswerService(settings, Retriever(sources, settings.source_max_age_days), fake)


async def test_valid_answer_requires_all_stages(settings, sources, draft):
    fake = FakeProviders(draft)
    response = await service(settings, sources, fake).ask(
        AskRequest(question="Срок заявления"), "id"
    )
    assert response.status == "answered"
    assert fake.calls == ["generate", "ground", "critic"]
    assert response.verification.local == response.verification.grounding == "passed"
    assert response.verification.critic == "passed"
    assert response.sources[0].url == sources[0].url


async def test_repair_repeats_every_check(settings, sources, draft):
    fake = FakeProviders(draft)
    bad_report = critic_for(draft)
    bad_report.preserves_conditions = False
    fake.critic_outputs = [bad_report]
    response = await service(settings, sources, fake).ask(
        AskRequest(question="Срок заявления"), "id"
    )
    assert response.status == "answered"
    assert fake.calls == ["generate", "ground", "critic"] * 2
    assert fake.feedback[1] == ["critic_missing_conditions"]
    assert response.verification.attempts == 2


async def test_unverified_answer_never_leaks(settings, sources, draft):
    draft.claims[0].text = "SECRET_UNVERIFIED_999999"
    fake = FakeProviders(draft)
    response = await service(settings, sources, fake).ask(
        AskRequest(question="Срок заявления"), "id"
    )
    assert response.status == "insufficient_evidence"
    assert response.claims == []
    assert "SECRET_UNVERIFIED" not in response.model_dump_json()
    assert fake.calls == ["generate", "generate"]


@pytest.mark.parametrize("stage", ["generate", "ground", "critic"])
async def test_provider_failure_fails_closed(settings, sources, draft, stage):
    fake = FakeProviders(draft)
    outputs = {
        "generate": "generate_outputs",
        "ground": "grounding_outputs",
        "critic": "critic_outputs",
    }
    setattr(fake, outputs[stage], [ProviderUnavailable("sensitive internal error")])
    response = await service(settings, sources, fake).ask(
        AskRequest(question="Срок заявления"), "id"
    )
    assert response.status == "temporarily_unavailable"
    assert response.claims == []
    assert "sensitive" not in response.model_dump_json()
    assert fake.calls.count("generate") == 1


async def test_invalid_generator_json_repaired_once(settings, sources, draft):
    fake = FakeProviders(draft)
    fake.generate_outputs = [InvalidModelOutput(), draft]
    response = await service(settings, sources, fake).ask(
        AskRequest(question="Срок заявления"), "id"
    )
    assert response.status == "answered"
    assert response.verification.attempts == 2


async def test_expired_corpus_never_sent_to_model(settings, sources, draft):
    for source in sources:
        source.verified_at = date.today() - timedelta(days=31)
    fake = FakeProviders(draft)
    response = await service(settings, sources, fake).ask(
        AskRequest(question="Срок заявления"), "id"
    )
    assert response.status == "insufficient_evidence"
    assert fake.calls == []
    assert response.sources == []


async def test_empty_corpus_is_not_ready(settings, draft):
    fake = FakeProviders(draft)
    response = await service(settings, [], fake).ask(AskRequest(question="Срок заявления"), "id")
    assert response.status == "temporarily_unavailable"
    assert fake.calls == []


async def test_off_topic_does_not_call_models(settings, sources, draft):
    fake = FakeProviders(draft)
    response = await service(settings, sources, fake).ask(
        AskRequest(question="Космические ракеты"), "id"
    )
    assert response.status == "insufficient_evidence"
    assert fake.calls == []


async def test_kazakh_answer_runs_all_checks(settings, sources, draft):
    draft.language = "kk"
    draft.claims[0].text = "Өтініш 15 жұмыс күні ішінде қаралады."
    draft.claims[0].evidence[0].source_id = sources[1].id
    draft.claims[0].evidence[0].quote = draft.claims[0].text
    fake = FakeProviders(draft)
    response = await service(settings, sources, fake).ask(
        AskRequest(question="Өтініш туралы"), "id"
    )
    assert response.status == "answered"
    assert response.language == "kk"
    assert fake.calls == ["generate", "ground", "critic"]


async def test_overall_timeout_fails_closed(settings, sources, draft):
    class SlowProviders(FakeProviders):
        async def generate(self, *args):
            await asyncio.sleep(1)
            return self.draft

    settings.request_timeout_seconds = 0.01
    response = await service(settings, sources, SlowProviders(draft)).ask(
        AskRequest(question="Срок заявления"), "id"
    )
    assert response.status == "temporarily_unavailable"
    assert response.claims == []


async def test_voice_mode_still_runs_all_verification_stages(settings, sources, draft):
    class VoiceProviders(FakeProviders):
        async def generate(self, question, language, sources, feedback, response_mode="text"):
            assert response_mode == "voice"
            return await super().generate(question, language, sources, feedback)

    fake = VoiceProviders(draft)
    response = await service(settings, sources, fake).ask(
        AskRequest(question="Срок заявления", response_mode="voice"), "voice-id"
    )
    assert response.status == "answered"
    assert fake.calls == ["generate", "ground", "critic"]
