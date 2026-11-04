# syntax=docker/dockerfile:1.7
# Multi-stage build: dependencies + ONNX models in a builder, slim non-root runtime.

FROM python:3.12-slim AS builder
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 \
    UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY --from=ghcr.io/astral-sh/uv:0.13.6 /uv /usr/local/bin/uv
RUN uv venv /opt/venv
ENV VIRTUAL_ENV=/opt/venv PATH=/opt/venv/bin:$PATH
COPY requirements.txt /tmp/requirements.txt
RUN uv pip install --no-cache -r /tmp/requirements.txt
# Bake the default ONNX models into the image so cold starts never hit the network.
ARG EMBEDDING_MODEL=BAAI/bge-small-en-v1.5
ARG RERANKER_MODEL=Xenova/ms-marco-MiniLM-L-6-v2
COPY scripts/download_models.py /tmp/download_models.py
RUN python /tmp/download_models.py /opt/models "$EMBEDDING_MODEL" "$RERANKER_MODEL"

FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    VIRTUAL_ENV=/opt/venv PATH=/opt/venv/bin:$PATH \
    FASTEMBED_CACHE_DIR=/opt/models HF_HUB_OFFLINE=1 \
    APP_ENV=production PORT=8000 MALLOC_ARENA_MAX=2
RUN useradd --create-home --uid 10001 app
COPY --from=builder /opt/venv /opt/venv
COPY --from=builder --chown=app:app /opt/models /opt/models
WORKDIR /app
COPY --chown=app:app alembic.ini start.sh ./
COPY --chown=app:app migrations ./migrations
COPY --chown=app:app app ./app
RUN chmod +x start.sh && mkdir -p /app/data && chown app:app /app/data
# Local-storage uploads live here; a volume keeps them when the container is recreated.
VOLUME ["/app/data"]
USER app
EXPOSE 8000
# Shell form so $PORT (set by Cloud Run / Railway) is expanded.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:${PORT}/health', timeout=4)" || exit 1
CMD ["./start.sh"]
