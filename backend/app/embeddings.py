"""Text embeddings.

Uses sentence-transformers (all-MiniLM-L6-v2) when installed; otherwise falls back
to a dependency-free hashed bag-of-words embedder so the demo still runs offline.
The embedder name is part of the Chroma collection name, so switching embedders
never mixes incompatible vectors.
"""
import hashlib
import math
import re
from functools import lru_cache

_STOP = set("""a an and are as at be been but by for from has have he her his in into is it its
of on or she that the their then there these they this to was were which while with without
who whom will would patient pt presents presented presenting history hx year old yo years""".split())

# Tiny clinical synonym map so the fallback embedder links common abbreviations.
_SYNONYMS = {
    "ad": "atopic_dermatitis", "eczema": "atopic_dermatitis",
    "ra": "rheumatoid_arthritis", "psa": "psoriatic_arthritis",
    "ibs": "irritable_bowel", "ici": "checkpoint_inhibitor",
    "pembrolizumab": "checkpoint_inhibitor", "nivolumab": "checkpoint_inhibitor",
    "ipilimumab": "checkpoint_inhibitor", "glp1": "glp1_agonist",
    "semaglutide": "glp1_agonist", "ozempic": "glp1_agonist", "wegovy": "glp1_agonist",
    "tirzepatide": "glp1_agonist", "dupixent": "dupilumab", "sob": "dyspnea",
    "ck": "creatine_kinase", "cpk": "creatine_kinase", "hctz": "hydrochlorothiazide",
    "joint": "arthralgia", "joints": "arthralgia", "arthralgias": "arthralgia",
}


def _tokens(text: str) -> list[str]:
    words = re.findall(r"[a-z0-9]+", text.lower())
    out = []
    for w in words:
        if w in _STOP or len(w) < 2:
            continue
        w = _SYNONYMS.get(w, w)
        if len(w) > 4 and w.endswith("s") and not w.endswith("ss"):
            w = w[:-1]
        out.append(w)
    return out


class HashingEmbedder:
    name = "hash512"
    dim = 512

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._one(t) for t in texts]

    def _one(self, text: str) -> list[float]:
        vec = [0.0] * self.dim
        toks = _tokens(text)
        feats = toks + [f"{a}__{b}" for a, b in zip(toks, toks[1:])]
        for f in feats:
            h = int(hashlib.md5(f.encode()).hexdigest(), 16)
            idx = h % self.dim
            sign = 1.0 if (h >> 20) & 1 else -1.0
            weight = 0.5 if "__" in f else 1.0
            vec[idx] += sign * weight
        norm = math.sqrt(sum(v * v for v in vec)) or 1.0
        return [v / norm for v in vec]


class SentenceTransformerEmbedder:
    name = "minilm"

    def __init__(self):
        from sentence_transformers import SentenceTransformer  # noqa: WPS433
        self.model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
        self.dim = self.model.get_sentence_embedding_dimension()

    def embed(self, texts: list[str]) -> list[list[float]]:
        return self.model.encode(texts, normalize_embeddings=True).tolist()


@lru_cache(maxsize=1)
def get_embedder():
    try:
        return SentenceTransformerEmbedder()
    except Exception:  # not installed, or model download blocked
        return HashingEmbedder()
"""Text embeddings.

Uses sentence-transformers (all-MiniLM-L6-v2) when installed; otherwise falls back
to a dependency-free hashed bag-of-words embedder so the demo still runs offline.
The embedder name is part of the Chroma collection name, so switching embedders
never mixes incompatible vectors.
"""
import hashlib
import math
import re
from functools import lru_cache

_STOP = set("""a an and are as at be been but by for from has have he her his in into is it its
of on or she that the their then there these they this to was were which while with without
who whom will would patient pt presents presented presenting history hx year old yo years""".split())

# Tiny clinical synonym map so the fallback embedder links common abbreviations.
_SYNONYMS = {
    "ad": "atopic_dermatitis", "eczema": "atopic_dermatitis",
    "ra": "rheumatoid_arthritis", "psa": "psoriatic_arthritis",
    "ibs": "irritable_bowel", "ici": "checkpoint_inhibitor",
    "pembrolizumab": "checkpoint_inhibitor", "nivolumab": "checkpoint_inhibitor",
    "ipilimumab": "checkpoint_inhibitor", "glp1": "glp1_agonist",
    "semaglutide": "glp1_agonist", "ozempic": "glp1_agonist", "wegovy": "glp1_agonist",
    "tirzepatide": "glp1_agonist", "dupixent": "dupilumab", "sob": "dyspnea",
    "ck": "creatine_kinase", "cpk": "creatine_kinase", "hctz": "hydrochlorothiazide",
    "joint": "arthralgia", "joints": "arthralgia", "arthralgias": "arthralgia",
}


def _tokens(text: str) -> list[str]:
    words = re.findall(r"[a-z0-9]+", text.lower())
    out = []
    for w in words:
        if w in _STOP or len(w) < 2:
            continue
        w = _SYNONYMS.get(w, w)
        if len(w) > 4 and w.endswith("s") and not w.endswith("ss"):
            w = w[:-1]
        out.append(w)
    return out


class HashingEmbedder:
    name = "hash512"
    dim = 512

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._one(t) for t in texts]

    def _one(self, text: str) -> list[float]:
        vec = [0.0] * self.dim
        toks = _tokens(text)
        feats = toks + [f"{a}__{b}" for a, b in zip(toks, toks[1:])]
        for f in feats:
            h = int(hashlib.md5(f.encode()).hexdigest(), 16)
            idx = h % self.dim
            sign = 1.0 if (h >> 20) & 1 else -1.0
            weight = 0.5 if "__" in f else 1.0
            vec[idx] += sign * weight
        norm = math.sqrt(sum(v * v for v in vec)) or 1.0
        return [v / norm for v in vec]


class SentenceTransformerEmbedder:
    name = "minilm"

    def __init__(self):
        from sentence_transformers import SentenceTransformer  # noqa: WPS433
        self.model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
        self.dim = self.model.get_sentence_embedding_dimension()

    def embed(self, texts: list[str]) -> list[list[float]]:
        return self.model.encode(texts, normalize_embeddings=True).tolist()


@lru_cache(maxsize=1)
def get_embedder():
    try:
        return SentenceTransformerEmbedder()
    except Exception:  # not installed, or model download blocked
        return HashingEmbedder()
