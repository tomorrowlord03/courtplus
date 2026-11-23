"""Measure extractive summaries and the 2026 CG High Court order spot check."""

import argparse
from collections import Counter
import json
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np
import onnxruntime as ort

from common import DATA, GOV, OUTPUT, chunks, overlap, split, tokenizer, truncate, write_json
from government import sampled_orders

SUMMARY_ROLES = ("Fact", "Issue", "RatioOfTheDecision", "RulingByPresentCourt")
PROVISION = r"\d{1,3}(?:-?[A-Z])?(?:\s*\(\s*[\da-z]+\s*\))*"
ACT = r"(?P<ipc>I\.?\s*P\.?\s*C\b\.?|Indian\s+Penal\s+Code)|B\.?\s*N\.?\s*S\b\.?|Bharatiya\s+Nyaya\s+Sanhita"
SECTION_CITATIONS = re.compile(
    rf"\b(?:sections?|u\s*/\s*s\.?)\s+(?P<sections>{PROVISION}"
    rf"(?:\s*(?:[,/&]|and|read\s+with|r\s*/\s*w)\s*{PROVISION})*)"
    rf"\s*(?:of\s+(?:the\s+)?)?(?:{ACT})",
    re.IGNORECASE,
)


class LocalModel:
    def __init__(self, directory):
        self.manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
        self.tokenizer = tokenizer(directory)
        options = ort.SessionOptions()
        options.intra_op_num_threads = 4
        options.inter_op_num_threads = 1
        self.session = ort.InferenceSession(str(directory / "model.onnx"), options, providers=["CPUExecutionProvider"])

    def rows(self, inputs):
        for offset in range(0, len(inputs), 16):
            batch = inputs[offset:offset + 16]
            width = max(map(len, batch))
            ids = np.full((len(batch), width), self.tokenizer.pad_token_id, dtype=np.int64)
            mask = np.zeros_like(ids)
            for i, row in enumerate(batch):
                ids[i, :len(row)] = row
                mask[i, :len(row)] = 1
            yield from self.session.run(["logits"], {"input_ids": ids, "attention_mask": mask})[0]

    def sections(self, text):
        windows = chunks(self.tokenizer, [text], self.manifest["length"], self.manifest["stride"])[0]
        maxima = np.max(list(self.rows(windows)), axis=0)
        labels = self.manifest["labels"]
        return [labels[i] for i in np.argsort(-maxima, kind="stable")[:5]]

    def roles(self, sentences, progress=False):
        ids = truncate(self.tokenizer, sentences, self.manifest["length"])
        order = sorted(range(len(ids)), key=lambda i: len(ids[i]))
        batches = np.empty((len(ids), len(self.manifest["labels"])), dtype=np.float32)
        for count, (i, logits) in enumerate(zip(order, self.rows([ids[i] for i in order]), strict=True), 1):
            batches[i] = logits
            if progress and count % 2000 == 0:
                print(f"Summary sentences classified: {count}/{len(ids)}", flush=True)
        labels = self.manifest["labels"]
        best = batches.argmax(axis=1)
        probability = 1 / np.exp(batches - np.max(batches, axis=1, keepdims=True)).sum(axis=1)
        return [(labels[i], float(score)) for i, score in zip(best, probability, strict=True)]


def summary_indices(predictions, k=6):
    def value(i):
        role, confidence = predictions[i]
        position = i / max(1, len(predictions) - 1)
        bonus = 1 - position if role in SUMMARY_ROLES[:2] else position if role in SUMMARY_ROLES[2:] else 0
        return confidence + 0.35 * bonus

    ordered = sorted(range(len(predictions)), key=lambda i: (-value(i), i))
    chosen = set()
    for role in SUMMARY_ROLES:
        candidate = next((i for i in ordered if predictions[i][0] == role), None)
        if candidate is not None and len(chosen) < k:
            chosen.add(candidate)
    preferred = [i for i in ordered if predictions[i][0] in SUMMARY_ROLES]
    for i in [*preferred, *range(len(predictions))]:
        if len(chosen) >= k:
            break
        chosen.add(i)
    return sorted(chosen)


def rouge_tokens(text):
    return re.findall(r"[a-z0-9]+", text.lower())


def lcs(first, second):
    # Bit-parallel exact longest common subsequence.
    masks = {}
    for i, word in enumerate(first):
        masks[word] = masks.get(word, 0) | 1 << i
    state = 0
    for word in second:
        matches = masks.get(word, 0) | state
        state = matches & ~(matches - ((state << 1) | 1))
    return state.bit_count()


def rouge(first, second):
    candidate, reference = map(rouge_tokens, (first, second))
    scores = {}
    for n in (1, 2):
        def ngrams(tokens):
            return Counter(zip(*(tokens[i:] for i in range(n))))
        overlap_count = sum((ngrams(candidate) & ngrams(reference)).values())
        size = max(0, len(candidate) - n + 1) + max(0, len(reference) - n + 1)
        scores[f"rouge{n}"] = 2 * overlap_count / size if size else 0
    size = len(candidate) + len(reference)
    scores["rougeL"] = 2 * lcs(candidate, reference) / size if size else 0
    return scores


def summary(data, output):
    model = LocalModel(output / "rr")
    test = split(data, "summ", "test")
    # One length-bucketed classifier pass avoids padding short sentences to the
    # longest sentence in their judgment. Restore document order before selection.
    predictions = model.roles([sentence for row in test for sentence in row["document"]], progress=True)
    offset = 0
    systems = {"role_position": Counter(), "lead_6": Counter()}
    for row in test:
        sentences = row["document"]
        reference = " ".join(row["summary"])
        stop = offset + len(sentences)
        chosen = summary_indices(predictions[offset:stop])
        offset = stop
        systems["role_position"].update(rouge(" ".join(sentences[j] for j in chosen), reference))
        systems["lead_6"].update(rouge(" ".join(sentences[:6]), reference))
    rr_train = split(data, "rr", "CL_train") + split(data, "rr", "IT_train")
    mapped = [{"id": row["id"], "text": row["document"]} for row in test]
    value = {
        "test_documents": len(test), "k": 6, "rr_train_summ_test_leakage": overlap(rr_train, mapped, "text"),
        "scores": {name: {metric: total / len(test) for metric, total in scores.items()}
                   for name, scores in systems.items()},
    }
    write_json(output / "summ-metrics.json", value)
    print(value, flush=True)


def cited_sections(text):
    return {
        ("IPC" if match["ipc"] else "BNS", re.sub(r"[\s-]+", "", section).upper())
        for match in SECTION_CITATIONS.finditer(text)
        for section in re.findall(PROVISION, match["sections"], flags=re.IGNORECASE)
    }


def provision_keys(labels):
    keys = {("IPC", entry["section"]) for entry in labels}
    keys.update(("BNS", section.upper()) for entry in labels for mapping in entry["bns"]
                for section in re.findall(PROVISION, mapping["section"], flags=re.IGNORECASE))
    return keys


def real_orders(gov, output, requested):
    model = LocalModel(output / "lsi")
    supported = provision_keys(model.manifest["labels"])
    count = eligible = in_vocabulary = hits = ipc_hits = bns_hits = 0
    archives = Counter()
    for count, (text, archive) in enumerate(sampled_orders(gov, requested), 1):
        archives[archive] += 1
        gold = cited_sections(text)
        eligible += bool(gold)
        in_vocabulary += bool(gold & supported)
        matched = gold & provision_keys(model.sections(text))
        hits += bool(matched)
        ipc_hits += any(act == "IPC" for act, _ in matched)
        bns_hits += any(act == "BNS" for act, _ in matched)
        if count % 20 == 0:
            print(f"Real orders evaluated: {count}/{requested}", flush=True)
    value = {
        "requested": requested, "text_layer_orders": count, "orders_with_ipc_or_bns_citation": eligible,
        "orders_with_supported_citation": in_vocabulary, "top5_hits": hits,
        "ipc_top5_hits": ipc_hits, "bns_top5_hits": bns_hits,
        "sampled_archives": dict(sorted(archives.items())),
        "hit_rate_all": hits / count if count else None,
        "hit_rate_among_cited": hits / eligible if eligible else None,
        "hit_rate_among_supported": hits / in_vocabulary if in_vocabulary else None,
    }
    write_json(output / "cg-2026-metrics.json", value)
    print(value, flush=True)
    if count < requested:
        raise RuntimeError(f"Only {count} readable orders were available, expected {requested}.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("evaluation", choices=("summ", "cg-2026"))
    parser.add_argument("--data", type=Path, default=DATA)
    parser.add_argument("--gov", type=Path, default=GOV)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--count", type=int, default=200)
    args = parser.parse_args()
    if args.evaluation == "summ":
        summary(args.data, args.output)
    else:
        real_orders(args.gov, args.output, args.count)
