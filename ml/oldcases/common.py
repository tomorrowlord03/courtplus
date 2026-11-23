"""Shared inputs and local ONNX artifact format for the old-cases pipeline."""

import csv
import hashlib
import json
import os
from pathlib import Path
import re
import unicodedata

import pyarrow.parquet as pq


os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
DATA = Path("E:/AI-cache/datasets/il-tur")
GOV = DATA.parent / "gov"
OUTPUT = DATA.parents[1] / "courtplus-ml" / "oldcases"
BASE = Path(__file__).resolve().parents[1] / "ner/data/base-model"
CROSSWALK = Path(__file__).resolve().parents[2] / "data/crosswalk/offences.csv"
IPC_SOURCE = "https://www.indiacode.nic.in/repealedfileopen?rfilename=A1860-45.pdf"
ROLES = [
    "Fact", "Issue", "ArgumentPetitioner", "ArgumentRespondent", "Statute", "Dissent",
    "PrecedentReliedUpon", "PrecedentNotReliedUpon", "PrecedentOverruled",
    "RulingByLowerCourt", "RatioOfTheDecision", "RulingByPresentCourt", "None",
]
WINDOW = 512
STRIDE = 128


def split(data, task, name):
    paths = sorted((data / task).glob(f"{name}-*.parquet"))
    if not paths:
        raise FileNotFoundError(f"Missing {task}/{name} parquet")
    return pq.read_table(paths).to_pylist()


def digest(parts):
    text = " ".join(parts) if not isinstance(parts, str) else parts
    text = " ".join(unicodedata.normalize("NFKC", text).casefold().split())
    return hashlib.sha256(text.encode()).digest()


def overlap(first, second, field):
    return {
        "shared_ids": len({r["id"] for r in first} & {r["id"] for r in second}),
        "shared_normalized_documents": len(
            {digest(r[field]) for r in first} & {digest(r[field]) for r in second}
        ),
    }


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    temporary.replace(path)


def tokenizer(base):
    from transformers import AutoTokenizer

    return AutoTokenizer.from_pretrained(base, local_files_only=True, trust_remote_code=False)


def chunks(tokenizer, texts, length=WINDOW, stride=STRIDE):
    """Window less than the model's limit by the two BERT framing tokens."""
    if stride == 0:
        return [[ids] for ids in truncate(tokenizer, texts, length)]
    body = length - 2
    windows = []
    for ids in tokenizer(texts, add_special_tokens=False, verbose=False)["input_ids"]:
        count = max(0, len(ids) - body)
        starts = range(0, count + body - stride, body - stride)
        windows.append([
            [tokenizer.cls_token_id, *ids[start:start + body], tokenizer.sep_token_id]
            for start in starts
        ])
    return windows


def truncate(tokenizer, texts, length):
    return tokenizer(texts, truncation=True, max_length=length)["input_ids"]


def export_onnx(model, tok, path, output):
    import torch

    tok.save_pretrained(path)
    model = model.cpu().float().eval()
    ids = torch.tensor([[tok.cls_token_id, tok.sep_token_id]])
    torch.onnx.export(
        model, (ids, torch.ones_like(ids)), str(path / "model.onnx"), dynamo=False,
        input_names=["input_ids", "attention_mask"], output_names=[output],
        dynamic_axes={
            "input_ids": {0: "batch", 1: "tokens"},
            "attention_mask": {0: "batch", 1: "tokens"},
            output: {0: "batch"},
        },
        opset_version=17,
    )


def statutes(data):
    mappings = {}
    with CROSSWALK.open(encoding="utf-8-sig", newline="") as stream:
        for row in csv.DictReader(stream):
            if row["act"] == "IPC" and row["bns_equivalent"].strip():
                key = (row["section"] + (f"({row['subsection']})" if row["subsection"] else "")).upper()
                value = {
                    "section": row["bns_equivalent"], "source": row["source_url"],
                    "page": row["source_page"], "note": row["notes"],
                }
                mappings.setdefault(key, []).append(value)
    labels = []
    for row in split(data, "lsi", "statutes"):
        section = re.sub(r"^Section\s+", "", row["id"], flags=re.I).strip().upper()
        labels.append({
            "label": row["id"], "section": section, "title": row["text"][0],
            "source": IPC_SOURCE, "bns": mappings.get(section, []),
        })
    return labels
