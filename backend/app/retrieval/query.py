"""Query understanding: classification and conversational reformulation."""

from __future__ import annotations

import logging
import re

from app.providers.llm import ChatMessage, LLMError, LLMProvider

logger = logging.getLogger(__name__)

FACT, COMPARISON, SUMMARY = "fact", "comparison", "summary"

_COMPARISON = re.compile(
    r"\b(compare|comparison|comparing|contrast|versus|vs\.?|differ|differs|difference|differences|"
    r"similarit(?:y|ies)|in common|across (?:the|these|all|both) (?:documents|agreements|contracts))\b",
    re.IGNORECASE,
)
_SUMMARY = re.compile(
    r"\b(summar(?:y|ise|ize|ising|izing)|overview|outline|tl;?dr|gist|key (?:points|terms|takeaways)|"
    r"main (?:points|terms|provisions)|what is (?:this|the) (?:document|agreement|contract) about|"
    r"describe (?:this|the) (?:document|agreement|contract))\b",
    re.IGNORECASE,
)


def classify_query(question: str, n_documents: int) -> str:
    """Rule-based intent: whole-word patterns, and comparison only makes sense across 2+ docs."""
    if n_documents >= 2 and _COMPARISON.search(question):
        return COMPARISON
    if _SUMMARY.search(question):
        return SUMMARY
    return FACT


_REWRITE_SYSTEM = (
    "Rewrite the user's latest question into a single standalone search query that can be "
    "understood without the conversation. Resolve pronouns and references using the "
    "conversation. Keep names, numbers and defined terms exactly. Do not answer the question. "
    "Return only the rewritten query on one line."
)


async def reformulate(llm: LLMProvider | None, question: str, history: list[tuple[str, str]]) -> str:
    """Return a standalone query. Only called when there is history; falls back to the input."""
    if llm is None or not history:
        return question
    convo = "\n".join(f"{'User' if role == 'user' else 'Assistant'}: {text[:600]}" for role, text in history)
    messages = [
        ChatMessage("system", _REWRITE_SYSTEM),
        ChatMessage("user", f"Conversation:\n{convo}\n\nLatest question: {question}\n\nStandalone query:"),
    ]
    try:
        result = await llm.complete(messages, max_tokens=96, temperature=0.0)
    except LLMError as exc:
        logger.warning("reformulation_failed", extra={"error": str(exc)[:200]})
        return question
    rewritten = result.text.strip().strip('"').strip("'").splitlines()[0].strip() if result.text else ""
    if not rewritten or len(rewritten) > 4 * max(len(question), 60):
        return question
    return rewritten
