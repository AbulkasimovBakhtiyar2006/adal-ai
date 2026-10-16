import re
import unicodedata
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

from app.config import Settings
from app.models import CriticReport, DocumentChunk, Draft, Language


def normalize(text: str) -> str:
    return " ".join(unicodedata.normalize("NFC", text).split())


def answer_text(draft: Draft) -> str:
    return "\n\n".join(claim.text for claim in draft.claims)


def check_local(draft: Draft, chunks: list[DocumentChunk], language: Language) -> list[str]:
    issues = []
    sources = {chunk.id: chunk for chunk in chunks}
    if draft.language != language:
        issues.append("language_mismatch")
    for claim in draft.claims:
        if re.search(r"https?://|www\.|<[^>]*>|\]\(", claim.text, re.I):
            issues.append("generated_link_or_markup")
        if re.search(r"стать\w*\s*\d|\d+\s*[-–]?\s*бап", claim.text, re.I):
            issues.append("generated_article_reference")
        quoted_numbers = set()
        for evidence in claim.evidence:
            source = sources.get(evidence.source_id)
            if source is None:
                issues.append("unknown_source")
                continue
            if normalize(evidence.quote) not in normalize(source.text):
                issues.append("quote_mismatch")
            quoted_numbers.update(re.findall(r"\d+(?:[.,]\d+)?", evidence.quote))
        numbers = set(re.findall(r"\d+(?:[.,]\d+)?", claim.text))
        if not numbers.issubset(quoted_numbers):
            issues.append("unsupported_number")
    return sorted(set(issues))


class GoogleModel(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True, populate_by_name=True)


Score = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]


class GroundedChunk(GoogleModel):
    text: str = Field(alias="chunkText", min_length=1)
    source: str


class GroundedClaim(GoogleModel):
    text: str = Field(alias="claimText", min_length=1)
    citation_indices: list[int] = Field(default_factory=list, alias="citationIndices")
    # Protobuf JSON may omit a zero start offset.
    start: int = Field(default=0, alias="startPos", ge=0)
    end: int = Field(alias="endPos", ge=1)
    required: bool = Field(default=False, alias="groundingCheckRequired")
    score: Score | None = None


class GroundingReport(GoogleModel):
    support_score: Score = Field(alias="supportScore")
    chunks: list[GroundedChunk] = Field(default_factory=list, alias="citedChunks")
    claims: list[GroundedClaim] = Field(default_factory=list)


def check_grounding(
    report: GroundingReport, draft: Draft, sources: list[DocumentChunk], settings: Settings
) -> list[str]:
    """Require supported UTF-8 span coverage of the entire displayed answer.

    A high aggregate score, a missing claim or an unexplained 'not required' flag
    can never let an unsupported statement pass. Offsets are bytes, not characters.
    """
    issues: set[str] = set()
    if report.support_score < settings.grounding_support_threshold:
        issues.add("low_grounding_support")
    raw = answer_text(draft).encode("utf-8")
    covered = bytearray(len(raw))
    ranges = []
    offset = 0
    for claim in draft.claims:
        end = offset + len(claim.text.encode("utf-8"))
        ranges.append((offset, end, {e.source_id for e in claim.evidence}))
        offset = end + 2  # Two ASCII newline bytes between claims.
    for claim in report.claims:
        if not (0 <= claim.start < claim.end <= len(raw)):
            issues.add("invalid_grounding_span")
            continue
        try:
            span = raw[claim.start : claim.end].decode("utf-8")
        except UnicodeDecodeError:
            issues.add("invalid_grounding_span")
            continue
        if normalize(span) != normalize(claim.text):
            issues.add("grounding_text_mismatch")
            continue
        if (
            not claim.required
            or claim.score is None
            or claim.score < settings.grounding_claim_threshold
            or not claim.citation_indices
        ):
            issues.add("unsupported_grounding_claim")
            continue
        supporting_sources = set()
        for index in claim.citation_indices:
            if not 0 <= index < len(report.chunks):
                issues.add("invalid_grounding_citation")
                continue
            chunk = report.chunks[index]
            if not re.fullmatch(r"0|[1-9][0-9]*", chunk.source):
                issues.add("invalid_grounding_source")
                continue
            source_index = int(chunk.source)
            if source_index >= len(sources):
                issues.add("invalid_grounding_source")
                continue
            source = sources[source_index]
            if normalize(chunk.text) not in normalize(source.text):
                issues.add("grounding_quote_mismatch")
                continue
            supporting_sources.add(source.id)
        for start, end, expected_sources in ranges:
            if claim.start < end and claim.end > start:
                if not supporting_sources.intersection(expected_sources):
                    issues.add("grounding_evidence_mismatch")
        covered[claim.start : claim.end] = b"\x01" * (claim.end - claim.start)
    if not report.claims or any(
        not covered[i] and byte not in b" \t\n\r" for i, byte in enumerate(raw)
    ):
        issues.add("incomplete_grounding_coverage")
    return sorted(issues)


def check_critic(report: CriticReport, draft: Draft) -> list[str]:
    issues = []
    if not report.answers_question:
        issues.append("critic_irrelevant_answer")
    if not report.correct_language:
        issues.append("critic_wrong_language")
    if not report.preserves_conditions:
        issues.append("critic_missing_conditions")
    indices = [claim.claim_index for claim in report.claims]
    if sorted(indices) != list(range(len(draft.claims))):
        issues.append("critic_incomplete_coverage")
    for result in report.claims:
        if result.verdict != "supported":
            issues.append("critic_unsupported_claim")
        if result.claim_index < len(draft.claims):
            expected = {e.source_id for e in draft.claims[result.claim_index].evidence}
            if set(result.source_ids) != expected:
                issues.append("critic_evidence_mismatch")
    return sorted(set(issues))
