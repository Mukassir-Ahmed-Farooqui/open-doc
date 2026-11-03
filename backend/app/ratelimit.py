"""Small in-memory sliding-window rate limiter used as a FastAPI dependency.

Keyed by the JWT subject when a bearer token is present (signature verified), otherwise by the
client IP (first X-Forwarded-For hop, as set by Railway / Cloud Run front ends). State is
per-process: with several instances the effective limit is per instance, which is acceptable
for abuse protection on free-tier hosting and avoids a Redis dependency.
"""

from __future__ import annotations

import asyncio
import math
import time
from collections import defaultdict, deque

import jwt
from fastapi import Request

from app.auth.security import decode_access_token
from app.config import get_settings
from app.errors import AppError

_UNITS = {"second": 1, "minute": 60, "hour": 3600, "day": 86400}


def parse_limit(spec: str) -> tuple[int, int]:
    count, _, unit = spec.partition("/")
    unit = unit.strip().rstrip("s")
    if unit not in _UNITS:
        raise ValueError(f"invalid rate limit: {spec!r}")
    return int(count), _UNITS[unit]


class SlidingWindowLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = asyncio.Lock()

    async def hit(self, key: str, limit: int, window: int) -> float | None:
        """Record a hit; return seconds to wait if over the limit, else None."""
        now = time.monotonic()
        async with self._lock:
            q = self._hits[key]
            while q and q[0] <= now - window:
                q.popleft()
            if len(q) >= limit:
                return q[0] + window - now
            q.append(now)
            if len(self._hits) > 50_000:
                for k in [k for k, v in self._hits.items() if not v]:
                    del self._hits[k]
            return None

    def reset(self) -> None:
        self._hits.clear()


limiter = SlidingWindowLimiter()


def client_key(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        try:
            return "user:" + str(decode_access_token(get_settings(), auth[7:].strip())["sub"])
        except jwt.InvalidTokenError:
            pass
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return "ip:" + forwarded.split(",")[0].strip()
    return "ip:" + (request.client.host if request.client else "unknown")


def rate_limit(setting_name: str):
    async def dependency(request: Request) -> None:
        limit, window = parse_limit(getattr(get_settings(), setting_name))
        scope = request.scope.get("route").path if request.scope.get("route") else request.url.path
        wait = await limiter.hit(f"{setting_name}:{scope}:{client_key(request)}", limit, window)
        if wait is not None:
            retry = max(1, math.ceil(wait))
            raise AppError(429, "Too many requests, slow down.", headers={"Retry-After": str(retry)})

    return dependency
