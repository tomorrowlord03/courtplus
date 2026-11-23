"""Run the audited IBJ-only LegalNER comparison with local datasets and checkpoints."""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import shutil
import subprocess
import sys
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent
FIELDS = {"dates": "DATE", "case_numbers": "CASE_NUMBER", "statutes": "STATUTE", "names": "PERSON"}
MIN_F1_DELTA = -0.005
BOOTSTRAP = (
    "import runpy, sys; sys.path.insert(0, sys.argv.pop(1)); "
    "runpy.run_module(sys.argv.pop(1), run_name='__main__')"
)


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def run_python(module, *args):
    subprocess.run([sys.executable, "-I", "-B", "-c", BOOTSTRAP, str(ROOT), module,
                    *map(str, args)], cwd=REPO, check=True)


def extract_pdfs(ibj, pdfs):
    pdfs.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(ibj / "IndianBailJudgments-1200_PDFS.zip") as archive:
        for member in archive.infolist():
            filename = Path(member.filename).name.lower()
            if member.is_dir() or not re.fullmatch(r"case\d{4}\.pdf", filename):
                continue
            target = pdfs / filename
            if target.is_file() and target.stat().st_size == member.file_size:
                continue
            partial = target.with_suffix(".partial")
            with archive.open(member) as source, partial.open("wb") as destination:
                shutil.copyfileobj(source, destination)
            partial.replace(target)


def audit(args):
    ibj = args.datasets / "ibj1200"
    pdfs = args.pdfs or ibj / "pdfs"
    if not pdfs.exists():
        extract_pdfs(ibj, pdfs)
    run_python("audit_real_data", "--datasets", args.datasets,
               "--official", args.previous_ner / "data" / "official",
               "--cg-gold", args.previous_ner / "data" / "cg_gold.json",
               "--cg-text", args.previous_ner / "data" / "cg_text",
               "--pdfs", pdfs, "--text-cache", args.text_cache or args.work / "ibj-text",
               "--output", args.work / "manifest.json")


def train(args):
    data = args.previous_ner / "data"
    dapt = args.work / "dapt"
    if not (dapt / "dapt.json").is_file():
        run_python("dapt", "--base", data / "base-model", "--manifest", args.work / "manifest.json",
                   "--output", dapt)
    run_python("train", "--data-dir", data, "--model-path", dapt, "--run-dir", args.work / "dapt-ner")


def evaluate_intake(args, candidate, artifact):
    output = args.work / f"{candidate}-intake.json"

    def run_shard(shard, destination):
        subprocess.run(["node", str(ROOT / "evaluate_intake.mjs"), str(args.intake_dist), str(artifact),
                        str(args.work / "manifest.json"), str(destination),
                        str(args.hldc_text) if args.hldc_text and shard == 0 else "",
                        str(shard), str(args.intake_workers)], cwd=REPO, check=True)
        return read_json(destination)

    if args.intake_workers == 1:
        run_shard(0, output)
        return
    destinations = [output.with_suffix(f".part{index}.json") for index in range(args.intake_workers)]
    with ThreadPoolExecutor(max_workers=args.intake_workers) as pool:
        reports = list(pool.map(run_shard, range(args.intake_workers), destinations))
    result = {"orders": sum(item["orders"] for item in reports),
              "empty_ipc_reference_orders": sum(item["empty_ipc_reference_orders"] for item in reports)}
    if result["orders"] != 200:
        raise RuntimeError("Expected 200 scored IBJ orders")
    for field in ("ipc_sections", "court"):
        counts = {key: sum(item[field][key] for item in reports) for key in ("tp", "predicted", "reference")}
        counts["precision"] = counts["tp"] / counts["predicted"] if counts["predicted"] else 0
        counts["recall"] = counts["tp"] / counts["reference"] if counts["reference"] else 0
        result[field] = counts
    correct = sum(item["court"]["top_suggestion_correct"] for item in reports)
    result["court"].update(top_suggestion_correct=correct, top_suggestion_accuracy=correct / result["orders"])
    if "hldc" in reports[0]:
        result["hldc"] = reports[0]["hldc"]
    write_json(output, result)
    ipc, court = result["ipc_sections"], result["court"]
    print(f"IBJ IPC P={ipc['precision']:.4f} R={ipc['recall']:.4f}; "
          f"court top accuracy={court['top_suggestion_accuracy']:.4f}; orders=200", flush=True)


def evaluate(args, candidate):
    data = args.previous_ner / "data"
    artifact = args.previous_ner / "artifacts" / "courtplus-legalner"
    run_dir = args.current_run
    if candidate == "dapt":
        artifact = args.work / "dapt-onnx"
        run_dir = args.work / "dapt-ner"
        run_python("export_model", "--run-dir", run_dir, "--artifact", artifact, "--fp32-only")
    run_python("evaluate_model", "--run-dir", run_dir, "--data-dir", data,
               "--output", args.work / f"{candidate}-official.json")
    run_python("evaluate_cg", "--gold", data / "cg_gold.json", "--orders", args.orders,
               "--artifact", artifact, "--output", args.work / f"{candidate}-cg.json")
    evaluate_intake(args, candidate, artifact)


def compare(work):
    candidates = {}
    for name in ("current", "dapt"):
        official = read_json(work / f"{name}-official.json")
        candidates[name] = {
            "official": {"combined": official["overall"], **official["scores"]},
            "cg": read_json(work / f"{name}-cg.json"),
            "ibj1200": read_json(work / f"{name}-intake.json"),
            "lner_fold_3": None,
        }
    candidates["dapt"]["pretraining"] = read_json(work / "dapt" / "dapt.json")
    current, adapted = candidates["current"], candidates["dapt"]
    f1_delta = adapted["official"]["combined"]["f1"] - current["official"]["combined"]["f1"]
    deltas = {field: adapted["cg"]["scores"][label]["recall"] - current["cg"]["scores"][label]["recall"]
              for field, label in FIELDS.items()}
    improvements = [field for field, delta in deltas.items() if delta > 0]
    within_f1_budget = f1_delta >= MIN_F1_DELTA or math.isclose(f1_delta, MIN_F1_DELTA, abs_tol=1e-12)
    ship = len(improvements) >= 2 and within_f1_budget
    return {
        "audit": read_json(work / "manifest.json")["audit"],
        "il_tur": {"download_http_status": 403, "lner_fold_3": None,
                   "hldc": "see candidate counts" if "hldc" in current["ibj1200"] else None},
        "ibj_reference": "Author-provided machine-assisted IPC and court annotations",
        "candidates": {**candidates, "dapt_plus_lner": None},
        "gate": {"decision": "ship_dapt" if ship else "keep_current",
                 "minimum_improved_fields": 2, "minimum_combined_f1_delta": MIN_F1_DELTA,
                 "cg_recall_delta": deltas, "cg_improved_fields": improvements,
                 "combined_f1_delta": f1_delta},
    }


def markdown_report(experiment):
    gate = experiment["gate"]
    audit = experiment["audit"]
    ibj = audit["ibj1200"]
    lines = [
        "## Real bail-order adaptation", "",
        "| Candidate | Official F1 combined | Judgment | Preamble | CG dates R | CG cases R | CG statutes R | CG names R | IBJ IPC P / R | IBJ court P / R / top accuracy | L-NER fold 3 |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for key, name in (("current", "Current"), ("dapt", "DAPT"), ("dapt_plus_lner", "DAPT + L-NER")):
        candidate = experiment["candidates"][key]
        if candidate is None:
            lines.append(f"| {name} | — | — | — | — | — | — | — | — | — | — |")
            continue
        official, cg, external = (candidate[key] for key in ("official", "cg", "ibj1200"))
        values = [official["combined"]["f1"], official["judgment"]["overall"]["f1"],
                  official["preamble"]["overall"]["f1"]]
        field_recall = [cg["scores"][label]["recall"] for label in FIELDS.values()]
        ipc, court = (external[key] for key in ("ipc_sections", "court"))
        scores = " | ".join([*(f"{value:.4f}" for value in values),
                             *(f"{value:.3f}" for value in field_recall)])
        lines.append(f"| {name} | {scores} | {ipc['precision']:.3f} / {ipc['recall']:.3f} | "
                     f"{court['precision']:.3f} / {court['recall']:.3f} / "
                     f"{court['top_suggestion_accuracy']:.3f} | — |")
    improved = ", ".join(gate["cg_improved_fields"]) or "none"
    decision = "Ship DAPT" if gate["decision"] == "ship_dapt" else "Keep the current model"
    lines += [
        "", f"**Release decision. {decision}.** Official combined F1 changed by "
        f"{gate['combined_f1_delta']:+.4f}. CG recall improved in "
        f"{len(gate['cg_improved_fields'])} of four gate fields ({improved}). "
        "Release requires improvement in at least two CG fields and an official combined F1 loss of at most 0.005.",
        "", "### Leakage and data sources", "",
        "| Candidate source | Units | Official test | Official dev | CG gold | Excluded for overlap |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for name, value, units in (
        ("IBJ-1200", ibj, "orders"),
        ("hf-tuner train", audit["hf_tuner"]["train"], "rows"),
        ("hf-tuner validation", audit["hf_tuner"]["validation"], "rows"),
        ("Figshare", audit["figshare"], "documents"),
    ):
        lines.append(f"| {name} | {value[units]} | {value['official_test']} | {value['official_dev']} | "
                     f"{value['cg_gold']} | {value['excluded_overlap']} |")
    pretraining = experiment["candidates"]["dapt"]["pretraining"]
    tuner_rows = sum(audit["hf_tuner"][split]["matches_any_official_exact_row"] for split in ("train", "validation"))
    lines += [
        "",
        f"Counts can intersect across split columns. The audit compared normalized text and removed duplicate and "
        f"near-duplicate IBJ orders. Seed 42 selected {ibj['held_out']} held-out orders from {ibj['external_pool']} "
        "eligible orders after also checking official train. The masked-language run used "
        f"{pretraining['orders']} PDF text layers for {pretraining['steps']} optimizer steps in "
        f"{pretraining['elapsed_seconds'] / 60:.1f} minutes. The objective used PDF text only. "
        "NER fine-tuning used official train and selected the checkpoint on official dev. "
        "[IndianBailJudgments-1200, CC BY 4.0](https://huggingface.co/datasets/SnehaDeshmukh/IndianBailJudgments-1200)",
        "",
        f"All {tuner_rows:,} hf-tuner rows match normalized rows in official InLegalNER. The repackage was excluded. "
        f"The {audit['figshare']['documents']}-document Figshare workbook has token-level BILOU annotations with "
        "partial coverage and incompatible classes. "
        "For example, its date tag covers judgment dates and its party-type tag covers role markers. The workbook was excluded. "
        "[Indian Court Decision Annotated Corpus, CC BY 4.0](https://doi.org/10.6084/m9.figshare.19719088.v2)",
        "",
        "IL-TUR returned HTTP 403 on the authenticated retry. The DAPT + L-NER candidate, L-NER fold 3, and "
        "the 20-document HLDC smoke test are unavailable. "
        "[IL-TUR, CC BY-NC-SA 4.0](https://huggingface.co/datasets/Exploration-Lab/IL-TUR)",
        "",
        "IBJ compares distinct IPC section numbers and courts per order using the production intake model and rules. "
        "Section numbers ignore prefixes and subsections, and court names use normalized written aliases. "
        "Court top accuracy checks only the first suggestion. The author-provided IPC and court reference annotations "
        "were machine-generated with consistency checks and may be incomplete. "
        "[Dataset paper](https://arxiv.org/abs/2507.02506)",
        "",
        "### Reproduce the IBJ-only run", "",
        "From the repository root in PowerShell, "
        "use a Python environment for ml/ner and a built intake package from the same revision. "
        "The intermediate files default to E:/AI-cache/courtplus-ml/w28.", "",
        "```powershell",
        "$python = 'ml/ner/.venv/Scripts/python.exe'",
        "$intake = 'packages/intake/dist'",
        "$env:TEMP = 'E:/AI-cache/tmp'",
        "$env:TMP = $env:TEMP",
        "$env:HF_HOME = 'E:/AI-cache/huggingface'",
        "& $python -I -B ml/ner/real_data.py audit",
        "& $python -I -B ml/ner/real_data.py train",
        "& $python -I -B ml/ner/real_data.py evaluate --candidate current --intake-dist $intake",
        "& $python -I -B ml/ner/real_data.py evaluate --candidate dapt --intake-dist $intake",
        "& $python -I -B ml/ner/real_data.py report",
        "```",
    ]
    return "\n".join(lines)


def report(args):
    experiment = compare(args.work)
    path = ROOT / "metrics.json"
    metrics = read_json(path)
    metrics["real_data_experiment"] = experiment
    write_json(path, metrics)
    markdown = ROOT / "METRICS.md"
    previous = markdown.read_text(encoding="utf-8").split("\n## Real bail-order adaptation\n")[0]
    markdown.write_text(previous.rstrip() + "\n\n" + markdown_report(experiment) + "\n", encoding="utf-8")
    gate = experiment["gate"]
    print(f"Gate {gate['decision']}: official combined F1 delta {gate['combined_f1_delta']:+.4f}; "
          f"{len(gate['cg_improved_fields'])}/4 CG recall fields improved", flush=True)


def publish(args):
    if compare(args.work)["gate"]["decision"] != "ship_dapt":
        raise RuntimeError("The DAPT checkpoint did not pass the release gate")
    build = args.work / "release-onnx"
    run_dir = args.work / "dapt-ner"
    run_python("export_model", "--run-dir", run_dir, "--artifact", build)
    run_python("parity", "--run-dir", run_dir, "--data-dir", args.previous_ner / "data",
               "--artifact", build, "--output", ROOT / "parity.json")
    shutil.copytree(build, ROOT / "artifacts" / "courtplus-legalner", dirs_exist_ok=True)
    shutil.copytree(build, args.release_cache, dirs_exist_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=("audit", "train", "evaluate", "report", "publish"))
    parser.add_argument("--candidate", choices=("current", "dapt"))
    parser.add_argument("--datasets", type=Path, default=Path("E:/AI-cache/datasets"))
    parser.add_argument("--work", type=Path, default=Path("E:/AI-cache/courtplus-ml/w28"))
    parser.add_argument("--current-run", type=Path, default=Path("E:/AI-cache/courtplus-ml/runs/legalner-official"))
    parser.add_argument("--release-cache", type=Path, default=Path("E:/AI-cache/courtplus-ml/courtplus-legalner-v2"))
    parser.add_argument("--previous-ner", type=Path, default=REPO.parent / "w3-ml" / "ml" / "ner")
    parser.add_argument("--orders", type=Path, default=REPO.parent.parent / "repo" / "orders")
    parser.add_argument("--intake-dist", type=Path, default=REPO / "packages" / "intake" / "dist")
    parser.add_argument("--intake-workers", type=int, choices=(1, 2), default=2)
    parser.add_argument("--pdfs", type=Path)
    parser.add_argument("--text-cache", type=Path)
    parser.add_argument("--hldc-text", type=Path, help="Local JSON array of 20 HLDC texts, with no labels")
    args = parser.parse_args()
    if (args.stage == "evaluate") != bool(args.candidate):
        parser.error("evaluate requires --candidate, which applies only to that stage")
    args.work.mkdir(parents=True, exist_ok=True)
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_DATASETS_OFFLINE"] = "1"
    if args.stage == "evaluate":
        evaluate(args, args.candidate)
    else:
        {"audit": audit, "train": train, "report": report, "publish": publish}[args.stage](args)


if __name__ == "__main__":
    main()
