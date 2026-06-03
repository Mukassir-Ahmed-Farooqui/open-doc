from pathlib import Path
from collections import Counter

from src.ingestion.parser import parse_pdf

pdf = next(Path("data/cuad").rglob("*.pdf"))

parsed = parse_pdf(pdf)

print(f"\nElements: {len(parsed.elements)}\n")

labels = Counter(e.element_type for e in parsed.elements)

print("=== LABEL COUNTS ===")
for label, count in labels.most_common():
    print(f"{label}: {count}")

print("\n=== FIRST 30 ELEMENTS ===")
for e in parsed.elements[:30]:
    print(
        f"type={e.element_type:<20} "
        f"page={e.page_num:<3} "
        f"text={e.text[:80]}"
    )

print("\n=== LIST ITEMS ===")
for e in parsed.elements:
    if e.element_type == "list_item":
        print(e.text[:200])
        print("-" * 50)