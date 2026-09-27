import os
from collections.abc import Generator
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, event, inspect
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

load_dotenv(Path(__file__).resolve().parent / ".env")

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./clinic.db")
if DATABASE_URL.startswith("sqlite:///./"):
    db_name = DATABASE_URL.removeprefix("sqlite:///./")
    absolute_db = (Path(__file__).resolve().parent / db_name).resolve()
    DATABASE_URL = f"sqlite:///{absolute_db}"
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)


@event.listens_for(engine, "connect")
def _sqlite_foreign_keys(dbapi_connection, _connection_record) -> None:
    if not DATABASE_URL.startswith("sqlite"):
        return
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


class Base(DeclarativeBase):
    pass


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def ensure_runtime_schema() -> None:
    """Add lightweight runtime columns for sqlite during local development."""
    if engine.dialect.name != "sqlite":
        return
    with engine.begin() as connection:
        table_names = set(inspect(connection).get_table_names())
        if "patients" not in table_names:
            return
        patient_columns = {column["name"] for column in inspect(connection).get_columns("patients")}
        if "email_address" not in patient_columns:
            connection.exec_driver_sql(
                "ALTER TABLE patients "
                "ADD COLUMN email_address VARCHAR NOT NULL DEFAULT 'harisamser27@gmail.com'"
            )
