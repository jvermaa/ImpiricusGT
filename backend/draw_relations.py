import argparse
import html
from pathlib import Path

from sqlalchemy import inspect, text

from database import engine

OUT = Path(__file__).resolve().parent / "relations.svg"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", action="store_true", help="Read live database tables and foreign keys")
    args = parser.parse_args()
    if not args.db:
        raise SystemExit("Pass --db to draw the live database.")

    inspector = inspect(engine)
    tables = inspector.get_table_names()
    counts: dict[str, int] = {}
    with engine.connect() as connection:
        for table in tables:
            counts[table] = connection.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar_one()

    width = 980
    row_height = 36
    height = 80 + row_height * max(len(tables), 1)
    lines = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}">',
        '<rect width="100%" height="100%" fill="#0f172a"/>',
        '<text x="24" y="36" fill="#e2e8f0" font-family="Segoe UI, sans-serif" font-size="20">clinic.db relationships</text>',
    ]
    y = 64
    for table in tables:
        fks = inspector.get_foreign_keys(table)
        fk_text = ", ".join(
            f"{','.join(item['constrained_columns'])} -> {item['referred_table']}"
            for item in fks
        ) or "no foreign keys"
        label = html.escape(f"{table} ({counts[table]})  {fk_text}")
        lines.append(f'<text x="24" y="{y}" fill="#cbd5e1" font-family="Consolas, monospace" font-size="14">{label}</text>')
        y += row_height
    lines.append("</svg>")
    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
