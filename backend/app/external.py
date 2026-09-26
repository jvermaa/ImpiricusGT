"""Live public evidence sources. These solve the cold-start problem: on day one,
before the network has resolved cases, every query still returns published case
reports and recruiting trials.

Both calls time out fast and return [] on any failure so /match never breaks.
"""
import asyncio
import logging

import httpx

from . import config

log = logging.getLogger("pcx.external")

PUBMED_SEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
PUBMED_SUMMARY = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi"
CTGOV = "https://clinicaltrials.gov/api/v2/studies"
TIMEOUT = httpx.Timeout(6.0)

_cache: dict[tuple, list] = {}


async def pubmed_case_reports(terms: list[str], limit: int = 3) -> list[dict]:
    if config.OFFLINE or not terms:
        return []
    key = ("pubmed", tuple(terms), limit)
    if key in _cache:
        return _cache[key]
    query = " AND ".join(f"({t})" for t in terms[:3]) + " AND Case Reports[ptyp]"
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.get(PUBMED_SEARCH, params={"db": "pubmed", "term": query, "retmode": "json",
                                                   "retmax": limit, "sort": "relevance"})
            ids = r.json().get("esearchresult", {}).get("idlist", [])
            if not ids and len(terms) > 1:  # too narrow; relax to the top term
                r = await c.get(PUBMED_SEARCH, params={"db": "pubmed", "retmode": "json", "retmax": limit,
                                                       "term": f"({terms[0]}) AND Case Reports[ptyp]"})
                ids = r.json().get("esearchresult", {}).get("idlist", [])
            if not ids:
                return []
            s = await c.get(PUBMED_SUMMARY, params={"db": "pubmed", "id": ",".join(ids), "retmode": "json"})
            res = s.json().get("result", {})
        out = [{
            "pmid": i,
            "title": res.get(i, {}).get("title", ""),
            "journal": res.get(i, {}).get("source", ""),
            "year": (res.get(i, {}).get("pubdate", "") or "")[:4],
            "url": f"https://pubmed.ncbi.nlm.nih.gov/{i}/",
        } for i in ids if i in res]
        _cache[key] = out
        return out
    except Exception as e:
        log.info("PubMed lookup failed: %s", e)
        return []


async def recruiting_trials(terms: list[str], limit: int = 3) -> list[dict]:
    if config.OFFLINE or not terms:
        return []
    key = ("ctgov", tuple(terms), limit)
    if key in _cache:
        return _cache[key]
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            params = {
                "query.cond": terms[0],
                "filter.overallStatus": "RECRUITING",
                "pageSize": limit,
                "fields": "NCTId,BriefTitle,Phase,OverallStatus,Condition,LeadSponsorName",
            }
            if len(terms) > 1:
                params["query.term"] = " ".join(terms[1:3])
            r = await c.get(CTGOV, params=params)
            studies = r.json().get("studies", [])
        out = []
        for s in studies:
            p = s.get("protocolSection", {})
            ident = p.get("identificationModule", {})
            nct = ident.get("nctId")
            out.append({
                "nct_id": nct,
                "title": ident.get("briefTitle"),
                "phases": p.get("designModule", {}).get("phases", []),
                "conditions": p.get("conditionsModule", {}).get("conditions", []),
                "sponsor": p.get("sponsorCollaboratorsModule", {}).get("leadSponsor", {}).get("name"),
                "url": f"https://clinicaltrials.gov/study/{nct}",
            })
        _cache[key] = out
        return out
    except Exception as e:
        log.info("ClinicalTrials.gov lookup failed: %s", e)
        return []


async def evidence(terms: list[str]) -> tuple[list[dict], list[dict]]:
    return await asyncio.gather(pubmed_case_reports(terms), recruiting_trials(terms))
