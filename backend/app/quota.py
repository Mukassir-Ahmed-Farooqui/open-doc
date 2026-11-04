"""Postgres-backed quotas for the public beta.

Counters live in ``usage_counters`` (fixed windows: the key embeds the UTC minute or day), so
limits survive restarts, deploys and several workers. Each check is one transaction of atomic
``INSERT ... ON CONFLICT DO UPDATE ... WHERE count < limit`` statements: if any limit is already
reached the whole transaction rolls back, so a rejected request consumes nothing and concurrent
requests cannot overshoot.
"""

from __future__ import annotations

import logging
import random
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from fastapi import Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings, get_settings
from app.errors import AppError

logger = logging.getLogger(__name__)

_HIT_SQL = text(
    """
    INSERT INTO usage_counters (key, count, expires_at) VALUES (:key, 1, :expires_at)
    ON CONFLICT (key) DO UPDATE SET count = usage_counters.count + 1
    WHERE usage_counters.count < :limit
    RETURNING count
    """
)
_REFUND_SQL = text("UPDATE usage_counters SET count = GREATEST(count - 1, 0) WHERE key = :key")
_PURGE_SQL = text("DELETE FROM usage_counters WHERE expires_at < now()")


@dataclass(frozen=True, slots=True)
class Limit:
    key: str
    limit: int
    expires_at: datetime
    message: str
    retry_after: int
    reason: str
    refundable: bool = True


class QuotaExceededError(Exception):
    def __init__(self, limit: Limit) -> None:
        super().__init__(limit.message)
        self.limit = limit


def _day_window(now: datetime) -> tuple[str, datetime, int]:
    tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return now.strftime("%Y%m%d"), tomorrow, max(1, int((tomorrow - now).total_seconds()))


def _minute_window(now: datetime) -> tuple[str, datetime, int]:
    start = now.replace(second=0, microsecond=0)
    nxt = start + timedelta(minutes=1)
    return start.strftime("%Y%m%d%H%M"), nxt, max(1, int((nxt - now).total_seconds()))


async def consume(sm: async_sessionmaker[AsyncSession], limits: list[Limit]) -> None:
    """Increment every counter or none. Raises ``QuotaExceededError`` for the first full one."""
    async with sm() as session, session.begin():
        for lim in limits:
            if lim.limit <= 0:
                raise QuotaExceededError(lim)
            row = (
                await session.execute(
                    _HIT_SQL, {"key": lim.key, "expires_at": lim.expires_at, "limit": lim.limit}
                )
            ).first()
            if row is None:
                raise QuotaExceededError(lim)  # rolls back the increments already made
        if random.random() < 0.02:  # noqa: S311 - housekeeping, not security
            await session.execute(_PURGE_SQL)


async def refund(sm: async_sessionmaker[AsyncSession], keys: list[str]) -> None:
    try:
        async with sm() as session, session.begin():
            for key in keys:
                await session.execute(_REFUND_SQL, {"key": key})
    except Exception:
        logger.exception("quota_refund_failed")


def ai_limits(settings: Settings, user_id: uuid.UUID, now: datetime | None = None) -> list[Limit]:
    now = now or datetime.now(UTC)
    day, day_end, day_left = _day_window(now)
    minute, minute_end, minute_left = _minute_window(now)
    return [
        Limit(
            f"ai:user:{user_id}:m:{minute}",
            settings.ai_questions_per_user_minute,
            minute_end,
            f"You can ask up to {settings.ai_questions_per_user_minute} questions a minute. "
            "Please wait a moment.",
            minute_left,
            "user_minute",
            refundable=False,
        ),
        Limit(
            f"ai:user:{user_id}:d:{day}",
            settings.ai_questions_per_user_day,
            day_end,
            f"You've used today's {settings.ai_questions_per_user_day} questions. "
            "Your limit resets at midnight UTC.",
            day_left,
            "user_day",
        ),
        Limit(
            f"ai:global:d:{day}",
            settings.ai_questions_global_day,
            day_end,
            "OpenDoc has reached today's question capacity for the beta. Please try again tomorrow.",
            day_left,
            "global_day",
            refundable=False,
        ),
    ]


@dataclass(slots=True)
class AIReservation:
    """A consumed question. ``refund()`` returns the per-user daily unit when generation fails
    for reasons that are not the user's fault (provider error, timeout)."""

    sm: async_sessionmaker[AsyncSession]
    keys: list[str] = field(default_factory=list)
    refunded: bool = False

    async def refund(self) -> None:
        if self.refunded or not self.keys:
            return
        self.refunded = True
        await refund(self.sm, self.keys)


def _raise_for(exc: QuotaExceededError, **extra: object) -> None:
    lim = exc.limit
    logger.warning("quota_rejected", extra={"reason": lim.reason, **extra})
    if lim.reason == "global_day":
        logger.error("ai_global_budget_exhausted", extra={"limit": lim.limit})
    raise AppError(
        429,
        lim.message,
        code="quota_exceeded" if lim.reason != "user_minute" else "rate_limited",
        details={"reason": lim.reason, "limit": lim.limit, "retry_after": lim.retry_after},
        headers={"Retry-After": str(lim.retry_after)},
    ) from None


async def reserve_ai(request: Request, user_id: uuid.UUID) -> AIReservation:
    settings = get_settings()
    if not settings.ai_enabled:
        logger.warning("ai_kill_switch_active")
        raise AppError(
            503,
            "AI answers are temporarily paused. Your documents are safe; please try again later.",
            code="ai_disabled",
            headers={"Retry-After": "600"},
        )
    sm: async_sessionmaker[AsyncSession] = request.app.state.db.sessionmaker
    limits = ai_limits(settings, user_id)
    try:
        await consume(sm, limits)
    except QuotaExceededError as exc:
        _raise_for(exc, user_id=str(user_id))
    logger.info("quota_consumed", extra={"user_id": str(user_id), "kind": "ai_question"})
    return AIReservation(sm=sm, keys=[lim.key for lim in limits if lim.refundable])


def client_ip(request: Request) -> str:
    """Client address behind Render's proxy. ``CF-Connecting-IP`` / ``True-Client-IP`` are set by
    the edge; otherwise the right-most ``X-Forwarded-For`` hop (appended by the last proxy, not
    client-controlled)."""
    for header in ("cf-connecting-ip", "true-client-ip"):
        value = request.headers.get(header)
        if value:
            return value.strip()
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


async def check_signup(request: Request) -> None:
    settings = get_settings()
    ip = client_ip(request)
    now = datetime.now(UTC)
    day, day_end, day_left = _day_window(now)
    lim = Limit(
        f"signup:ip:{ip}:d:{day}",
        settings.signups_per_ip_day,
        day_end,
        "Too many accounts have been created from this network today. Please try again tomorrow.",
        day_left,
        "signup_ip_day",
        refundable=False,
    )
    try:
        await consume(request.app.state.db.sessionmaker, [lim])
    except QuotaExceededError as exc:
        _raise_for(exc, ip=ip)
    logger.info("signup_attempt", extra={"ip": ip})
