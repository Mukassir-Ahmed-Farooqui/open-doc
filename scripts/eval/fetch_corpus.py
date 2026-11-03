"""Download the CUAD contracts the eval set refers to (CC BY 4.0, The Atticus Project).

Files are pinned to a dataset revision and land in tests/fixtures/cuad/ (git-ignored).
Two of them (Arca, Pelican) are the documents the existing golden/fact questions were written
against; the other five are same-genre distractors that make corpus-wide retrieval realistic.

Usage: python scripts/eval/fetch_corpus.py
"""

from __future__ import annotations

import sys
import urllib.parse
from pathlib import Path

import httpx

REVISION = "a3c393f5d103fd0c516374e4fdff676c8176dcb1"
BASE = f"https://huggingface.co/datasets/theatticusproject/cuad/resolve/{REVISION}/CUAD_v1/full_contract_pdf/Part_I/Development/"
FILES = [
    "ArcaUsTreasuryFund_20200207_N-2_EX-99.K5_11971930_EX-99.K5_Development Agreement.pdf",
    "PelicanDeliversInc_20200211_S-1_EX-10.3_11975895_EX-10.3_Development Agreement2.pdf",
    "AimmuneTherapeuticsInc_20200205_8-K_EX-10.3_11967170_EX-10.3_Development Agreement.pdf",
    "LiquidmetalTechnologiesInc_20200205_8-K_EX-10.1_11968198_EX-10.1_Development Agreement.pdf",
    "ReedsInc_20191113_10-Q_EX-10.4_11888303_EX-10.4_Development Agreement.pdf",
    "ConformisInc_20191101_10-Q_EX-10.6_11861402_EX-10.6_Development Agreement.pdf",
    "EtonPharmaceuticalsInc_20191114_10-Q_EX-10.1_11893941_EX-10.1_Development Agreement.pdf",
]
DEST = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "cuad"


def main() -> int:
    DEST.mkdir(parents=True, exist_ok=True)
    with httpx.Client(follow_redirects=True, timeout=60) as client:
        for name in FILES:
            target = DEST / name
            if target.exists() and target.stat().st_size > 0:
                continue
            resp = client.get(BASE + urllib.parse.quote(name))
            resp.raise_for_status()
            if not resp.content.startswith(b"%PDF"):
                print(f"not a PDF: {name}", file=sys.stderr)
                return 1
            target.write_bytes(resp.content)
            print(f"downloaded {name} ({len(resp.content) // 1024} KB)")
    print(f"corpus ready in {DEST}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
