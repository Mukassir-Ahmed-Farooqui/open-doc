from src.retrieval.fusion import rrf_fusion

dense = [
    "A",
    "B",
    "C",
]

sparse = [
    "C",
    "A",
    "D",
]

print(
    rrf_fusion(
        dense,
        sparse,
    )
)