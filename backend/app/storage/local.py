"""Local filesystem driver for development and tests.

Keys are generated server-side (uuid hex), never derived from user input, but they are
still validated so a key can never escape the storage root.
"""

from __future__ import annotations

import asyncio
import re
from pathlib import Path

from app.storage import ObjectNotFoundError

_KEY_RE = re.compile(r"^[a-z0-9][a-z0-9/_-]{0,127}$")


class LocalStorage:
    def __init__(self, root: str) -> None:
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        if not _KEY_RE.match(key) or ".." in key:
            raise ValueError("invalid storage key")
        path = (self.root / key).resolve()
        if self.root not in path.parents:
            raise ValueError("invalid storage key")
        return path

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        path = self._path(key)

        def _write() -> None:
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".tmp")
            tmp.write_bytes(data)
            tmp.replace(path)

        await asyncio.to_thread(_write)

    async def get(self, key: str) -> bytes:
        path = self._path(key)
        try:
            return await asyncio.to_thread(path.read_bytes)
        except FileNotFoundError as exc:
            raise ObjectNotFoundError(key) from exc

    async def delete(self, key: str) -> None:
        path = self._path(key)
        await asyncio.to_thread(path.unlink, True)

    async def check(self) -> None:
        if not self.root.is_dir():
            raise RuntimeError(f"storage root missing: {self.root}")
