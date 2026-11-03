"""Pre-download fastembed ONNX models into a directory (used at Docker build time).

Usage: python scripts/download_models.py <cache_dir> <embedding_model> <reranker_model|none>
"""

from __future__ import annotations

import sys

from fastembed import TextEmbedding
from fastembed.rerank.cross_encoder import TextCrossEncoder


def main() -> int:
    cache_dir, embedding_model, reranker_model = sys.argv[1:4]
    TextEmbedding(embedding_model, cache_dir=cache_dir)
    if reranker_model.lower() != "none":
        TextCrossEncoder(reranker_model, cache_dir=cache_dir)
    print(f"models cached in {cache_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
