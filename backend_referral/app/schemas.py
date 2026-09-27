from typing import Literal

from pydantic import BaseModel, Field


class CreateReferral(BaseModel):
    from_hcp_id: str
    to_provider_id: str
    type: Literal["advice", "referral"]
    patient_id: str | None = Field(None, description="Required for referral; for advice, used to build the de-identified case")
    case_id: str | None = Field(None, description="Advice only: an existing de-identified case instead of a patient")
    reason: str = Field(..., min_length=5, max_length=1000)
    urgency: Literal["routine", "soon", "urgent"] = "routine"


class StatusUpdate(BaseModel):
    status: Literal["accepted", "declined", "completed", "cancelled"]
    actor: str = Field(..., description="Who is making the change: from_hcp_id or to_provider_id")
    outcome: str | None = Field(None, max_length=1000, description="Required when completing")
    # Closing the loop into the peer case network (optional, on completion only)
    feed_network: bool = False
    final_diagnosis: str | None = Field(None, max_length=200)
    treatment_used: str | None = Field(None, max_length=1000)


class MessageCreate(BaseModel):
    sender: str
    body: str = Field(..., min_length=1, max_length=4000)
