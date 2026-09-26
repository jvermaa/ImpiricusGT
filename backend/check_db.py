import sys

from checks import run_checks
from database import SessionLocal


def main() -> None:
    with SessionLocal() as db:
        errors, warnings = run_checks(db)
    for warning in warnings:
        print(f"WARNING {warning}")
    for error in errors:
        print(f"ERROR {error}")
    if errors:
        sys.exit(1)
    print("Clean.")


if __name__ == "__main__":
    main()
