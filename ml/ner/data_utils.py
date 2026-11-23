"""Pinned InLegalNER data loading and character-span alignment."""

from __future__ import annotations

import json
import random
from pathlib import Path

from datasets import Dataset
import pyarrow.parquet as parquet


ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
ENTITY_TYPES = (
    "COURT", "PETITIONER", "RESPONDENT", "JUDGE", "LAWYER", "DATE",
    "ORG", "GPE", "STATUTE", "PROVISION", "PRECEDENT", "CASE_NUMBER",
    "WITNESS", "OTHER_PERSON",
)
LABELS = ["O"] + [f"{prefix}-{entity}" for entity in ENTITY_TYPES for prefix in ("B", "I")]
LABEL_TO_ID = {label: index for index, label in enumerate(LABELS)}
OFFICIAL_FILES = {
    "train": "train-00000-of-00001-de25c1ae1db42f79.parquet",
    "dev": "dev-00000-of-00001-b148266485fd7aeb.parquet",
    "test": "test-00000-of-00001-814a730def5e8488.parquet",
}


def load_official(split: str, data_dir: Path = DATA) -> Dataset:
    """Read the pinned official Label Studio annotations without a second cache."""
    path = data_dir / "official" / "data" / OFFICIAL_FILES[split]
    rows = []
    for source in parquet.read_table(path).to_pylist():
        text = source["data"]["text"]
        entities = []
        for annotation in source["annotations"]:
            for result in annotation["result"]:
                value = result["value"]
                label = value["labels"][0]
                start, end = value["start"], value["end"]
                if label not in ENTITY_TYPES or not 0 <= start < end <= len(text):
                    raise ValueError(f"Invalid annotation in {split}: {source['id']}")
                entities.append({"start": start, "end": end, "label": label})
        rows.append({"text": text, "entities": entities,
                     "part": "preamble" if "preamble" in source["meta"]["source"].lower() else "judgment"})
    return Dataset.from_list(rows)


def load_annotations(split: str) -> Dataset:
    if split not in ("train", "dev"):
        raise ValueError(split)
    path = DATA / f"{split}_annotations.json"
    with path.open(encoding="utf-8") as stream:
        rows = json.load(stream)
    for row in rows:
        for entity in row["entities"]:
            if entity["label"] not in ENTITY_TYPES:
                raise ValueError(f"Unexpected entity: {entity['label']}")
            if not (0 <= entity["start"] < entity["end"] <= len(row["text"])):
                raise ValueError("Invalid entity offset")
    return Dataset.from_list(rows)


def split_dev_preambles() -> tuple[Dataset, Dataset]:
    """Each of the first 125 dev records is one distinct document preamble."""
    preambles = load_annotations("dev").select(range(125))
    test_indices = set(random.Random(42).sample(range(125), 25))
    development = preambles.select([i for i in range(125) if i not in test_indices])
    test = preambles.select(sorted(test_indices))
    return development, test


def tokenize_spans(batch, tokenizer, max_length=256, stride=64):
    encoded = tokenizer(
        batch["text"], truncation=True, max_length=max_length, stride=stride,
        return_overflowing_tokens=True, return_offsets_mapping=True,
        padding=False,
    )
    sample_map = encoded.pop("overflow_to_sample_mapping")
    offsets = encoded.pop("offset_mapping")
    labels = []
    for chunk, sample_index in enumerate(sample_map):
        entities = sorted(batch["entities"][sample_index], key=lambda item: item["start"])
        word_ids = encoded.word_ids(batch_index=chunk)
        previous_word = None
        chunk_labels = []
        for token_index, ((start, end), word_id) in enumerate(zip(offsets[chunk], word_ids)):
            if word_id is None or word_id == previous_word:
                chunk_labels.append(-100)
            elif chunk > 0 and sample_index == sample_map[chunk - 1] and token_index <= stride:
                chunk_labels.append(-100)
            else:
                entity = next((item for item in entities if item["start"] <= start and end <= item["end"]), None)
                if entity is None:
                    chunk_labels.append(LABEL_TO_ID["O"])
                else:
                    prefix = "B" if start <= entity["start"] else "I"
                    chunk_labels.append(LABEL_TO_ID[f"{prefix}-{entity['label']}"])
            previous_word = word_id
        labels.append(chunk_labels)
    encoded["labels"] = labels
    return encoded


def tokenize_test(batch, tokenizer, max_length=256, stride=64, tag_names=None):
    if tag_names is None:
        raise ValueError("test tag names required")
    encoded = tokenizer(
        batch["tokens"], is_split_into_words=True, truncation=True,
        max_length=max_length, stride=stride, return_overflowing_tokens=True,
        padding=False,
    )
    sample_map = encoded.pop("overflow_to_sample_mapping")
    labels = []
    for chunk, sample_index in enumerate(sample_map):
        word_ids = encoded.word_ids(batch_index=chunk)
        previous_word = None
        chunk_labels = []
        for token_index, word_id in enumerate(word_ids):
            if word_id is None or word_id == previous_word or (chunk > 0 and sample_index == sample_map[chunk - 1] and token_index <= stride):
                chunk_labels.append(-100)
            else:
                source_tag = batch["ner_tags"][sample_index][word_id]
                chunk_labels.append(LABEL_TO_ID[tag_names[source_tag]])
            previous_word = word_id
        labels.append(chunk_labels)
    encoded["labels"] = labels
    return encoded
