from __future__ import annotations

import pytest

pytestmark = pytest.mark.db


async def test_register_login_me_update(client) -> None:
    r = await client.post(
        "/api/v1/auth/register", json={"email": "Bob@Example.com", "password": "password123"}
    )
    assert r.status_code == 201
    assert r.json()["message"] == "user created" and r.json()["user_id"]
    r = await client.post("/api/v1/auth/login", json={"email": "bob@example.com", "password": "password123"})
    assert r.status_code == 200
    token = r.json()
    assert token["token_type"] == "bearer" and token["expires_in"] > 0
    headers = {"Authorization": f"Bearer {token['access_token']}"}
    me = (await client.get("/api/v1/auth/me", headers=headers)).json()
    assert me["email"] == "bob@example.com" and me["full_name"] is None
    r = await client.patch("/api/v1/auth/me", headers=headers, json={"full_name": "Bob B"})
    assert r.status_code == 200 and r.json()["full_name"] == "Bob B"


async def test_duplicate_and_bad_credentials(client) -> None:
    body = {"email": "c@example.com", "password": "password123"}
    assert (await client.post("/api/v1/auth/register", json=body)).status_code == 201
    r = await client.post("/api/v1/auth/register", json=body)
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "conflict" and r.json()["detail"] == "Email already registered"
    r = await client.post("/api/v1/auth/login", json={"email": "c@example.com", "password": "wrong-pass"})
    assert r.status_code == 401
    r = await client.post("/api/v1/auth/login", json={"email": "nobody@example.com", "password": "whatever1"})
    assert r.status_code == 401


async def test_validation_envelope(client) -> None:
    r = await client.post("/api/v1/auth/register", json={"email": "not-an-email", "password": "short"})
    assert r.status_code == 422
    body = r.json()
    assert body["error"]["code"] == "validation_error"
    assert {tuple(d["loc"])[-1] for d in body["error"]["details"]} == {"email", "password"}
    assert r.headers["x-request-id"]


async def test_protected_routes_require_valid_token(client) -> None:
    assert (await client.get("/api/v1/auth/me")).status_code == 401
    r = await client.get("/api/v1/documents", headers={"Authorization": "Bearer not.a.jwt"})
    assert r.status_code == 401 and r.headers["www-authenticate"] == "Bearer"


async def test_rate_limit_on_login(client, monkeypatch) -> None:
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "rate_limit_auth", "3/minute")
    codes = [
        (
            await client.post("/api/v1/auth/login", json={"email": "x@example.com", "password": "p"})
        ).status_code
        for _ in range(4)
    ]
    assert codes[:3] == [401, 401, 401] and codes[3] == 429


async def test_auth_limit_ignores_spoofed_forwarded_for(app, client, monkeypatch) -> None:
    """A new fake first X-Forwarded-For hop per request must not reset the per-IP limit."""
    from sqlalchemy import text

    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "rate_limit_auth", "3/minute")
    codes = []
    for i in range(4):
        headers = {"X-Forwarded-For": f"10.0.0.{i}, 203.0.113.7"}
        body = {"email": f"spoof{i}@example.com", "password": "password1"}
        codes.append((await client.post("/api/v1/auth/login", json=body, headers=headers)).status_code)
    if codes != [401, 401, 401, 429]:  # a minute boundary may fall between the calls
        codes = [
            (
                await client.post(
                    "/api/v1/auth/login",
                    json={"email": f"again{i}@example.com", "password": "password1"},
                    headers={"X-Forwarded-For": f"10.9.9.{i}, 203.0.113.7"},
                )
            ).status_code
            for i in range(4)
        ]
    assert codes[3] == 429 and codes.count(429) == 1
    # Counted in Postgres (survives restarts) under the real (right-most) hop, not the spoofed one.
    async with app.state.db.sessionmaker() as s:
        keys = (await s.execute(text("SELECT key FROM usage_counters WHERE key LIKE 'rl:%'"))).scalars().all()
    assert keys and all("ip:203.0.113.7" in k for k in keys)


async def test_cf_connecting_ip_preferred_over_forwarded_for(client, monkeypatch) -> None:
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "rate_limit_auth", "2/minute")
    body = {"email": "cf@example.com", "password": "password1"}
    a = {"CF-Connecting-IP": "198.51.100.1", "X-Forwarded-For": "198.51.100.9"}
    b = {"CF-Connecting-IP": "198.51.100.2", "X-Forwarded-For": "198.51.100.9"}
    codes_a = [(await client.post("/api/v1/auth/login", json=body, headers=a)).status_code for _ in range(2)]
    r = await client.post("/api/v1/auth/login", json=body, headers=b)
    assert codes_a == [401, 401] and r.status_code == 401  # separate IPs, separate budgets


async def test_per_account_failed_login_limit(client, monkeypatch) -> None:
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "login_failures_per_email", 3)
    reg = {"email": "victim@example.com", "password": "password123"}
    assert (await client.post("/api/v1/auth/register", json=reg)).status_code == 201
    codes = []
    for i in range(3):  # each guess from a different IP: the per-IP limit alone would not stop this
        r = await client.post(
            "/api/v1/auth/login",
            json={"email": " Victim@Example.com", "password": f"guess-{i}xx"},
            headers={"CF-Connecting-IP": f"192.0.2.{i}"},
        )
        codes.append(r.status_code)
    assert codes == [401, 401, 401]
    r = await client.post(
        "/api/v1/auth/login",
        json={"email": "victim@example.com", "password": "password123"},
        headers={"CF-Connecting-IP": "192.0.2.99"},
    )
    assert r.status_code == 429 and r.json()["error"]["code"] == "rate_limited"
    assert int(r.headers["Retry-After"]) > 0
    # Other accounts are unaffected.
    r = await client.post("/api/v1/auth/login", json={"email": "other@example.com", "password": "whatever1"})
    assert r.status_code == 401


async def test_signup_quota_runs_before_exists_check(client, monkeypatch) -> None:
    """Probing existing emails via 409 is bounded by the per-IP signup quota."""
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "signups_per_ip_day", 2)
    ip = {"CF-Connecting-IP": "203.0.113.50"}
    body = {"email": "taken@example.com", "password": "password123"}
    assert (await client.post("/api/v1/auth/register", json=body, headers=ip)).status_code == 201
    assert (await client.post("/api/v1/auth/register", json=body, headers=ip)).status_code == 409
    r = await client.post("/api/v1/auth/register", json=body, headers=ip)
    assert r.status_code == 429  # no further existence answers from this IP today


def test_email_hash_normalises_and_hides_address() -> None:
    from app.config import get_settings
    from app.ratelimit import email_hash

    s = get_settings()
    h = email_hash(s, " Alice@Example.COM ")
    assert h == email_hash(s, "alice@example.com") and "alice" not in h and len(h) == 32
    assert h != email_hash(s, "bob@example.com")


async def test_health_and_ready(client) -> None:
    assert (await client.get("/health")).json()["status"] == "ok"
    r = await client.get("/ready")
    body = r.json()
    assert body["checks"]["database"] == "ok" and body["checks"]["pgvector"] != "missing"
    assert body["checks"]["llm"] == "not configured"
