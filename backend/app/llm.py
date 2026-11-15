"""Language-model calls. Models only ever see retrieved passages plus the computed rating.
Model names come from the environment (GEMINI_MODEL, CLAUDE_MODEL); none are hardcoded."""
from __future__ import annotations

import asyncio
import json
import re

from pydantic import BaseModel, Field, ValidationError, field_validator

from . import config

SYSTEM_ANSWER = """You are an evidence analyst for spacecraft fire-safety research. You answer ONLY from the numbered passages you are given.

Rules:
- Use only the passages. Do not use anything you remember about NASA, materials, or combustion.
- Every factual statement goes in "claims", each with the passage id(s) it came from and a "quote": words copied exactly from that passage, under 25 words.
- Never write a number that is not inside the quote you give for that claim.
- If the passages do not answer the question, say "unknown" and list what is missing under "gaps".
- The evidence rating is computed by code. You may explain it. You may not change it or contradict it.
- Never say a material is safe, unsafe, approved, or recommended. Never advise using a material. Report what was tested and what was observed.
- Never state or estimate a flame spread rate unless a passage prints one.
- A blank or "ending unstated" outcome is unknown. Do not turn it into "burned out" or "extinguished".
- Keep material names exact (SIBAL is a cotton/fiberglass blend, not "cotton"; PMMA is a plastic, not a fabric).
- Plain language first. Explain any jargon in a few words.

Return strict JSON only, no markdown:
{"summary": string, "claims": [{"text": string, "source_ids": [string], "quote": string, "tier": 1|2|3}], "gaps": [string], "applied_conditions": {"material": string|null, "o2_pct": number|null, "flow_cm_s": number|null, "pressure_kpa": number|null, "gravity": string|null} | null}"""

SYSTEM_EXTRACT = """Extract test conditions from the user's question. Return strict JSON only:
{"material": string|null, "o2_pct": number|null, "flow_cm_s": number|null, "pressure_kpa": number|null, "gravity": "0g"|"1g"|"moon"|"mars"|"partial"|null}
Use null for anything the question does not state. Never guess a number. "material" must be one of the allowed names or null."""

SYSTEM_SEARCH = """Find NASA or primary-source pages that answer the question about spacecraft fire safety or microgravity combustion. Search only these sites: {domains}. Prefer ntrs.nasa.gov and psi.nasa.gov. Reply with one short sentence; the cited pages are what matters."""


class Claim(BaseModel):
    text: str = Field(min_length=3, max_length=600)
    source_ids: list[str] = Field(min_length=1)
    quote: str = Field(min_length=3, max_length=400)
    tier: int = 1

    @field_validator("source_ids", mode="before")
    @classmethod
    def _ids(cls, v):
        return [str(x).strip().strip("[]") for x in (v if isinstance(v, list) else [v])]


class Conditions(BaseModel):
    material: str | None = None
    o2_pct: float | None = Field(default=None, gt=0, le=100)
    flow_cm_s: float | None = Field(default=None, ge=0, le=1000)
    pressure_kpa: float | None = Field(default=None, gt=0, le=1000)
    gravity: str | None = None

    @field_validator("gravity")
    @classmethod
    def _g(cls, v):
        return v if v in (None, "0g", "1g", "moon", "mars", "partial") else None


class Answer(BaseModel):
    summary: str = Field(min_length=1, max_length=2500)
    claims: list[Claim] = []
    gaps: list[str] = []
    applied_conditions: Conditions | None = None


def parse_json(text: str) -> dict:
    text = (text or "").strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    i, j = text.find("{"), text.rfind("}")
    if i < 0 or j <= i:
        raise ValueError("no JSON object in model output")
    return json.loads(text[i : j + 1])


# ----------------------------------------------------------------- Gemini
async def gemini_text(system: str, user: str, json_mode: bool = True) -> str:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=config.GEMINI_KEY())
    cfg = types.GenerateContentConfig(system_instruction=system, temperature=0.1, response_mime_type="application/json" if json_mode else None)
    resp = await asyncio.wait_for(client.aio.models.generate_content(model=config.GEMINI_MODEL(), contents=user, config=cfg), timeout=config.LLM_TIMEOUT_S)
    return resp.text or ""


async def gemini_search_urls(question: str, domains: list[str]) -> list[dict]:
    """Gemini with Google Search grounding + URL context. Only the grounding metadata is used."""
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=config.GEMINI_KEY())
    tools = [types.Tool(google_search=types.GoogleSearch())]
    if hasattr(types, "UrlContext"):
        tools.append(types.Tool(url_context=types.UrlContext()))
    cfg = types.GenerateContentConfig(system_instruction=SYSTEM_SEARCH.format(domains=", ".join(domains)), temperature=0.0, tools=tools)
    q = question + "\n\nRestrict to: " + " OR ".join(f"site:{d}" for d in domains)
    resp = await asyncio.wait_for(client.aio.models.generate_content(model=config.GEMINI_MODEL(), contents=q, config=cfg), timeout=config.LLM_TIMEOUT_S)
    out: list[dict] = []
    for cand in getattr(resp, "candidates", None) or []:
        gm = getattr(cand, "grounding_metadata", None)
        for ch in getattr(gm, "grounding_chunks", None) or []:
            web = getattr(ch, "web", None)
            if web and getattr(web, "uri", None):
                out.append({"url": web.uri, "title": getattr(web, "title", "") or ""})
        um = getattr(cand, "url_context_metadata", None)
        for m in getattr(um, "url_metadata", None) or []:
            if getattr(m, "retrieved_url", None):
                out.append({"url": m.retrieved_url, "title": ""})
    return out


# ----------------------------------------------------------------- Claude
async def claude_text(system: str, user: str) -> str:
    import anthropic

    client = anthropic.AsyncAnthropic(api_key=config.ANTHROPIC_KEY(), timeout=config.LLM_TIMEOUT_S, max_retries=1)
    msg = await client.messages.create(model=config.CLAUDE_MODEL(), max_tokens=1800, temperature=0.1, system=system, messages=[{"role": "user", "content": user}])
    return "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")


async def claude_search_urls(question: str, domains: list[str]) -> list[dict]:
    """Claude with its server-side web search tool restricted to the allowlist."""
    import anthropic

    client = anthropic.AsyncAnthropic(api_key=config.ANTHROPIC_KEY(), timeout=config.LLM_TIMEOUT_S * 2, max_retries=1)
    tool = {"type": config.CLAUDE_WEB_SEARCH_TOOL(), "name": "web_search", "max_uses": 3, "allowed_domains": domains}
    msg = await client.messages.create(model=config.CLAUDE_MODEL(), max_tokens=1024, system=SYSTEM_SEARCH.format(domains=", ".join(domains)), messages=[{"role": "user", "content": question}], tools=[tool])
    out: list[dict] = []
    for b in msg.content:
        t = getattr(b, "type", "")
        if t == "web_search_tool_result" and isinstance(getattr(b, "content", None), list):
            for r in b.content:
                if getattr(r, "url", None):
                    out.append({"url": r.url, "title": getattr(r, "title", "") or ""})
        if t == "text":
            for c in getattr(b, "citations", None) or []:
                if getattr(c, "url", None):
                    out.append({"url": c.url, "title": getattr(c, "title", "") or ""})
    return out


# ------------------------------------------------------------- high level
async def generate_answer(user_prompt: str) -> tuple[Answer | None, str | None, list[str]]:
    """Try Gemini, then Claude. Each gets one retry on invalid JSON. Returns (answer, engine, errors)."""
    errors: list[str] = []
    engines = []
    if config.gemini_ready():
        engines.append(("gemini", lambda p: gemini_text(SYSTEM_ANSWER, p)))
    if config.claude_ready():
        engines.append(("claude", lambda p: claude_text(SYSTEM_ANSWER, p)))
    for name, call in engines:
        prompt = user_prompt
        for attempt in (1, 2):
            try:
                return Answer.model_validate(parse_json(await call(prompt))), name, errors
            except (ValidationError, ValueError, json.JSONDecodeError) as e:
                errors.append(f"{name} attempt {attempt}: invalid JSON ({str(e)[:120]})")
                prompt = user_prompt + "\n\nYour previous reply was not valid JSON for the required schema. Return only the JSON object."
            except Exception as e:  # timeout, quota, network, bad key
                errors.append(f"{name}: {type(e).__name__}: {str(e)[:160]}")
                break
    return None, None, errors


async def extract_conditions(question: str, materials: list[str]) -> dict | None:
    user = f"Allowed material names: {materials}\nQuestion: {question}"
    for ready, call in ((config.gemini_ready(), lambda: gemini_text(SYSTEM_EXTRACT, user)), (config.claude_ready(), lambda: claude_text(SYSTEM_EXTRACT, user))):
        if not ready:
            continue
        try:
            c = Conditions.model_validate(parse_json(await call()))
            d = c.model_dump()
            if d["material"] not in materials:
                d["material"] = None
            return d
        except Exception:
            continue
    return None
