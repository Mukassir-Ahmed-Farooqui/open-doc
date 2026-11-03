"""Consistent error envelope.

Every error response has the shape::

    {"error": {"code": "not_found", "message": "...", "details": ..., "request_id": "..."},
     "detail": "..."}

``detail`` mirrors ``error.message`` so existing clients that read ``response.data.detail``
keep working.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.logging_setup import request_id_var

logger = logging.getLogger(__name__)

_STATUS_CODES = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    413: "payload_too_large",
    415: "unsupported_media_type",
    422: "validation_error",
    429: "rate_limited",
    503: "service_unavailable",
}


class AppError(Exception):
    def __init__(
        self,
        status_code: int,
        message: str,
        code: str | None = None,
        details: Any = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message
        self.code = code or _STATUS_CODES.get(status_code, "error")
        self.details = details
        self.headers = headers


def not_found(what: str) -> AppError:
    return AppError(status.HTTP_404_NOT_FOUND, f"{what} not found")


def error_body(status_code: int, message: str, code: str | None = None, details: Any = None) -> dict:
    return {
        "error": {
            "code": code or _STATUS_CODES.get(status_code, "error"),
            "message": message,
            "details": details,
            "request_id": request_id_var.get(),
        },
        "detail": message,
    }


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            error_body(exc.status_code, exc.message, exc.code, exc.details),
            status_code=exc.status_code,
            headers=exc.headers,
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        message = exc.detail if isinstance(exc.detail, str) else "Request failed"
        return JSONResponse(
            error_body(exc.status_code, message),
            status_code=exc.status_code,
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        details = [
            {"loc": list(e.get("loc", [])), "msg": e.get("msg"), "type": e.get("type")} for e in exc.errors()
        ]
        return JSONResponse(
            error_body(422, "Request validation failed", "validation_error", details), status_code=422
        )

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        logger.exception("unhandled_error", extra={"error_type": type(exc).__name__})
        return JSONResponse(error_body(500, "Internal server error", "internal_error"), status_code=500)
