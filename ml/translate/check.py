"""
Sanity check script for i18n translation completeness and placeholder integrity.
Validates all 13 language files:
- data/i18n/en.json (English source)
- data/i18n/<lang>.json for hi, bn, ta, te, mr, gu, kn, ml, pa, or, as, ur.

Checks:
1. All 13 JSON files exist and are valid JSON.
2. All keys from en.json exist in every target language file.
3. All placeholders ({days}, {courtName}, {dlsaName}, {dlsaPhone}) are intact in each file.
4. The '_meta' block is present and valid for all machine-translated files.
5. Prints a markdown verification table and exits with code 0 on success.
"""

import os
import sys
import json

TARGET_LANGS = [
    {"code": "en", "name": "English (Source)", "is_source": True},
    {"code": "hi", "name": "Hindi", "is_source": False},
    {"code": "bn", "name": "Bengali", "is_source": False},
    {"code": "ta", "name": "Tamil", "is_source": False},
    {"code": "te", "name": "Telugu", "is_source": False},
    {"code": "mr", "name": "Marathi", "is_source": False},
    {"code": "gu", "name": "Gujarati", "is_source": False},
    {"code": "kn", "name": "Kannada", "is_source": False},
    {"code": "ml", "name": "Malayalam", "is_source": False},
    {"code": "pa", "name": "Punjabi", "is_source": False},
    {"code": "or", "name": "Odia", "is_source": False},
    {"code": "as", "name": "Assamese", "is_source": False},
    {"code": "ur", "name": "Urdu", "is_source": False},
]

EXPECTED_PLACEHOLDERS = {
    "status_due_in_n_days": ["{days}"],
    "heading_court_title": ["{courtName}"],
    "rights_contact": ["{dlsaName}", "{dlsaPhone}"],
}


def check_all():
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    i18n_dir = os.path.join(base_dir, "data", "i18n")
    en_path = os.path.join(i18n_dir, "en.json")

    if not os.path.exists(en_path):
        print(f"ERROR: Source file {en_path} not found!")
        sys.exit(1)

    with open(en_path, "r", encoding="utf-8") as f:
        en_data = json.load(f)

    source_keys = set(en_data.keys())
    total_source_keys = len(source_keys)

    results = []
    all_passed = True

    for lang in TARGET_LANGS:
        code = lang["code"]
        name = lang["name"]
        is_source = lang["is_source"]
        file_path = os.path.join(i18n_dir, f"{code}.json")

        if not os.path.exists(file_path):
            results.append({
                "code": code,
                "name": name,
                "exists": False,
                "keys": "0/0",
                "placeholders": "0/4",
                "meta": "Missing",
                "status": "FAIL (File Missing)",
            })
            all_passed = False
            continue

        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as e:
            results.append({
                "code": code,
                "name": name,
                "exists": True,
                "keys": "Invalid JSON",
                "placeholders": "0/4",
                "meta": "Invalid",
                "status": f"FAIL (Parse error: {e})",
            })
            all_passed = False
            continue

        # Check keys
        present_keys = set(data.keys())
        if not is_source:
            present_keys.discard("_meta")

        missing_keys = source_keys - present_keys
        extra_keys = present_keys - source_keys
        keys_ok = (len(missing_keys) == 0 and len(present_keys) == total_source_keys)
        keys_str = f"{len(present_keys)}/{total_source_keys}"

        # Check placeholders
        placeholder_issues = []
        checked_ph_count = 0
        total_ph_count = sum(len(phs) for phs in EXPECTED_PLACEHOLDERS.values())

        for key, ph_list in EXPECTED_PLACEHOLDERS.items():
            val = data.get(key, "")
            for ph in ph_list:
                if ph in val:
                    checked_ph_count += 1
                else:
                    placeholder_issues.append(f"{key} missing {ph}")

        ph_ok = (checked_ph_count == total_ph_count)
        ph_str = f"{checked_ph_count}/{total_ph_count}"

        # Check meta
        if is_source:
            meta_str = "N/A"
            meta_ok = True
        else:
            meta = data.get("_meta", {})
            has_mt = meta.get("machineTranslated") is True
            has_model = bool(meta.get("model"))
            has_rev = bool(meta.get("revision"))
            has_reviewed = meta.get("reviewed") is False
            has_date = bool(meta.get("date"))
            meta_ok = has_mt and has_model and has_rev and has_reviewed and has_date
            meta_str = "OK" if meta_ok else "Invalid"

        status_ok = keys_ok and ph_ok and meta_ok
        if not status_ok:
            all_passed = False

        status_str = "PASS" if status_ok else "FAIL"
        if not keys_ok and missing_keys:
            status_str += f" (missing {len(missing_keys)} keys)"
        if not ph_ok and placeholder_issues:
            status_str += f" ({', '.join(placeholder_issues)})"

        results.append({
            "code": code,
            "name": name,
            "exists": True,
            "keys": keys_str,
            "placeholders": ph_str,
            "meta": meta_str,
            "status": status_str,
        })

    # Print markdown table
    print("\n### i18n Translation & Placeholder Sanity Check Table\n")
    print("| Lang Code | Language Name | File Exists | Keys Present | Placeholders | Metadata | Status |")
    print("|:---|:---|:---:|:---:|:---:|:---:|:---|")
    for r in results:
        exists_sym = "Yes" if r["exists"] else "No"
        print(f"| `{r['code']}` | {r['name']} | {exists_sym} | {r['keys']} | {r['placeholders']} | {r['meta']} | **{r['status']}** |")

    print("\nSummary:")
    total = len(results)
    passed = sum(1 for r in results if "PASS" in r["status"])
    print(f"Total files checked: {total}, Passed: {passed}, Failed: {total - passed}\n")

    if not all_passed:
        print("Check FAILED: Some language files have issues.")
        sys.exit(1)
    else:
        print("Check PASSED: All 13 language files are complete and intact.")
        sys.exit(0)


if __name__ == "__main__":
    check_all()
