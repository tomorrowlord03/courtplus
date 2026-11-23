"""Small fixture tests for offline evaluation and archive joining."""

from concurrent.futures import ThreadPoolExecutor
import gzip
from io import BytesIO
import json
from pathlib import Path
import sys
import tarfile
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import pyarrow as pa
import pyarrow.parquet as pq
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from common import chunks, digest
from evaluate import cited_sections, rouge, summary_indices
from government import extract_archive, extract_batch, key, read_pdf


class FictionalTokenizer:
    cls_token_id = 101
    sep_token_id = 102

    def __call__(self, texts, **kwargs):
        return {"input_ids": [[int(part) for part in text.split()] for text in texts]}


class PipelineTest(unittest.TestCase):
    def test_windows_cover_the_tail(self):
        tokenizer = FictionalTokenizer()
        self.assertEqual(chunks(tokenizer, ["1 2 3 4 5 6 7 8", ""], length=8, stride=2), [
            [[101, 1, 2, 3, 4, 5, 6, 102], [101, 5, 6, 7, 8, 102]],
            [[101, 102]],
        ])

    def test_archival_keys_and_normalized_leakage(self):
        self.assertEqual(key("fictional/2099_1_23_24_EN.pdf"), key("2099_1_23_24.pdf"))
        self.assertEqual(digest(["Ｆictional", "Case"]), digest("fictional\n case"))

    def test_skips_fictional_pdf_without_a_text_layer(self):
        storage = BytesIO()
        writer = PdfWriter()
        writer.add_blank_page(width=100, height=100)
        writer.write(storage)
        self.assertEqual(extract_batch([({"id": "fictional-order"}, storage.getvalue())]), [])

    def test_replaces_unpaired_surrogates_from_pdf_text(self):
        page = SimpleNamespace(extract_text=lambda: "Fictional \udd00 order.")
        with patch("government.PdfReader", return_value=SimpleNamespace(pages=[page])):
            self.assertEqual(read_pdf(b"fixture"), "Fictional \ufffd order.")

    def test_streams_a_fictional_pdf_and_joins_case_metadata(self):
        storage = BytesIO()
        writer = PdfWriter()
        page = writer.add_blank_page(width=200, height=200)
        name = NameObject
        page[name("/Resources")] = DictionaryObject({
            name("/Font"): DictionaryObject({
                name("/F1"): DictionaryObject({
                    name("/Type"): name("/Font"), name("/Subtype"): name("/Type1"),
                    name("/BaseFont"): name("/Helvetica"),
                }),
            }),
        })
        contents = DecodedStreamObject()
        contents.set_data(b"BT /F1 12 Tf 20 50 Td (A fictional lantern order.) Tj ET")
        page.replace_contents(contents)
        writer.write(storage)
        with TemporaryDirectory() as folder:
            root = Path(folder)
            metadata = root / "hc-cg/metadata/year=2026"
            metadata.mkdir(parents=True)
            pq.write_table(pa.Table.from_pylist([{
                "title": "FICTIONAL/1 of Lantern v Compass", "judge": "Fictional Judge",
                "decision_date": "2026-01-01", "court": "Fictional Court",
                "pdf_link": "court/cnrorders/cghccisdb/orders/fictional.pdf", "cnr": "FICTIONAL",
            }]), metadata / "metadata.parquet")
            archive = root / "fictional.tar"
            header = tarfile.TarInfo("fictional.pdf")
            header.size = storage.getbuffer().nbytes
            storage.seek(0)
            with tarfile.open(archive, "w") as tar:
                tar.addfile(header, storage)
            with ThreadPoolExecutor(max_workers=1) as workers:
                cache, stats = extract_archive(root, "hc-cg", 2026, archive, root, workers, 1)
            self.assertEqual(stats["indexed"], 1)
            with gzip.open(cache, "rt", encoding="utf-8") as source:
                [row] = map(json.loads, source)
            self.assertEqual((row["caseNumber"], row["text"]), ("FICTIONAL/1", "A fictional lantern order."))

    def test_citations_distinguish_acts_in_a_fictional_order(self):
        text = "The fictional order considered Sections 120-B and 294 (b) of the IPC, and Section 103(1) BNS."
        self.assertEqual(cited_sections(text), {("IPC", "120B"), ("IPC", "294(B)"), ("BNS", "103(1)")})

    def test_rouge_and_summary_selection(self):
        self.assertEqual(rouge("fictional blue lantern", "fictional red lantern"), {
            "rouge1": 2 / 3, "rouge2": 0, "rougeL": 2 / 3,
        })
        roles = [("Fact", 0.7), ("Fact", 0.75), ("Issue", 0.8),
                 ("RatioOfTheDecision", 0.7), ("RulingByPresentCourt", 0.55)]
        self.assertEqual(summary_indices(roles, 4), [0, 2, 3, 4])


if __name__ == "__main__":
    unittest.main()
