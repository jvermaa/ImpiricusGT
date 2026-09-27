from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class Doctor(Base):
    __tablename__ = "doctors"

    doctor_key: Mapped[str] = mapped_column(String, primary_key=True)
    display_name: Mapped[str] = mapped_column(String, nullable=False)
    credentials: Mapped[str] = mapped_column(String, nullable=False)
    specialty: Mapped[str] = mapped_column(String, nullable=False)
    subspecialty_focus: Mapped[str] = mapped_column(String, nullable=False)
    practice_type: Mapped[str] = mapped_column(String, nullable=False)
    state: Mapped[str] = mapped_column(String, nullable=False)
    years_in_practice: Mapped[int] = mapped_column(Integer, nullable=False)
    languages_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    case_exchange_opt_in: Mapped[bool] = mapped_column(Boolean, nullable=False)
    accepts_peer_consults: Mapped[bool] = mapped_column(Boolean, nullable=False)
    patient_message_review_required: Mapped[bool] = mapped_column(Boolean, nullable=False)
    professional_email: Mapped[str] = mapped_column(String, nullable=False)
    professional_phone: Mapped[str | None] = mapped_column(String, nullable=True)
    license_number: Mapped[str | None] = mapped_column(String, nullable=True)
    npi: Mapped[str | None] = mapped_column(String, nullable=True)
    organization: Mapped[str] = mapped_column(String, nullable=False)

    patients: Mapped[list["Patient"]] = relationship(back_populates="primary_doctor")


class Patient(Base):
    __tablename__ = "patients"

    patient_key: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    age_group: Mapped[str] = mapped_column(String, nullable=False)
    state: Mapped[str] = mapped_column(String, nullable=False)
    sex_for_clinical_context: Mapped[str] = mapped_column(String, nullable=False)
    preferred_language: Mapped[str] = mapped_column(String, nullable=False)
    primary_doctor_key: Mapped[str] = mapped_column(
        ForeignKey("doctors.doctor_key"), nullable=False
    )
    allergy_status: Mapped[str] = mapped_column(String, nullable=False)
    symptoms_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    tobacco_use: Mapped[str] = mapped_column(String, nullable=False)
    surgery_history: Mapped[str] = mapped_column(String, nullable=False)
    family_history: Mapped[str] = mapped_column(String, nullable=False)
    pregnancy_status: Mapped[str] = mapped_column(String, nullable=False)
    portal_access: Mapped[bool] = mapped_column(Boolean, nullable=False)
    email_contact_available: Mapped[bool] = mapped_column(Boolean, nullable=False)
    messaging_preference: Mapped[str] = mapped_column(String, nullable=False)
    patient_education_language: Mapped[str] = mapped_column(String, nullable=False)
    sharing_preference_for_peer_cases: Mapped[str] = mapped_column(String, nullable=False)
    clinical_trial_outreach_preference: Mapped[str] = mapped_column(String, nullable=False)
    source: Mapped[str] = mapped_column(String, nullable=False)

    primary_doctor: Mapped[Doctor] = relationship(back_populates="patients")
    diagnoses: Mapped[list["Diagnosis"]] = relationship(
        back_populates="patient", cascade="all, delete-orphan"
    )
    allergies: Mapped[list["Allergy"]] = relationship(
        back_populates="patient", cascade="all, delete-orphan"
    )


class Diagnosis(Base):
    __tablename__ = "diagnoses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    patient_key: Mapped[str] = mapped_column(
        ForeignKey("patients.patient_key", ondelete="CASCADE"), nullable=False
    )
    label: Mapped[str] = mapped_column(String, nullable=False)
    code_system: Mapped[str] = mapped_column(String, nullable=False)
    code: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)
    first_recorded_year: Mapped[int] = mapped_column(Integer, nullable=False)

    patient: Mapped[Patient] = relationship(back_populates="diagnoses")


class Allergy(Base):
    __tablename__ = "allergies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    patient_key: Mapped[str] = mapped_column(
        ForeignKey("patients.patient_key", ondelete="CASCADE"), nullable=False
    )
    substance: Mapped[str] = mapped_column(String, nullable=False)
    reaction: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)

    patient: Mapped[Patient] = relationship(back_populates="allergies")


class Prescription(Base):
    __tablename__ = "prescriptions"

    prescription_key: Mapped[str] = mapped_column(String, primary_key=True)
    patient_key: Mapped[str] = mapped_column(ForeignKey("patients.patient_key"), nullable=False)
    prescriber_doctor_key: Mapped[str] = mapped_column(
        ForeignKey("doctors.doctor_key"), nullable=False
    )
    generic_medication: Mapped[str] = mapped_column(String, nullable=False)
    strength: Mapped[str] = mapped_column(String, nullable=False)
    dose_instruction: Mapped[str] = mapped_column(String, nullable=False)
    route: Mapped[str] = mapped_column(String, nullable=False)
    frequency: Mapped[str] = mapped_column(String, nullable=False)
    duration: Mapped[str] = mapped_column(String, nullable=False)
    quantity: Mapped[str | None] = mapped_column(String, nullable=True)
    refills: Mapped[int] = mapped_column(Integer, nullable=False)
    indication: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)
    start_year: Mapped[int] = mapped_column(Integer, nullable=False)
    end_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pharmacy: Mapped[str | None] = mapped_column(String, nullable=True)
    monitoring_plan: Mapped[str] = mapped_column(Text, nullable=False)
    patient_instruction_reviewed: Mapped[bool] = mapped_column(Boolean, nullable=False)
    clinician_approval_required_for_changes: Mapped[bool] = mapped_column(Boolean, nullable=False)
    note: Mapped[str] = mapped_column(Text, nullable=False)


class Lab(Base):
    __tablename__ = "labs"

    lab_key: Mapped[str] = mapped_column(String, primary_key=True)
    patient_key: Mapped[str] = mapped_column(ForeignKey("patients.patient_key"), nullable=False)
    doctor_key: Mapped[str] = mapped_column(ForeignKey("doctors.doctor_key"), nullable=False)
    test_name: Mapped[str] = mapped_column(String, nullable=False)
    value: Mapped[float] = mapped_column(Float, nullable=False)
    unit: Mapped[str] = mapped_column(String, nullable=False)
    reference_range: Mapped[str | None] = mapped_column(String, nullable=True)
    flag: Mapped[str] = mapped_column(String, nullable=False)
    result_year: Mapped[int] = mapped_column(Integer, nullable=False)


class Encounter(Base):
    __tablename__ = "encounters"

    encounter_key: Mapped[str] = mapped_column(String, primary_key=True)
    patient_key: Mapped[str] = mapped_column(ForeignKey("patients.patient_key"), nullable=False)
    doctor_key: Mapped[str] = mapped_column(ForeignKey("doctors.doctor_key"), nullable=False)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    setting: Mapped[str] = mapped_column(String, nullable=False)
    reason: Mapped[str] = mapped_column(String, nullable=False)
    assessment: Mapped[str] = mapped_column(Text, nullable=False)
    plan: Mapped[str] = mapped_column(Text, nullable=False)
    handoff_summary_status: Mapped[str] = mapped_column(String, nullable=False)


class Followup(Base):
    __tablename__ = "followups"
    __table_args__ = (
        CheckConstraint(
            "delivery_status != 'sent' OR clinician_approved = 1",
            name="ck_followup_sent_requires_approval",
        ),
    )

    followup_key: Mapped[str] = mapped_column(String, primary_key=True)
    patient_key: Mapped[str] = mapped_column(ForeignKey("patients.patient_key"), nullable=False)
    doctor_key: Mapped[str] = mapped_column(ForeignKey("doctors.doctor_key"), nullable=False)
    prescription_key: Mapped[str] = mapped_column(
        ForeignKey("prescriptions.prescription_key"), nullable=False
    )
    trigger: Mapped[str] = mapped_column(String, nullable=False)
    due_year: Mapped[int] = mapped_column(Integer, nullable=False)
    channel: Mapped[str] = mapped_column(String, nullable=False)
    template: Mapped[str] = mapped_column(Text, nullable=False)
    clinical_content_in_email: Mapped[bool] = mapped_column(Boolean, nullable=False)
    patient_response: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)
    clinician_approved: Mapped[bool] = mapped_column(Boolean, nullable=False)
    delivery_status: Mapped[str] = mapped_column(String, nullable=False)
    escalate_to_clinician: Mapped[bool] = mapped_column(Boolean, nullable=False)


class CaseMatch(Base):
    __tablename__ = "case_matches"
    __table_args__ = (
        UniqueConstraint(
            "query_patient_key",
            "candidate_patient_key",
            name="uq_case_match_pair",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    query_patient_key: Mapped[str] = mapped_column(
        ForeignKey("patients.patient_key"), nullable=False
    )
    candidate_patient_key: Mapped[str] = mapped_column(
        ForeignKey("patients.patient_key"), nullable=False
    )
    query_doctor_key: Mapped[str] = mapped_column(ForeignKey("doctors.doctor_key"), nullable=False)
    candidate_doctor_key: Mapped[str] = mapped_column(
        ForeignKey("doctors.doctor_key"), nullable=False
    )
    matching_feature: Mapped[str] = mapped_column(String, nullable=False)
    review_status: Mapped[str] = mapped_column(String, nullable=False)
    score: Mapped[float | None] = mapped_column(Float, nullable=True)


class ConsultThread(Base):
    __tablename__ = "consult_threads"
    __table_args__ = (
        UniqueConstraint("doctor_low_key", "doctor_high_key", name="uq_consult_pair"),
        CheckConstraint("doctor_low_key < doctor_high_key", name="ck_consult_doctor_order"),
    )

    thread_key: Mapped[str] = mapped_column(String, primary_key=True)
    doctor_low_key: Mapped[str] = mapped_column(ForeignKey("doctors.doctor_key"), nullable=False)
    doctor_high_key: Mapped[str] = mapped_column(ForeignKey("doctors.doctor_key"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    messages: Mapped[list["Message"]] = relationship(back_populates="thread")


class Message(Base):
    __tablename__ = "messages"

    message_key: Mapped[str] = mapped_column(String, primary_key=True)
    thread_key: Mapped[str] = mapped_column(
        ForeignKey("consult_threads.thread_key"), nullable=False
    )
    sender_doctor_key: Mapped[str] = mapped_column(ForeignKey("doctors.doctor_key"), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    thread: Mapped[ConsultThread] = relationship(back_populates="messages")
