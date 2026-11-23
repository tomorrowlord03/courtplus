"""Match government PDF archives to metadata and extract their text layers."""

import argparse
from collections import deque
from concurrent.futures import ProcessPoolExecutor
from functools import lru_cache
import gzip
import hashlib
from io import BytesIO
import json
import logging
from pathlib import Path, PurePosixPath
import re
import sys
import tarfile
from urllib.parse import quote
import warnings

sys.path.insert(0, str(Path(__file__).resolve().parent))

import pyarrow.parquet as pq
from pypdf import PdfReader
from pypdf.errors import PdfReadError

from common import GOV, OUTPUT, write_json

YEARS = {"hc-cg": range(2025, 2027), "sc": range(2020, 2027)}
PORTAL = "https://judgments.ecourts.gov.in/"
SCR = "https://scr.sci.gov.in/scrsearch/"
MAX_PDF_BYTES = 50_000_000
TEXT_CAP = 7000
HEADER_BUFFER = 2 * 1024 * 1024
BATCH_PDFS = 32
BATCH_BYTES = 4 * 1024 * 1024
PDF_ERRORS = (PdfReadError, ValueError, TypeError, KeyError, UnicodeError, OSError, IndexError, NotImplementedError)
INVALID_UNICODE = re.compile(r"[\ud800-\udfff]")


def key(name):
    stem = PurePosixPath(name).stem.casefold()
    return re.sub(r"[_-](?:en|eng|english)$", "", stem)


@lru_cache(maxsize=2)
def metadata(gov, court, year):
    directory = gov / court / "metadata" / f"year={year}"
    fields = ["title", "judge", "decision_date", "court"]
    fields += ["pdf_link", "cnr"] if court == "hc-cg" else ["path", "citation", "case_id", "cnr"]
    rows = {}
    for file in sorted(directory.rglob("*.parquet")):
        for batch in pq.ParquetFile(file).iter_batches(columns=fields):
            for row in batch.to_pylist():
                title = row["title"] or ""
                if court == "hc-cg":
                    pdf = row["pdf_link"] or ""
                    if not pdf.startswith("court/cnrorders/cghccisdb/orders/"):
                        continue
                    case_number = title.split(" of ", 1)[0] if " of " in title else row["cnr"]
                    citation = ""
                    source = PORTAL + quote(pdf, safe="/")
                else:
                    if not row["path"]:
                        continue
                    pdf = row["path"] + ".pdf"
                    case_number = row["case_id"]
                    citation = row["citation"]
                    source = SCR
                stem = key(pdf)
                rows[stem] = {
                    "id": f"{court}:{stem}", "title": title, "citation": citation or "",
                    "caseNumber": case_number or "", "year": year, "date": str(row["decision_date"] or ""),
                    "court": row["court"] or ("High Court of Chhattisgarh" if court == "hc-cg" else "Supreme Court of India"),
                    "judges": row["judge"] or "", "source": source,
                }
    return rows


def archives(gov, court, year):
    directory = gov / court / "tar" / f"year={year}"
    return sorted(path for path in directory.rglob("*") if path.is_file()
                  and path.name.endswith((".tar", ".tar.gz", ".tgz")))


def read_pdf(raw, cap=None):
    logging.getLogger("pypdf").setLevel(logging.ERROR)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        reader = PdfReader(BytesIO(raw), strict=False)
    pages, count = [], 0
    for page in reader.pages:
        try:
            text = " ".join((page.extract_text() or "").split())
        except (PdfReadError, ValueError, TypeError, KeyError, UnicodeError, OSError, IndexError):
            continue
        pages.append(text)
        count += len(text)
        if cap and count >= cap:
            break
    result = INVALID_UNICODE.sub("\ufffd", " ".join(part for part in pages if part))
    return result[:cap] if cap else result


def read_member(tar, member, cap=None):
    if not 0 < member.size <= MAX_PDF_BYTES:
        return ""
    try:
        with tar.extractfile(member) as stream:
            return read_pdf(stream.read(), cap)
    except PDF_ERRORS:
        return ""


def extract_batch(batch):
    rows = []
    for item, raw in batch:
        try:
            text = read_pdf(raw, TEXT_CAP)
        except PDF_ERRORS:
            continue
        if text:
            rows.append(json.dumps({**item, "text": text}, ensure_ascii=False) + "\n")
    return rows


def extract_archive(gov, court, year, archive, directory, pool, workers, mode="r|*"):
    identity = f"{archive.relative_to(gov)}:{archive.stat().st_size}:{archive.stat().st_mtime_ns}"
    if court == "sc":
        identity += ":sc-v2"
    cache_key = hashlib.sha256(identity.encode()).hexdigest()[:20]
    cache = directory / f"{court}-{year}-{cache_key}.jsonl.gz"
    status = cache.with_suffix(".json")
    if cache.exists() and status.exists():
        return cache, json.loads(status.read_text(encoding="utf-8"))
    records = metadata(gov, court, year)
    stats = {"court": court, "year": year, "archive": archive.name, "matched": 0, "unmatched": 0,
             "no_usable_text": 0, "indexed": 0, "archive_error": False}
    temporary = cache.with_suffix(".tmp")
    pending = deque()
    batch, byte_count, progress = [], 0, 5000
    with gzip.open(temporary, "wt", encoding="utf-8", compresslevel=3) as destination:
        def collect():
            nonlocal progress
            count, future = pending.popleft()
            rows = future.result()
            destination.writelines(rows)
            stats["indexed"] += len(rows)
            stats["no_usable_text"] += count - len(rows)
            if stats["indexed"] >= progress:
                print(f"{court} {year} {archive.name}: {stats['indexed']:,} text layers extracted", flush=True)
                progress += 5000

        try:
            # One sequential reader avoids issuing competing random reads on the corpus drive.
            with tarfile.open(archive, mode, bufsize=HEADER_BUFFER) as tar:
                for member in tar:
                    if not member.isfile() or not member.name.lower().endswith(".pdf"):
                        continue
                    item = records.get(key(member.name))
                    if item is None:
                        stats["unmatched"] += 1
                        continue
                    stats["matched"] += 1
                    if not 0 < member.size <= MAX_PDF_BYTES:
                        stats["no_usable_text"] += 1
                        continue
                    with tar.extractfile(member) as stream:
                        batch.append((item, stream.read()))
                    byte_count += member.size
                    if len(batch) >= BATCH_PDFS or byte_count >= BATCH_BYTES:
                        pending.append((len(batch), pool.submit(extract_batch, batch)))
                        batch, byte_count = [], 0
                    if len(pending) >= workers * 2:
                        collect()
        except (tarfile.TarError, OSError, EOFError) as error:
            stats["archive_error"] = True
            stats["archive_error_reason"] = f"{type(error).__name__}: {error}"
        if batch:
            pending.append((len(batch), pool.submit(extract_batch, batch)))
        while pending:
            collect()
    if not stats["archive_error"]:
        temporary.replace(cache)
        write_json(status, stats)
    else:
        # A bad or partial archive must be retried on the next run.
        temporary.unlink()
    return cache, stats


def prepare(gov, output, workers):
    directory = output / "government-extract"
    directory.mkdir(parents=True, exist_ok=True)
    jobs = [(court, year, archive)
            for court, years in YEARS.items() for year in years for archive in archives(gov, court, year)]
    if not jobs:
        raise FileNotFoundError(f"No official PDF archives in {gov}")
    cache_names, metrics = [], []
    with ProcessPoolExecutor(max_workers=workers) as pool:
        for court, year, archive in jobs:
            cache, status = extract_archive(gov, court, year, archive, directory, pool, workers)
            if status["archive_error"]:
                print(f"Retrying {court} {year} {archive.name}: {status['archive_error_reason']}", flush=True)
                cache, status = extract_archive(gov, court, year, archive, directory, pool, workers, mode="r:*")
            print(status, flush=True)
            metrics.append(status)
            if not status["archive_error"]:
                cache_names.append(cache.name)
    write_json(directory / "manifest.json", {"files": sorted(cache_names), "archives": metrics})


def extracted(output):
    directory = output / "government-extract"
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    failed = [record["archive"] for record in manifest["archives"] if record["archive_error"]]
    if failed:
        raise ValueError(f"Archive extraction failed for {', '.join(failed)}. Re-run government.py.")
    for name in manifest["files"]:
        with gzip.open(directory / name, "rt", encoding="utf-8") as stream:
            yield from map(json.loads, stream)


def sampled_orders(gov, count):
    """Sample readable orders from several parts of the 2026 archive sequence."""
    files = archives(gov, "hc-cg", 2026)
    records = metadata(gov, "hc-cg", 2026)
    candidates = {}
    group_count = min(4, len(files))
    primary = [
        min(files[i * len(files) // group_count:(i + 1) * len(files) // group_count],
            key=lambda path: (path.stat().st_size, path.name))
        for i in range(group_count)
    ]
    for index, archive in enumerate([*primary, *(path for path in files if path not in primary)], 1):
        with tarfile.open(archive, "r|*", bufsize=HEADER_BUFFER) as tar:
            for member in tar:
                stem = key(member.name)
                if member.isfile() and stem in records and member.name.lower().endswith(".pdf"):
                    candidates.setdefault(stem, (archive, member))
        if index >= len(primary) and len(candidates) >= count * 3:
            break
    ordered = sorted(candidates, key=lambda stem: hashlib.sha256(f"courtplus-w30:{stem}".encode()).digest())
    accepted = 0
    for stem in ordered:
        archive, member = candidates[stem]
        with tarfile.open(archive, "r:*") as tar:
            text = read_member(tar, member)
        if text:
            yield text, archive.name
            accepted += 1
            if accepted == count:
                break


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gov", type=Path, default=GOV)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--workers", type=int, default=6)
    args = parser.parse_args()
    prepare(args.gov, args.output, args.workers)
