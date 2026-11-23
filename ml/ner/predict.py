"""Print local ONNX NER suggestions as JSON for a UTF-8 text file."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import onnxruntime as ort
from transformers import AutoTokenizer

from data_utils import ROOT


def predict(text: str, artifact: Path):
    tokenizer = AutoTokenizer.from_pretrained(str(artifact), local_files_only=True)
    config = json.loads((artifact / "config.json").read_text(encoding="utf-8"))
    labels = config["id2label"]
    session = ort.InferenceSession(str(artifact / "onnx" / "model.onnx"), providers=["CPUExecutionProvider"])
    encoded = tokenizer(text, truncation=True, max_length=256, stride=64, return_overflowing_tokens=True,
                        return_offsets_mapping=True, return_tensors=None)
    token_predictions = {}
    for chunk in range(len(encoded["input_ids"])):
        feed = {item.name: np.asarray([encoded[item.name][chunk]], dtype=np.int64) for item in session.get_inputs()}
        logits = session.run(None, feed)[0][0]
        word_ids = encoded.word_ids(batch_index=chunk)
        word_spans = {}
        for index, ((start, end), word_id) in enumerate(zip(encoded["offset_mapping"][chunk], word_ids)):
            if word_id is None:
                continue
            if word_id not in word_spans:
                word_spans[word_id] = [start, end, index]
            else:
                word_spans[word_id][1] = end
        for start, end, first_index in word_spans.values():
            if (start, end) in token_predictions:
                continue
            scores = logits[first_index]
            shifted = scores - np.max(scores)
            probability = np.exp(shifted) / np.exp(shifted).sum()
            label_id = int(np.argmax(scores))
            token_predictions[(start, end)] = (labels[str(label_id)], float(probability[label_id]))
    entities = []
    current = None
    for (start, end), (tag, probability) in sorted(token_predictions.items()):
        if tag == "O":
            current = None
            continue
        prefix, label = tag.split("-", 1)
        if prefix == "B" or current is None or current["label"] != label:
            current = {"label": label, "start": start, "end": end, "score": probability}
            entities.append(current)
        else:
            current["end"] = end
            current["score"] = min(current["score"], probability)
    for entity in entities:
        entity["text"] = text[entity["start"]:entity["end"]]
    return entities


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("file", type=Path)
    args = parser.parse_args()
    text = args.file.read_text(encoding="utf-8")
    artifact = ROOT / "artifacts" / "courtplus-legalner"
    print(json.dumps(predict(text, artifact), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
