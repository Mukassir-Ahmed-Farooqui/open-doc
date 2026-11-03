"""S3-compatible driver (AWS S3, Cloudflare R2, MinIO, Railway buckets).

boto3 is synchronous, so calls run in a worker thread to keep the event loop free.
"""

from __future__ import annotations

import asyncio

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.config import Settings
from app.storage import ObjectNotFoundError


class S3Storage:
    def __init__(self, settings: Settings) -> None:
        if not settings.s3_bucket:
            raise ValueError("S3_BUCKET is required for the s3 storage backend")
        self.bucket = settings.s3_bucket
        self.client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint_url,
            region_name=settings.s3_region,
            aws_access_key_id=settings.s3_access_key_id,
            aws_secret_access_key=settings.s3_secret_access_key,
            config=Config(retries={"max_attempts": 3, "mode": "standard"}, signature_version="s3v4"),
        )

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        await asyncio.to_thread(
            self.client.put_object, Bucket=self.bucket, Key=key, Body=data, ContentType=content_type
        )

    async def get(self, key: str) -> bytes:
        def _get() -> bytes:
            try:
                obj = self.client.get_object(Bucket=self.bucket, Key=key)
            except ClientError as exc:
                if exc.response.get("Error", {}).get("Code") in {"NoSuchKey", "404"}:
                    raise ObjectNotFoundError(key) from exc
                raise
            return obj["Body"].read()

        return await asyncio.to_thread(_get)

    async def delete(self, key: str) -> None:
        await asyncio.to_thread(self.client.delete_object, Bucket=self.bucket, Key=key)

    async def check(self) -> None:
        await asyncio.to_thread(self.client.head_bucket, Bucket=self.bucket)
