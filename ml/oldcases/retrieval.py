"""Benchmark hybrid retrieval and build the offline government precedent index."""

import argparse
from collections import Counter, defaultdict
import gzip
import json
from pathlib import Path
import re
import sys
import unicodedata

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np
from scipy.sparse import csr_matrix
import torch
from torch import nn
from transformers import AutoModel

from common import BASE, DATA, OUTPUT, export_onnx, overlap, split, tokenizer, write_json
from government import PORTAL, SCR, extracted

LENGTH = 128
DIMENSIONS = 384
TERM_LIMIT = 512
SIZE_LIMIT = 300_000_000


def words(text):
    return re.findall(r"[^\W_]+", unicodedata.normalize("NFKC", text).lower())[:TERM_LIMIT]


class Encoder(nn.Module):
    def __init__(self, base):
        super().__init__()
        self.backbone = AutoModel.from_pretrained(
            base, local_files_only=True, trust_remote_code=False, attn_implementation="sdpa",
        )

    def forward(self, input_ids, attention_mask):
        hidden = self.backbone(input_ids=input_ids, attention_mask=attention_mask).last_hidden_state
        mask = attention_mask.unsqueeze(-1)
        pooled = (hidden[:, :, :DIMENSIONS].float() * mask).sum(dim=1) / mask.sum(dim=1)
        return nn.functional.normalize(pooled, dim=1)


def encode(model, tok, documents, batch_size):
    device = next(model.parameters()).device
    with torch.inference_mode():
        for start in range(0, len(documents), batch_size):
            batch = tok(documents[start:start + batch_size], padding=True, truncation=True,
                        max_length=LENGTH, return_tensors="pt")
            ids, mask = batch["input_ids"].to(device), batch["attention_mask"].to(device)
            with torch.autocast("cuda", dtype=torch.float16, enabled=device.type == "cuda"):
                yield model(ids, mask).cpu().numpy()


def lexical(documents):
    lists = defaultdict(list)
    lengths = []
    for doc, text in enumerate(documents):
        tokens = words(text)
        lengths.append(len(tokens))
        for term, tf in Counter(tokens).items():
            lists[term].append((doc, tf))
    return lengths, lists


def bm25(queries, lengths, lists):
    count = len(lengths)
    lengths = np.asarray(lengths)
    norm = 1.2 * (0.25 + 0.75 * lengths / max(float(lengths.mean()), 1))
    query_lists = [frozenset(words(query)) for query in queries]
    terms = sorted(set().union(*query_lists).intersection(lists))
    columns = {term: i for i, term in enumerate(terms)}
    docs, cols, scores = [], [], []
    for term in terms:
        post = lists[term]
        d, tf = map(np.asarray, zip(*post))
        idf = np.log1p((count - len(post) + 0.5) / (len(post) + 0.5))
        docs.extend(d)
        cols.extend([columns[term]] * len(post))
        scores.extend(idf * tf * 2.2 / (tf + norm[d]))
    index = csr_matrix((scores, (cols, docs)), shape=(len(terms), count), dtype=np.float32)
    qi, qc = [], []
    for i, terms in enumerate(query_lists):
        for word in terms.intersection(columns):
            qi.append(i)
            qc.append(columns[word])
    matrix = csr_matrix((np.ones(len(qi), dtype=np.float32), (qi, qc)), shape=(len(queries), len(columns)))
    return (matrix @ index).toarray()


def rank(scores):
    return np.argsort(-scores, axis=-1, kind="stable")


def reciprocal(scores, positive_only=False):
    order = rank(scores)
    values = np.broadcast_to(1 / (61 + np.arange(scores.shape[1])), scores.shape)
    result = np.empty_like(scores)
    np.put_along_axis(result, order, values, axis=1)
    if positive_only:
        result[scores <= 0] = 0
    return result


def retrieval_scores(queries, candidates, scores, cutoff=None):
    # The published protocol selects one global K on validation and keeps it for test.
    ids = [row["id"] for row in candidates]
    universe = set(ids)
    width = min(len(ids), cutoff or 50)
    hits = np.zeros(width, dtype=np.int64)
    total = missing = 0
    for row, order in zip(queries, rank(scores), strict=True):
        expected = set(row["relevant_candidates"])
        total += len(expected)
        missing += len(expected - universe)
        hits += [ids[i] in expected for i in order[:width]]
    predictions = np.arange(1, width + 1) * len(queries)
    cumulative = hits.cumsum()
    f1 = 2 * cumulative / (total + predictions)
    index = width - 1 if cutoff else int(f1.argmax())
    return {"micro_f1_at_k": float(f1[index]), "k": index + 1,
            "hits": int(cumulative[index]), "gold": total, "gold_missing_from_candidates": missing}


def benchmark(args, model, tok):
    data = {}
    for name in ("train", "dev", "test"):
        data[name] = [split(args.data, "pcr", f"{name}_{kind}") for kind in ("queries", "candidates")]
    results = {}
    for name in ("dev", "test"):
        queries, candidates = data[name]
        q_text = [" ".join(row["text"]) for row in queries]
        c_text = [" ".join(row["text"]) for row in candidates]
        lexical_scores = bm25(q_text, *lexical(c_text))
        q_vector = np.concatenate(list(encode(model, tok, q_text, args.batch)))
        c_vector = np.concatenate(list(encode(model, tok, c_text, args.batch))).astype("<f2").astype(np.float32)
        dense_scores = q_vector @ c_vector.T
        rank_bm25, rank_dense = reciprocal(lexical_scores, True), reciprocal(dense_scores)
        if name == "dev":
            options = [(retrieval_scores(queries, candidates, w * rank_bm25 + (1 - w) * rank_dense), w)
                       for w in (0.5, 0.65, 0.8, 0.9, 0.95)]
            hybrid, weight = max(options, key=lambda pair: pair[0]["micro_f1_at_k"])
        else:
            hybrid = retrieval_scores(queries, candidates, weight * rank_bm25 + (1 - weight) * rank_dense,
                                      results["dev"]["hybrid"]["k"])
        results[name] = {
            "query_count": len(queries), "candidate_count": len(candidates),
            "bm25": retrieval_scores(queries, candidates, lexical_scores,
                                     results["dev"]["bm25"]["k"] if name == "test" else None),
            "dense": retrieval_scores(queries, candidates, dense_scores,
                                      results["dev"]["dense"]["k"] if name == "test" else None),
            "hybrid": hybrid,
        }
        print(name, results[name], flush=True)
    results["lexical_weight"] = weight
    results["leakage"] = {
        f"train_{name}_{kind}": overlap(data["train"][i], data[name][i], "text")
        for name in ("dev", "test") for i, kind in enumerate(("queries", "candidates"))
    }
    write_json(args.output / "pcr-metrics.json", results)
    return weight


def build(args, model, tok, weight):
    cases = list(extracted(args.output))
    if not cases:
        raise ValueError("No text-layer government judgments to index. Run government.py first.")
    docs, texts, keys = [], [], set()
    for row in sorted(cases, key=lambda row: row["id"]):
        if row["id"] in keys:
            continue
        keys.add(row["id"])
        text = row.pop("text")
        docs.append({**row, "excerpt": text[:300]})
        texts.append(" ".join([row["title"], row["citation"], row["caseNumber"], text]))
    counts = Counter(f"{doc['court']} {doc['year']}" for doc in docs)
    print(f"Embedding {len(docs)} judgments from {len(counts)} court/year groups", flush=True)
    directory = args.output / "pcr-index"
    stage = args.output / "pcr-index-building"
    stage.mkdir(parents=True, exist_ok=True)
    with (stage / "embeddings.f16").open("wb") as output:
        for i, matrix in enumerate(encode(model, tok, texts, args.batch), 1):
            matrix.astype("<f2").tofile(output)
            if i % 50 == 0:
                print(f"Embedded {min(i * args.batch, len(docs))}/{len(docs)} judgments", flush=True)
    lengths, lists = lexical(texts)
    terms, offset = {}, 0
    dtype = np.dtype([("id", "<u4"), ("tf", "<u2")])
    with (stage / "postings.bin").open("wb") as output:
        for term, postings in sorted(lists.items()):
            terms[term] = [offset, len(postings)]
            np.asarray(postings, dtype=dtype).tofile(output)
            offset += len(postings)
    with gzip.open(stage / "documents.json.gz", "wt", encoding="utf-8", compresslevel=4) as output:
        json.dump(docs, output, ensure_ascii=False, separators=(",", ":"))
    write_json(stage / "lexical.json", {"lengths": lengths, "terms": terms})
    write_json(stage / "manifest.json", {
        "version": 1, "count": len(docs), "dimensions": DIMENSIONS, "lexicalWeight": weight,
        "termLimit": TERM_LIMIT, "coverage": dict(sorted(counts.items())),
        "license": "CC BY 4.0", "courtSources": [PORTAL, SCR],
        "mirrors": [
            "https://registry.opendata.aws/indian-high-court-judgments/",
            "https://registry.opendata.aws/indian-supreme-court-judgments/",
        ],
    })
    size = sum(path.stat().st_size for path in stage.iterdir() if path.is_file())
    if size >= SIZE_LIMIT:
        raise ValueError(f"Index is {size:,} bytes, above its 300 MB limit.")
    # Keep completed files together until size and serialization checks pass.
    directory.mkdir(exist_ok=True)
    for file in ("documents.json.gz", "lexical.json", "postings.bin", "embeddings.f16", "manifest.json"):
        (stage / file).replace(directory / file)
    stage.rmdir()
    print(f"Index: {len(docs)} judgments, {size:,} bytes, {dict(sorted(counts.items()))}", flush=True)


def main(args):
    model = Encoder(args.base).eval()
    device = "cuda" if torch.cuda.is_available() and not args.cpu else "cpu"
    if device == "cpu":
        torch.set_num_threads(min(6, torch.get_num_threads()))
    model.to(device)
    tok = tokenizer(args.base)
    if args.action == "benchmark":
        benchmark(args, model, tok)
    elif args.action == "build":
        metrics = args.output / "pcr-metrics.json"
        weight = json.loads(metrics.read_text(encoding="utf-8"))["lexical_weight"] if metrics.exists() else 0.9
        build(args, model, tok, weight)
    else:
        from onnxruntime.quantization import QuantType, quantize_dynamic

        directory = args.output / "pcr-encoder"
        export_onnx(model, tok, directory, "embedding")
        quantize_dynamic(
            str(directory / "model.onnx"), str(directory / "model_quantized.onnx"),
            weight_type=QuantType.QInt8, op_types_to_quantize=["MatMul", "Gemm"],
        )
        # Keep encoder weights outside the precedent index size budget.
        write_json(directory / "manifest.json", {
            "length": LENGTH, "stride": 0, "threshold": None, "labels": [],
            "source": "InLegalBERT (MIT), mean pooled", "dimensions": DIMENSIONS,
        })


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("benchmark", "build", "export"))
    parser.add_argument("--data", type=Path, default=DATA)
    parser.add_argument("--base", type=Path, default=BASE)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--batch", type=int, default=32)
    parser.add_argument("--cpu", action="store_true")
    main(parser.parse_args())
