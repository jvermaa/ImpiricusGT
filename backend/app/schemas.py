from pydantic import BaseModel, Field


class DeidentifyRequest(BaseModel):
    raw_text: str = Field(..., min_length=10, max_length=8000,
                          description="Doctor's free-text case. Never stored.")


class StructuredCase(BaseModel):
    age_band: str | None = None
    sex: str | None = None
    chief_complaint: str = ""
    key_findings: list[str] = []
    suspected_conditions: list[str] = []
    treatments_tried: list[str] = []
    clinical_question: str = ""
    specialty_hints: list[str] = []
    search_terms: list[str] = []
    structured_by: str | None = None


class CreateCaseRequest(BaseModel):
    author_hcp_id: str
    redacted_text: str = Field(..., min_length=10, max_length=8000)
    structured: StructuredCase | None = None
    consent_to_index: bool = Field(False, description="May this case, once resolved, help match future cases?")
    confirmed_deidentified: bool = Field(..., description="Doctor reviewed the redacted text.")


class MatchRequest(BaseModel):
    author_hcp_id: str | None = None
    redacted_text: str | None = None
    structured: StructuredCase | None = None
    include_evidence: bool = True


class ResponseCreate(BaseModel):
    hcp_id: str
    body: str = Field(..., min_length=2, max_length=4000)


class ResolveRequest(BaseModel):
    final_diagnosis: str = Field(..., min_length=2, max_length=200)
    treatment_used: str | None = Field(None, max_length=1000, description="What was done after diagnosis")
    outcome: str | None = Field(None, max_length=500, description="How the patient responded")
    resolved_by_hcp_id: str | None = Field(None, description="Peer whose input led to the answer, if any")


class FindSimilarRequest(BaseModel):
    question: str | None = Field(None, max_length=1000,
                                 description="Optional: what the doctor wants to know about this patient")
    include_evidence: bool = True
