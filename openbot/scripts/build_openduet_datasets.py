#!/usr/bin/env python3
"""
ETL & Distillation Pipeline for OpenDecider (SFT Spec B) and Laya (System-One Spec A).
Pulls from open-source corpora (Enron, SWE-bench, ToolBench) and formats deterministically.
"""

import json
import re
from pathlib import Path
from typing import Dict, Any, List

SYSTEM_PROMPT = (
    "You are OpenDecider, a precise System-1 classification model. "
    "Given a <state> and <questions>, respond strictly with valid JSON "
    "matching the requested answer types (`noul`, `choice`, or `score`)."
)

def spec_a_to_spec_b(record: Dict[str, Any]) -> Dict[str, Any]:
    """
    Deterministically compiles a Specification A (System-One) record
    into Specification B (OpenAI SFT messages format) so Laya and OpenDecider
    train on the exact same ground truth.
    """
    state_str = json.dumps(record["state"], indent=2, ensure_ascii=False)
    questions_str = json.dumps(record["questions"], indent=2, ensure_ascii=False)
    answers_str = json.dumps(record["answers"], indent=2, ensure_ascii=False)

    user_content = f"<state>\n{state_str}\n</state>\n\n<questions>\n{questions_str}\n</questions>"

    return {
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
            {"role": "assistant", "content": answers_str},
        ]
    }


def compile_jsonl_files(spec_a_records: List[Dict[str, Any]], out_dir: str = "./data"):
    out_path = Path(out_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    spec_a_file = out_path / "laya_system_one_golden.jsonl"
    spec_b_file = out_path / "opendecider_sft_golden.jsonl"

    with spec_a_file.open("w", encoding="utf-8") as fa, spec_b_file.open("w", encoding="utf-8") as fb:
        for rec in spec_a_records:
            fa.write(json.dumps(rec, ensure_ascii=False) + "\n")
            fb.write(json.dumps(spec_a_to_spec_b(rec), ensure_ascii=False) + "\n")

    print(f"Wrote {len(spec_a_records)} records to {spec_a_file} and {spec_b_file}")


if __name__ == "__main__":
    golden_path = Path(__file__).parent.parent / "data" / "golden-seeds.jsonl"
    if golden_path.exists():
        with golden_path.open("r", encoding="utf-8") as f:
            records = [json.loads(line) for line in f if line.strip()]
        out_dir = str(golden_path.parent)
        compile_jsonl_files(records, out_dir=out_dir)
    else:
        print(f"File not found: {golden_path}")
