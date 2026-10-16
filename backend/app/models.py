from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

Language = Literal["ru", "kk"]
Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
Identifier = Annotated[str, StringConstraints(pattern=r"^[a-zA-Z0-9_.:-]{1,100}$")]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class DocumentChunk(StrictModel):
    id: Identifier
    document_id: Identifier
    title: Annotated[Text, Field(max_length=300)]
    section: Annotated[Text, Field(max_length=200)]
    language: Language
    text: Annotated[Text, Field(min_length=30, max_length=9500)]
    url: Annotated[Text, Field(max_length=2000)]
    revision: Annotated[Text, Field(max_length=200)]
    verified_at: date


class AskRequest(StrictModel):
    question: Annotated[Text, Field(min_length=3, max_length=2000)]
    language: Literal["auto", "ru", "kk"] = "auto"
    response_mode: Literal["text", "voice"] = "text"


class Evidence(StrictModel):
    source_id: Identifier
    quote: Annotated[Text, Field(min_length=16, max_length=1500)]


class Claim(StrictModel):
    text: Annotated[Text, Field(min_length=8, max_length=600)]
    evidence: list[Evidence] = Field(min_length=1, max_length=3)


class Draft(StrictModel):
    language: Language
    insufficient_evidence: bool
    claims: list[Claim] = Field(max_length=5)

    @model_validator(mode="after")
    def coherent_answer(self) -> "Draft":
        if self.insufficient_evidence == bool(self.claims):
            raise ValueError("Abstention must have no claims; an answer must contain claims")
        return self


class CriticClaim(StrictModel):
    claim_index: int = Field(ge=0, le=4)
    verdict: Literal["supported", "contradicted", "insufficient"]
    source_ids: list[Identifier] = Field(min_length=1, max_length=5)
    reason: Annotated[Text, Field(max_length=1000)]


class CriticReport(StrictModel):
    answers_question: bool
    correct_language: bool
    preserves_conditions: bool
    claims: list[CriticClaim] = Field(min_length=1, max_length=5)


Stage = Literal["not_run", "passed", "rejected", "error"]


class Verification(BaseModel):
    local: Stage = "not_run"
    grounding: Stage = "not_run"
    critic: Stage = "not_run"
    support_score: float | None = None
    minimum_claim_score: float | None = None
    attempts: int = 0
    reason_codes: list[str] = Field(default_factory=list)


class Source(BaseModel):
    id: str
    title: str
    section: str
    url: str
    revision: str
    verified_at: date


class AnswerClaim(BaseModel):
    text: str
    evidence: list[Evidence]


class AskResponse(BaseModel):
    request_id: str
    status: Literal["answered", "insufficient_evidence", "temporarily_unavailable"]
    language: Language
    answer: str
    claims: list[AnswerClaim] = Field(default_factory=list)
    sources: list[Source] = Field(default_factory=list)
    verification: Verification = Field(default_factory=Verification)
