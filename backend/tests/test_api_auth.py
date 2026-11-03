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


async def test_health_and_ready(client) -> None:
    assert (await client.get("/health")).json()["status"] == "ok"
    r = await client.get("/ready")
    body = r.json()
    assert body["checks"]["database"] == "ok" and body["checks"]["pgvector"] != "missing"
    assert body["checks"]["llm"] == "not configured"
