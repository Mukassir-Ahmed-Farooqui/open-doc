"""Object storage: S3-compatible (R2, MinIO, Railway buckets, GCS interop) or local filesystem."""

from __future__ import annotations

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

    return LocalStorage(settings.local_storage_dir)
