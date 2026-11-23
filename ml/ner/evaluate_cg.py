"""Field-level evaluation on locally held, hand-annotated Chhattisgarh orders."""

from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

from pypdf import PdfReader

from data_utils import DATA, ROOT
from predict import predict


PERSON_LABELS = {"PETITIONER", "RESPONDENT", "JUDGE", "LAWYER", "WITNESS", "OTHER_PERSON"}
DATE_RE = re.compile(r"(?<!\d)(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?!\d)")
PROVISION_RE = re.compile(r"(?<!\d)\d+(?:\s*\([a-zA-Z0-9]+\))*(?!\d)")
CASE_RE = re.compile(r"(?<!\d)(\d{1,5})\s*(?:of|/)\s*(\d{4})(?!\d)", re.I)


def words(value: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", value.lower()))


def statute(value: str) -> str:
    plain = words(value)
    if "nagarik suraksha" in plain or re.search(r"\bbnss\b", plain):
        return "bnss"
    if "nyaya sanhita" in plain or re.search(r"\bbns\b", plain):
        return "bns"
    if "narcotic drugs" in plain or re.search(r"\bndps\b", plain):
        return "ndps"
    if "chhattisgarh" in plain and "excise" in plain:
        return "cg_excise"
    if "chhattisgarh" in plain and "freedom" in plain:
        return "cg_freedom"
    if "arms act" in plain:
        return "arms"
    return plain


def values(field: str, texts: list[str]) -> set[str]:
    result = set()
    for text in texts:
        if field == "PROVISION":
            result.update(re.sub(r"\s+", "", match.group()).lower()
                          for match in PROVISION_RE.finditer(text)
                          if not (len(match.group()) == 4 and match.group().startswith(("19", "20"))))
        elif field == "STATUTE":
            result.add(statute(text))
        elif field == "DATE":
            result.update(f"{year}-{int(month):02d}-{int(day):02d}"
                          for day, month, year in DATE_RE.findall(text))
        elif field == "CASE_NUMBER":
            result.update(f"{int(number)}/{year}" for number, year in CASE_RE.findall(text))
        elif field == "COURT":
            plain = words(text)
            result.add("cg_high_court" if "high court of chhattisgarh" in plain else plain)
    return {item for item in result if item}


def person(value: str) -> str:
    plain = words(value)
    return re.sub(r"^(?:hon ble |shri |smt |mr |mrs |ms |justice )+", "", plain).strip()


def main():
    gold = json.loads((DATA / "cg_gold.json").read_text(encoding="utf-8"))
    if len(gold) != 10:
        raise RuntimeError("Expected ten hand-annotated orders")
    source_dir = Path("D:/Projects/Court plus/repo/orders")
    artifact = ROOT / "artifacts" / "courtplus-legalner"
    totals = defaultdict(lambda: {"tp": 0, "predicted": 0, "gold": 0})
    for row in gold:
        path = source_dir / row["file"]
        text = "\n".join(page.extract_text() or "" for page in PdfReader(str(path)).pages)
        entities = predict(text, artifact)
        for label, key in (("PROVISION", "provisions"), ("STATUTE", "statutes"),
                           ("DATE", "dates"), ("CASE_NUMBER", "case_numbers"),
                           ("COURT", "court")):
            expected = values(label, [row[key]] if key == "court" else row[key])
            predicted = values(label, [item["text"] for item in entities if item["label"] == label])
            result = totals[label]
            result["tp"] += len(expected & predicted)
            result["gold"] += len(expected)
            result["predicted"] += len(predicted)
        predicted_names = [person(item["text"]) for item in entities if item["label"] in PERSON_LABELS]
        expected_names = {person(name) for name in row["persons"]}
        matched = sum(any(name == candidate or f" {name} " in f" {candidate} "
                          for candidate in predicted_names) for name in expected_names)
        totals["PERSON"]["tp"] += matched
        totals["PERSON"]["gold"] += len(expected_names)
        totals["PERSON"]["predicted"] += len(set(predicted_names))
        print(f"CG checked {path.name}: {len(entities)} predicted entities", flush=True)
    report = {label: {**counts,
                      "precision": (counts["tp"] / counts["predicted"] if counts["predicted"] else 0)
                      if label != "PERSON" else None,
                      "recall": counts["tp"] / counts["gold"] if counts["gold"] else 0}
              for label, counts in totals.items()}
    (DATA / "cg_field_results.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    metrics_path = ROOT / "metrics.json"
    metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
    metrics["cg_field_evaluation"] = {
        "orders": len(gold), "unit": "distinct normalized field value per order",
        "person_unit": "distinct written person name per order; full-name match for recall",
        "source": "local published Chhattisgarh High Court orders; never used for training",
        "scores": report,
    }
    metrics_path.write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
    lines = ["", "## Chhattisgarh order field check", "",
             "Ten locally held published High Court orders were hand annotated from pypdf text. Values are deduplicated within each order; dates are compared as day/month/year, provisions by section number, statutes by named act/abbreviation, and case numbers by number/year. Person recall requires the entire written name in a predicted person span. The gold file and orders are git ignored.", "",
             "| Field | Precision | Recall | TP | Predicted | Gold |", "|---|---:|---:|---:|---:|---:|"]
    for label, result in report.items():
        precision = "n/a" if result["precision"] is None else f"{result['precision']:.3f}"
        lines.append(f"| {label} | {precision} | {result['recall']:.3f} | {result['tp']} | {result['predicted']} | {result['gold']} |")
    lines += ["", "This convenience sample is small, English text layer only, and drawn from one court. Name recall does not establish safe anonymisation of addresses, relatives, or identifiers."]
    markdown = ROOT / "METRICS.md"
    previous = markdown.read_text(encoding="utf-8").split("\n## Chhattisgarh order field check\n")[0]
    markdown.write_text(previous.rstrip() + "\n" + "\n".join(lines) + "\n", encoding="utf-8")
    for label, result in report.items():
        precision = "n/a" if result["precision"] is None else f"{result['precision']:.3f}"
        print(f"CG {label}: P={precision} R={result['recall']:.3f} "
              f"TP={result['tp']} predicted={result['predicted']} gold={result['gold']}")


if __name__ == "__main__":
    main()
