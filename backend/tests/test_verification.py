import pytest
from pydantic import ValidationError

from app.models import Claim
from app.verification import GroundingReport, check_critic, check_grounding, check_local
from tests.conftest import critic_for, grounding_for


def test_exact_quote_and_numbers_pass(draft, sources):
    assert check_local(draft, sources, "ru") == []


@pytest.mark.parametrize(
    ("field", "value", "code"),
    [
        ("source_id", "invented", "unknown_source"),
        ("quote", "Заявление рассматривается в течение 3 рабочих дней.", "quote_mismatch"),
    ],
)
def test_bad_evidence_is_blocked(draft, sources, field, value, code):
    setattr(draft.claims[0].evidence[0], field, value)
    assert code in check_local(draft, sources, "ru")


@pytest.mark.parametrize(
    ("text", "code"),
    [
        ("Заявление рассматривается в течение 30 дней.", "unsupported_number"),
        ("Подробнее https://fake.example/ в источнике.", "generated_link_or_markup"),
        ("Согласно статье 15 заявление будет рассмотрено.", "generated_article_reference"),
        ("15-бап бойынша өтініш қаралады.", "generated_article_reference"),
    ],
)
def test_generated_metadata_is_blocked(draft, sources, text, code):
    draft.claims[0].text = text
    assert code in check_local(draft, sources, "ru")


def test_language_mismatch(draft, sources):
    assert "language_mismatch" in check_local(draft, sources, "kk")


def test_grounding_utf8_offsets_pass(draft, sources, settings):
    assert check_grounding(grounding_for(draft, sources), draft, sources, settings) == []


def test_low_claim_score_cannot_be_hidden_by_high_total(draft, sources, settings):
    report = grounding_for(draft, sources)
    report.claims[0].score = 0.3
    assert "unsupported_grounding_claim" in check_grounding(report, draft, sources, settings)


def test_unchecked_or_missing_claim_cannot_pass(draft, sources, settings):
    report = grounding_for(draft, sources)
    draft.claims.append(
        Claim(text="Вам гарантировано положительное решение.", evidence=draft.claims[0].evidence)
    )
    assert "incomplete_grounding_coverage" in check_grounding(report, draft, sources, settings)


@pytest.mark.parametrize(
    ("field", "value", "code"),
    [
        ("required", False, "unsupported_grounding_claim"),
        ("score", None, "unsupported_grounding_claim"),
        ("citation_indices", [], "unsupported_grounding_claim"),
        ("citation_indices", [-1], "invalid_grounding_citation"),
        ("citation_indices", [100], "invalid_grounding_citation"),
        ("start", 1, "invalid_grounding_span"),
        ("text", "A different claim", "grounding_text_mismatch"),
    ],
)
def test_malformed_grounding_never_passes(draft, sources, settings, field, value, code):
    report = grounding_for(draft, sources)
    setattr(report.claims[0], field, value)
    assert code in check_grounding(report, draft, sources, settings)


def test_google_cannot_substitute_another_source(draft, sources, settings):
    report = grounding_for(draft, sources)
    report.chunks[0].source = "1"
    report.chunks[0].text = sources[1].text
    assert "grounding_evidence_mismatch" in check_grounding(report, draft, sources, settings)


def test_google_cannot_invent_evidence(draft, sources, settings):
    report = grounding_for(draft, sources)
    report.chunks[0].text = "Made up text."
    assert "grounding_quote_mismatch" in check_grounding(report, draft, sources, settings)


def test_no_claims_means_no_pass(draft, sources, settings):
    report = grounding_for(draft, sources)
    report.claims = []
    assert "incomplete_grounding_coverage" in check_grounding(report, draft, sources, settings)


def test_nan_score_rejected():
    with pytest.raises(ValidationError):
        GroundingReport.model_validate({"supportScore": float("nan")})


def test_critic_must_cover_each_claim_once(draft):
    report = critic_for(draft)
    report.claims.append(report.claims[0])
    assert "critic_incomplete_coverage" in check_critic(report, draft)


def test_critic_rejects_missing_conditions(draft):
    report = critic_for(draft)
    report.preserves_conditions = False
    assert "critic_missing_conditions" in check_critic(report, draft)


def test_critic_cannot_cite_unrelated_evidence(draft):
    report = critic_for(draft)
    report.claims[0].source_ids = ["invented"]
    assert "critic_evidence_mismatch" in check_critic(report, draft)
