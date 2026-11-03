"""Application settings, loaded from environment variables (and an optional .env file)."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_INSECURE_DEV_SECRET = "dev-only-insecure-secret-change-me"  # noqa: S105 - rejected in production


def _asyncpg_query(url: str) -> str:
    """Translate libpq query options that asyncpg rejects (Neon URLs carry both by default).

    ``sslmode=require`` becomes ``ssl=require`` (asyncpg's equivalent); ``channel_binding`` has no
    asyncpg counterpart and is dropped. Other parameters are left untouched.
    """
    if not url.startswith("postgresql+asyncpg://") or "?" not in url:
        return url
    base, query = url.split("?", 1)
    params: list[str] = []
    for part in query.split("&"):
        key, _, value = part.partition("=")
        if key == "channel_binding" or not part:
            continue
        if key == "sslmode":
            if any(p.startswith("ssl=") for p in query.split("&")):
                continue
            part = f"ssl={value}"
        params.append(part)
    return f"{base}?{'&'.join(params)}" if params else base


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # ── App ──
    app_env: Literal["development", "test", "production"] = "development"
    app_name: str = "OpenDoc API"
    app_version: str = "2.0.0"
    log_level: str = "INFO"
    log_json: bool = True
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])

    # ── Database ──
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/opendoc"
    db_pool_size: int = 5
    db_max_overflow: int = 5
    db_echo: bool = False

    # ── Auth ──
    jwt_secret_key: str = _INSECURE_DEV_SECRET
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60

    # ── Storage ──
    storage_backend: Literal["local", "s3"] = "local"
    local_storage_dir: str = "./data/objects"
    s3_bucket: str | None = None
    s3_endpoint_url: str | None = None
    s3_region: str = "auto"
    s3_access_key_id: str | None = None
    s3_secret_access_key: str | None = None
    max_upload_mb: int = 20

    # ── Embeddings ──
    embedding_provider: Literal["fastembed", "gemini"] = "fastembed"
    embedding_model: str = "BAAI/bge-small-en-v1.5"
    embedding_dim: int = 384
    embedding_batch_size: int = 4
    embedding_cache_size: int = 512
    # BGE v1.5 retrieval instruction; measurably better recall (docs/BENCHMARKS.md). Set "" for other models.
    embedding_query_prefix: str = "Represent this sentence for searching relevant passages: "
    onnx_threads: int = 2
    # ONNX Runtime's CPU memory arena keeps peak activations allocated (measured: ~700 MB RSS after
    # one batch of embeddings vs ~230 MB without it). Keep it off on small instances.
    onnx_mem_arena: bool = False
    fastembed_cache_dir: str | None = None
    gemini_api_key: str | None = None
    gemini_embedding_model: str = "gemini-embedding-001"

    # ── Reranker ──
    reranker_provider: Literal["fastembed", "none"] = "fastembed"
    reranker_model: str = "Xenova/ms-marco-MiniLM-L-6-v2"

    # ── LLM ──
    groq_api_key: str | None = None
    groq_model: str = "llama-3.3-70b-versatile"
    groq_base_url: str = "https://api.groq.com/openai/v1"
    gemini_model: str = "gemini-2.0-flash"
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta"
    llm_timeout_seconds: float = 60.0
    llm_max_tokens: int = 1024
    llm_temperature: float = 0.1

    # ── Chunking ──
    child_target_tokens: int = 300
    child_overlap_tokens: int = 50
    child_min_tokens: int = 40
    section_min_tokens: int = 15
    parent_max_tokens: int = 1200

    # ── Retrieval ──
    retrieval_candidates: int = 30
    rerank_candidates: int = 12
    rerank_passage_words: int = 160
    context_top_k: int = 6
    rrf_k: int = 60
    min_dense_score: float = 0.50
    min_rerank_score: float = -9.0
    history_turns: int = 6
    max_context_tokens: int = 3500
    summary_max_sections: int = 12

    # ── Worker ──
    worker_enabled: bool = True
    worker_concurrency: int = 1
    worker_poll_seconds: float = 5.0
    worker_max_attempts: int = 3
    worker_stale_minutes: int = 15
    warm_models_on_startup: bool = False

    # ── Rate limits (requests per window, per user or client IP) ──
    rate_limit_auth: str = "10/minute"
    rate_limit_query: str = "30/minute"
    rate_limit_upload: str = "30/hour"

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, v: object) -> object:
        if isinstance(v, str):
            stripped = v.strip()
            if stripped.startswith("["):
                return v
            return [o.strip() for o in stripped.split(",") if o.strip()]
        return v

    @field_validator("database_url")
    @classmethod
    def _async_driver(cls, v: str) -> str:
        # Hosts (Railway, Neon, Render) hand out postgres:// or postgresql:// URLs.
        if v.startswith("postgres://"):
            v = "postgresql://" + v[len("postgres://") :]
        if v.startswith("postgresql://"):
            v = "postgresql+asyncpg://" + v[len("postgresql://") :]
        return _asyncpg_query(v)

    @model_validator(mode="after")
    def _production_guards(self) -> Settings:
        if self.app_env == "production":
            if self.jwt_secret_key == _INSECURE_DEV_SECRET or len(self.jwt_secret_key) < 32:
                raise ValueError("JWT_SECRET_KEY must be set to a random value of 32+ chars in production")
            if self.storage_backend == "s3" and not self.s3_bucket:
                raise ValueError("S3_BUCKET is required when STORAGE_BACKEND=s3")
        if self.embedding_provider == "gemini" and not self.gemini_api_key:
            raise ValueError("GEMINI_API_KEY is required when EMBEDDING_PROVIDER=gemini")
        return self

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
