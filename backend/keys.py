from sqlalchemy import select
from sqlalchemy.orm import Session


def next_key(db: Session, column, prefix: str, width: int = 3) -> str:
    highest = 0
    for value in db.scalars(select(column)).all():
        if not isinstance(value, str) or not value.startswith(prefix):
            continue
        tail = value[len(prefix) :]
        if tail.isdigit():
            highest = max(highest, int(tail))
    return f"{prefix}{highest + 1:0{width}d}"
