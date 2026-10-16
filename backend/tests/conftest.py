from datetime import date

import pytest
from pydantic import SecretStr

from app.config import Settings
from app.models import CriticReport, DocumentChunk, Draft
from app.verification import GroundingReport, answer_text


@pytest.fixture
def settings(tmp_path):
    return Settings(
        _env_file=None,
        corpus_path=tmp_path / "knowledge.jsonl",
        runtime_dir=tmp_path / "runtime",
        library_dir=tmp_path / "library",
        allowed_source_hosts=["official.example"],
        gemini_api_key=SecretStr("test-gemini"),
        gemini_model="test-generator",
        critic_api_key=SecretStr("test-critic"),
        critic_model="test-critic",
        google_cloud_project="test-project",
    )


@pytest.fixture
def sources():
    # Fictional facts used ONLY in tests; never loaded by the real application.
    return [
        DocumentChunk(
            id="test-ru-1",
            document_id="test-ru",
            title="Вымышленный учебный регламент",
            section="Учебный пункт 1",
            language="ru",
            text="Заявление рассматривается в течение 15 рабочих дней. "
            "Рассмотрение заявления не гарантирует положительного решения.",
            url="https://official.example/test/ru",
            revision="fictional-test-only",
            verified_at=date.today(),
        ),
        DocumentChunk(
            id="test-kk-1",
            document_id="test-kk",
            title="Ойдан шығарылған оқу ережесі",
            section="Оқу тармағы 1",
            language="kk",
            text="Өтініш 15 жұмыс күні ішінде қаралады. "
            "Өтінішті қарау оң шешімге кепілдік бермейді.",
            url="https://official.example/test/kk",
            revision="fictional-test-only",
            verified_at=date.today(),
        ),
    ]


@pytest.fixture
def draft(sources):
    return Draft.model_validate(
        {
            "language": "ru",
            "insufficient_evidence": False,
            "claims": [
                {
                    "text": "Заявление рассматривается в течение 15 рабочих дней.",
                    "evidence": [
                        {
                            "source_id": sources[0].id,
                            "quote": "Заявление рассматривается в течение 15 рабочих дней.",
                        }
                    ],
                }
            ],
        }
    )


def grounding_for(draft, sources):
    text = answer_text(draft)
    offset = 0
    claims = []
    for claim in draft.claims:
        end = offset + len(claim.text.encode("utf-8"))
        claims.append(
            {
                "claimText": claim.text,
                "startPos": offset,
                "endPos": end,
                "groundingCheckRequired": True,
                "score": 0.99,
                "citationIndices": [0],
            }
        )
        offset = end + 2
    assert offset == len(text.encode("utf-8")) + 2
    return GroundingReport.model_validate(
        {
            "supportScore": 0.99,
            "citedChunks": [{"chunkText": sources[0].text, "source": "0"}],
            "claims": claims,
        }
    )


def critic_for(draft):
    return CriticReport.model_validate(
        {
            "answers_question": True,
            "correct_language": True,
            "preserves_conditions": True,
            "claims": [
                {
                    "claim_index": i,
                    "verdict": "supported",
                    "source_ids": list({e.source_id for e in c.evidence}),
                    "reason": "The cited passage supports the entire statement.",
                }
                for i, c in enumerate(draft.claims)
            ],
        }
    )


class FakeProviders:
    def __init__(self, draft):
        self.draft = draft
        self.calls = []
        self.generate_outputs = []
        self.grounding_outputs = []
        self.critic_outputs = []
        self.feedback = []

    async def generate(self, question, language, sources, feedback):
        self.calls.append("generate")
        self.feedback.append(list(feedback))
        output = self.generate_outputs.pop(0) if self.generate_outputs else self.draft
        if isinstance(output, Exception):
            raise output
        return output

    async def ground(self, draft, sources):
        self.calls.append("ground")
        output = (
            self.grounding_outputs.pop(0)
            if self.grounding_outputs
            else grounding_for(draft, sources)
        )
        if isinstance(output, Exception):
            raise output
        return output

    async def critique(self, question, language, draft, sources):
        self.calls.append("critic")
        output = self.critic_outputs.pop(0) if self.critic_outputs else critic_for(draft)
        if isinstance(output, Exception):
            raise output
        return output
