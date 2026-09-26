"""Chroma vector store with two collections:

  cases_<embedder>  - resolved, consented, de-identified cases (the "network memory")
  hcps_<embedder>   - HCP expertise profiles (specialty, focus areas, drug classes)

This is the answer to "we don't have enough data to correlate patient profiles":
we never index raw patient records. We index (1) expertise, which Impiricus/DocUpdate
already knows about HCPs, and (2) cases HCPs voluntarily shared and closed out.
"""
from functools import lru_cache

import chromadb

from . import config
from .embeddings import get_embedder


@lru_cache(maxsize=1)
def _client():
    return chromadb.PersistentClient(path=str(config.CHROMA_PATH))


def _collection(kind: str):
    emb = get_embedder()
    return _client().get_or_create_collection(
        name=f"{kind}_{emb.name}",
        embedding_function=None,           # we always pass vectors ourselves
        metadata={"hnsw:space": "cosine"},
    )


def reset() -> None:
    emb = get_embedder()
    for kind in ("cases", "hcps"):
        try:
            _client().delete_collection(f"{kind}_{emb.name}")
        except Exception:
            pass


def case_document(structured: dict) -> str:
    """The text we embed for a case. Built from the structured summary, not raw text."""
    # Clinical content only. Age and sex are deliberately left out: they are shared by
    # huge numbers of unrelated cases and just inflate every similarity score.
    parts = [
        structured.get("chief_complaint") or "",
        "; ".join(structured.get("key_findings") or []),
        "; ".join(structured.get("suspected_conditions") or []),
        "; ".join(structured.get("treatments_tried") or []),
        structured.get("clinical_question") or "",
    ]
    return " | ".join(dict.fromkeys(p for p in parts if p.strip()))


def hcp_document(h: dict) -> str:
    return " | ".join([
        h["specialty"], h.get("subspecialty") or "",
        "focus: " + "; ".join(h.get("focus_areas") or []),
        "drugs: " + "; ".join(h.get("drug_classes") or []),
    ])


def upsert_case(case: dict) -> None:
    doc = case_document(case["structured"])
    vec = get_embedder().embed([doc])[0]
    _collection("cases").upsert(
        ids=[case["id"]],
        embeddings=[vec],
        documents=[doc],
        metadatas=[{
            "author_hcp_id": case["author_hcp_id"],
            "resolved_by_hcp_id": case.get("resolved_by_hcp_id") or "",
            "final_diagnosis": case.get("final_diagnosis") or "",
        }],
    )


def upsert_hcps(hcps: list[dict]) -> None:
    if not hcps:
        return
    docs = [hcp_document(h) for h in hcps]
    vecs = get_embedder().embed(docs)
    _collection("hcps").upsert(
        ids=[h["id"] for h in hcps],
        embeddings=vecs,
        documents=docs,
        metadatas=[{"specialty": h["specialty"],
                    "accepting": bool(h.get("accepting_cases", True))} for h in hcps],
    )


def _query(kind: str, vec: list[float], k: int, where: dict | None):
    col = _collection(kind)
    n = col.count()
    if n == 0:
        return []
    res = col.query(query_embeddings=[vec], n_results=min(k, n), where=where)
    out = []
    for i, _id in enumerate(res["ids"][0]):
        out.append({
            "id": _id,
            "similarity": round(1.0 - float(res["distances"][0][i]), 4),
            "metadata": res["metadatas"][0][i],
            "document": res["documents"][0][i],
        })
    return out


def similar_cases(vec: list[float], exclude_author: str | None, k: int = 10):
    where = {"author_hcp_id": {"$ne": exclude_author}} if exclude_author else None
    return _query("cases", vec, k, where)


def expert_hcps(vec: list[float], k: int = 25, specialty: str | None = None):
    where = {"accepting": True}
    if specialty:
        where = {"$and": [{"accepting": True}, {"specialty": specialty}]}
    return _query("hcps", vec, k, where)


def counts() -> dict:
    return {"cases": _collection("cases").count(), "hcps": _collection("hcps").count(),
            "embedder": get_embedder().name}
