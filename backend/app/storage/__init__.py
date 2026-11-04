"""Object storage: S3-compatible (R2, MinIO, Railway buckets, GCS interop) or local filesystem."""

from __future__ import annotations

from pathlib import Path
from typing import Protocol

from app.config import Settings


class ObjectStorage(Protocol):
    async def put(self, key: str, data: bytes, content_type: str) -> None: ...

    async def get(self, key: str) -> bytes: ...

    async def delete(self, key: str) -> None: ...

    async def check(self) -> None:
        """Raise if the backend is unreachable."""


class ObjectNotFoundError(Exception):
    pass


def build_storage(settings: Settings) -> ObjectStorage:
    if settings.storage_backend == "s3":
        from app.storage.s3 import S3Storage

        return S3Storage(settings)
    from app.storage.local import LocalStorage

    return LocalStorage(str(resolve_local_root(settings.local_storage_dir)))


# backend/ — the directory that holds the ``app`` package.
_BACKEND_DIR = Path(__file__).resolve().parents[2]


def resolve_local_root(root: str) -> Path:
    """Anchor a relative ``LOCAL_STORAGE_DIR`` to ``backend/`` instead of the process cwd,
    so starting uvicorn from another directory never "loses" files uploaded earlier."""
    path = Path(root).expanduser()
    return path if path.is_absolute() else (_BACKEND_DIR / path).resolve()
