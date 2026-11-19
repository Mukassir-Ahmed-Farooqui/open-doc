"""Request rate limits as a FastAPI dependency, stored in Postgres (``usage_counters``).

Keyed by the JWT subject when a valid bearer token is present, otherwise by the client IP from
``quota.client_ip()`` (edge header / right-most ``X-Forwarded-For`` hop, never the
client-controlled first hop). Counters are fixed windows (the key embeds the window start), so
limits survive restarts, deploys and several workers, the same way the beta quotas do.

Also holds the per-account failed-login limit: failures are counted per keyed hash of the
normalised email, so the raw address never lands in the counters table or the logs.
"""

from __future__ import annotations

import contextlib
import hashlib
import hmac
import logging
import math
import time
from datetime import UTC, datetime

import jwt
from fastapi import Request
from sqlalchemy import text

from app.auth.security import decode_access_token
from app.config import Settings, get_settings
from app.errors import AppError
from app.quota import Limit, QuotaExceededError, client_ip, consume

logger = logging.getLogger(__name__)

_UNITS = {"second": 1, "minute": 60, "hour": 3600, "day": 86400}


def parse_limit(spec: str) -> tuple[int, int]:
    count, _, unit = spec.partition("/")
    unit = unit.strip().rstrip("s")
    if unit not in _UNITS:
        raise ValueError(f"invalid rate limit: {spec!r}")
    return int(count), _UNITS[unit]


def _window(window: int, now: float | None = None) -> tuple[int, datetime, int]:
    """Fixed window containing ``now``: (window start epoch, window end, seconds left)."""
    now = time.time() if now is None else now
    start = int(now // window) * window
    end = start + window
    return start, datetime.fromtimestamp(end, UTC), max(1, math.ceil(end - now))


def client_key(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        try:
            return "user:" + str(decode_access_token(get_settings(), auth[7:].strip())["sub"])
        except jwt.InvalidTokenError:
            pass
    return "ip:" + client_ip(request)


def _too_many(retry: int, message: str = "Too many requests, slow down.") -> AppError:
    return AppError(429, message, code="rate_limited", headers={"Retry-After": str(retry)})


def rate_limit(setting_name: str):
    async def dependency(request: Request) -> None:
        limit, window = parse_limit(getattr(get_settings(), setting_name))
        scope = request.scope.get("route").path if request.scope.get("route") else request.url.path
        start, end, left = _window(window)
        lim = Limit(
            f"rl:{setting_name}:{scope}:{client_key(request)}:w:{start}"[:200],
            limit,
            end,
            "Too many requests, slow down.",
            left,
            setting_name,
            refundable=False,
        )
        try:
            await consume(request.app.state.db.sessionmaker, [lim])
        except QuotaExceededError:
            logger.warning("rate_limited", extra={"limit": setting_name, "path": scope})
            raise _too_many(left) from None

    return dependency


# ── Per-account failed-login limit ──


def email_hash(settings: Settings, email: str) -> str:
    """Keyed hash of the normalised email (HMAC with the server secret, so it can't be reversed
    with a dictionary of addresses). Used for counters and logs instead of the address."""
    normalised = email.strip().lower().encode()
    return hmac.new(settings.jwt_secret_key.encode(), normalised, hashlib.sha256).hexdigest()[:32]


def _login_failure_limit(settings: Settings, ehash: str) -> Limit:
    start, end, left = _window(settings.login_failure_window_minutes * 60)
    return Limit(
        f"login_fail:{ehash}:w:{start}",
        settings.login_failures_per_email,
        end,
        "Too many failed sign-in attempts for this account. Please wait and try again.",
        left,
        "login_failures_email",
        refundable=False,
    )


_COUNT_SQL = text("SELECT count FROM usage_counters WHERE key = :key AND expires_at > now()")


async def check_login_allowed(request: Request, settings: Settings, ehash: str) -> None:
    """Reject (429) before any password check once an account has too many recent failures."""
    lim = _login_failure_limit(settings, ehash)
    async with request.app.state.db.sessionmaker() as session:
        count = (await session.execute(_COUNT_SQL, {"key": lim.key})).scalar()
    if count is not None and count >= lim.limit:
        logger.warning(
            "login_locked", extra={"email_hash": ehash, "ip": client_ip(request), "limit": lim.limit}
        )
        raise _too_many(lim.retry_after, lim.message)


async def record_login_failure(request: Request, settings: Settings, ehash: str) -> None:
    lim = _login_failure_limit(settings, ehash)
    # Already at the limit: nothing to add; the next attempt is rejected by check_login_allowed.
    with contextlib.suppress(QuotaExceededError):
        await consume(request.app.state.db.sessionmaker, [lim])
