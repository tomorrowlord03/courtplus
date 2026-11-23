"""Audit normalized overlaps and freeze a local IBJ train/test manifest."""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import random
import re
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

import pyarrow.parquet as parquet
from pypdf import PdfReader
from pypdf.errors import PyPdfError

from data_utils import OFFICIAL_FILES

ANCHOR = 8
SHINGLE = 12


def words(text: str) -> tuple[str, ...]:
    text = unicodedata.normalize("NFKC", text).casefold()
    text = re.sub(r"(?<=\w)-[ \t]*\r?\n[ \t]*(?=\w)", "", text)
    return tuple(re.findall(r"[^\W_]+", text))


def phrases(tokens, length):
    return zip(*(tokens[offset:] for offset in range(length)))


class Passages:
    """Match a whole audited passage within a document, with exact short-row matching."""

    def __init__(self, rows):
        self.exact = set(rows) - {()}
        self.anchors = defaultdict(list)
        for row in self.exact:
            if len(row) >= ANCHOR:
                self.anchors[row[:ANCHOR]].append(row)
        self.contained = set()

    def matches(self, tokens):
        if tokens in self.exact:
            return True
        if len(tokens) < ANCHOR:
            return False
        return any(
            tokens[i:i + len(row)] == row
            for i, anchor in enumerate(phrases(tokens, ANCHOR))
            for row in self.anchors.get(anchor, ())
        ) or tokens in self.contained

    def index_containment(self, candidates):
        """Catch candidate excerpts occurring inside longer official passages."""
        candidates = {row for row in candidates if len(row) >= ANCHOR}
        by_anchor = defaultdict(list)
        for row in candidates:
            by_anchor[row[:ANCHOR]].append(row)
        for row in self.exact:
            for i, anchor in enumerate(phrases(row, ANCHOR)):
                for candidate in by_anchor.get(anchor, ()):
                    if row[i:i + len(candidate)] == candidate:
                        self.contained.add(candidate)


class Documents:
    """Flag matching documents even when their extracted text has local edits."""

    def __init__(self):
        self.postings = defaultdict(list)
        self.sizes = []

    @staticmethod
    def fingerprints(tokens):
        return set(phrases(tokens, SHINGLE))

    def add(self, tokens):
        shingles = self.fingerprints(tokens)
        index = len(self.sizes)
        self.sizes.append(len(shingles))
        for shingle in shingles:
            self.postings[shingle].append(index)

    def matches(self, tokens):
        shingles = self.fingerprints(tokens)
        common = Counter(index for shingle in shingles for index in self.postings.get(shingle, ()))
        return any(count >= 30 and 5 * count >= 3 * min(len(shingles), self.sizes[index])
                   for index, count in common.items())


def official_rows(root: Path):
    return {split: [words(row["data"]["text"]) for row in
                    parquet.read_table(root / "data" / name, columns=["data"]).to_pylist()]
            for split, name in OFFICIAL_FILES.items()}


def load_figshare(path: Path):
    ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    labels = Counter()
    docs, current = [], []
    with zipfile.ZipFile(path) as book:
        strings = ["".join(item.itertext()) for item in ET.fromstring(book.read("xl/sharedStrings.xml"))]
        with book.open("xl/worksheets/sheet1.xml") as sheet:
            for _, row in ET.iterparse(sheet, events=("end",)):
                if row.tag != ns + "row":
                    continue
                values = {}
                for cell in row:
                    value = cell.findtext(ns + "v")
                    if value is not None:
                        values[cell.attrib["r"][0]] = strings[int(value)] if cell.get("t") == "s" else value
                token, label = values.get("A"), values.get("C")
                if token in {"<sof>", "<eof>"}:
                    if current:
                        docs.append(words(" ".join(current)))
                        current = []
                elif token and token != "Token":
                    current.append(re.sub(r"^(\d+)\.0$", r"\1", token))
                    if label and label.strip():
                        labels[re.sub(r"^[BILU]-\s*", "", label.strip())] += 1
                row.clear()
    if current:
        docs.append(words(" ".join(current)))
    return docs, dict(sorted(labels.items()))


def extract_ibj(pdf_root: Path, text_root: Path):
    text_root.mkdir(parents=True, exist_ok=True)
    logging.getLogger("pypdf").setLevel(logging.CRITICAL)
    paths = {}
    for source in sorted(pdf_root.rglob("*")):
        if source.suffix.lower() != ".pdf":
            continue
        key = source.name.casefold()
        if key in paths:
            raise ValueError("Duplicate IBJ PDF filename")
        output = text_root / (source.stem.lower() + ".txt")
        if not output.exists():
            try:
                text = "\f".join(page.extract_text() or "" for page in PdfReader(source).pages)
            except (PyPdfError, RecursionError, ValueError, KeyError):
                text = ""
            output.write_text(text, encoding="utf-8")
        paths[key] = output
    return paths


def get_ibj(root: Path, text_root: Path, pdf_root: Path):
    paths = extract_ibj(pdf_root, text_root)
    raw = json.loads((root / "indian_bail_judgments.json").read_text(encoding="utf-8-sig"))
    rows = [{key: row[key] for key in ("case_id", "source_filename", "ipc_sections", "court")}
            for row in raw]
    if len(rows) != 1200 or len(paths) != 1200 or len({row["case_id"] for row in rows}) != len(rows):
        raise ValueError("Expected 1,200 unique IBJ orders and PDFs")
    for row in rows:
        row["text_path"] = str(paths[row.pop("source_filename").casefold()].resolve())
    return sorted(rows, key=lambda row: row["case_id"])


def audited_split(rows, token_rows, references, cg, near_cg):
    counts = Counter({key: 0 for key in ("official_test", "official_dev", "cg_gold", "excluded_overlap")})
    retained = []
    for row, tokens in zip(rows, token_rows, strict=True):
        overlaps = {
            "official_test": references["test"].matches(tokens),
            "official_dev": references["dev"].matches(tokens),
            "cg_gold": cg.matches(tokens) or near_cg.matches(tokens),
        }
        counts.update(key for key, match in overlaps.items() if match)
        if any(overlaps.values()):
            counts["excluded_overlap"] += 1
        else:
            retained.append((row, tokens))
    return retained, dict(counts)


def audit(dataset_root: Path, official: Path, cg_gold: Path, cg_text: Path, output: Path,
          pdf_root: Path, text_cache: Path):
    references = official_rows(official)
    indexes = {key: Passages(rows) for key, rows in references.items()}
    gold = json.loads(cg_gold.read_text(encoding="utf-8"))
    cg_tokens = [words((cg_text / (Path(row["file"]).stem + ".txt")).read_text(encoding="utf-8-sig"))
                 for row in gold]
    cg = Passages(cg_tokens)
    near_cg = Documents()
    for tokens in cg_tokens:
        near_cg.add(tokens)

    tuner = {}
    for file in sorted((dataset_root / "hf-tuner-ner" / "data").glob("*.parquet")):
        tuner[file.name.split("-")[0]] = [words(row["text"]) for row in
                                         parquet.read_table(file, columns=["text"]).to_pylist()]
    if set(tuner) != {"train", "validation"}:
        raise ValueError("Missing hf-tuner train or validation file")
    fig_docs, fig_labels = load_figshare(dataset_root / "figshare-icdac" / "corpus.xlsx")
    ibj_root = dataset_root / "ibj1200"
    ibj = get_ibj(ibj_root, text_cache, pdf_root)
    ibj_docs = [words(Path(row["text_path"]).read_text(encoding="utf-8")) for row in ibj]

    candidates = [*fig_docs, *ibj_docs, *(row for rows in tuner.values() for row in rows)]
    for index in (*indexes.values(), cg):
        index.index_containment(candidates)
    exact_official = set.union(*(index.exact for index in indexes.values()))
    result = {"protocol": {
        "normalization": "Unicode NFKC, casefold, dehyphenate line breaks, compare word sequences",
        "passages": "exact normalized rows plus bidirectional whole-passage containment (minimum eight words)",
        "near_documents": "at least 30 shared distinct 12-word shingles and at least 60% coverage of shorter document",
        "ibj_holdout": "200 orders, sorted source IDs shuffled with seed 42 after deduplication and official train/dev/test and CG exclusion",
    }}
    result["hf_tuner"] = {}
    for split, rows in tuner.items():
        remaining, counts = audited_split(rows, rows, indexes, cg, near_cg)
        result["hf_tuner"][split] = {
            "rows": len(rows), **counts,
            "matches_any_official_exact_row": sum(row in exact_official for row in rows),
            **{f"official_{name}_exact": sum(row in index.exact for row in rows)
               for name, index in indexes.items()},
            "remaining_after_overlap": len(remaining),
        }
    result["hf_tuner"]["used"] = False
    result["hf_tuner"]["reason"] = "No licence stated and substantial reuse of official texts"

    remaining, counts = audited_split(fig_docs, fig_docs, indexes, cg, near_cg)
    result["figshare"] = {
        "documents": len(fig_docs), "token_label_counts": fig_labels, **counts,
        "remaining_after_overlap": len(remaining), "used": False,
        "reason": "Partial and incompatible entity scope, including judgment dates and jurisdiction; outside tags are unsafe negatives",
    }

    remaining, counts = audited_split(ibj, ibj_docs, indexes, cg, near_cg)
    seen, near_seen = set(), Documents()
    usable = []
    skipped = Counter({"too_little_text": 0, "duplicate_text": 0})
    for row, tokens in remaining:
        if len(tokens) < 32:
            skipped["too_little_text"] += 1
        elif tokens in seen or near_seen.matches(tokens):
            skipped["duplicate_text"] += 1
        else:
            seen.add(tokens)
            near_seen.add(tokens)
            usable.append((row, tokens))
    external = [row for row, tokens in usable if not indexes["train"].matches(tokens) and row["court"]]
    if len(external) < 200:
        raise RuntimeError(f"Only {len(external)} eligible external IBJ orders")
    sample = random.Random(42).sample(external, 200)
    held_ids = {row["case_id"] for row in sample}
    # Remove any duplicate of a held order even if similarity is not transitive.
    held = Documents()
    for row in sample:
        held.add(words(Path(row["text_path"]).read_text(encoding="utf-8")))
    training = [row["text_path"] for row, tokens in usable
                if row["case_id"] not in held_ids and not held.matches(tokens)]
    result["ibj1200"] = {
        "orders": len(ibj), **counts, **skipped, "external_pool": len(external),
        "external_official_train_overlap": sum(indexes["train"].matches(tokens) for _, tokens in usable),
        "held_out": len(sample), "dapt_orders": len(training),
        "held_out_ids_sha256": hashlib.sha256("\n".join(sorted(held_ids)).encode()).hexdigest(),
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({
        "audit": result, "dapt_text_paths": training, "ibj_test": sample,
    }, indent=2) + "\n", encoding="utf-8")
    print(f"Audit complete: {len(ibj)} IBJ orders, {len(training)} DAPT, {len(sample)} held out; "
          f"{counts['excluded_overlap']} overlap exclusions", flush=True)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("datasets", "official", "cg-gold", "cg-text", "pdfs", "text-cache", "output"):
        parser.add_argument(f"--{name}", required=True, type=Path)
    args = parser.parse_args()
    audit(args.datasets, args.official, args.cg_gold, args.cg_text, args.output, args.pdfs, args.text_cache)


if __name__ == "__main__":
    main()
