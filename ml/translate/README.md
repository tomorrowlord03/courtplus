# Offline Indian-Language Translation Pack (IndicTrans2)

This directory contains the pipeline, configuration, and verification tools for translating the Court Plus undertrial legal assistance application into 12 Indian languages for complete offline usage.

---

## 1. Model Provenance & Licensing

- **Model:** AI4Bharat IndicTrans2 English-to-Indic Distilled 200M (`ai4bharat/indictrans2-en-indic-dist-200M` / public mirror `naklitechie/indictrans2-en-indic-dist-200M`)
- **Architecture:** Transformer Seq2Seq encoder-decoder distilled for low-resource Indian languages.
- **License:** **MIT License** (AI4Bharat / IIT Madras).
- **Target Languages (12):**
  1. Hindi (`hi`, Devanagari)
  2. Bengali (`bn`, Bengali)
  3. Tamil (`ta`, Tamil)
  4. Telugu (`te`, Telugu)
  5. Marathi (`mr`, Devanagari)
  6. Gujarati (`gu`, Gujarati)
  7. Kannada (`kn`, Kannada)
  8. Malayalam (`ml`, Malayalam)
  9. Punjabi (`pa`, Gurmukhi)
  10. Odia (`or`, Oriya)
  11. Assamese (`as`, Bengali/Assamese)
  12. Urdu (`ur`, Perso-Arabic)

---

## 2. Mandatory Legal Review Notice

> [!WARNING]
> **Legal Notice:** All translated JSON files generated in `data/i18n/<lang>.json` are machine-translated aids created by IndicTrans2 to assist undertrial prisoners, families, and jail paralegals. They **do not constitute legal advice or formal court pleadings**.
>
> In accordance with Indian legal procedure:
> 1. **English and Hindi remain the authoritative languages** for official court applications under Section 479(3) of the Bharatiya Nagarik Suraksha Sanhita (BNSS), 2023.
> 2. All regional language outputs **must be reviewed by a fluent legal aid advocate or professional before being submitted to any court or legal authority**.
> 3. Each generated translation file carries an explicit metadata block:
>    ```json
>    "_meta": {
>      "machineTranslated": true,
>      "model": "ai4bharat/indictrans2-en-indic-dist-200M",
>      "revision": "a814dab1ae6e4ee4c7d785b7e1dcb0ac8e36bcd6",
>      "reviewed": false,
>      "date": "YYYY-MM-DD"
>    }
>    ```

---

## 3. How to Rerun the Pipeline

### Prerequisites
Install the required Python dependencies in your environment:
```bash
pip install torch transformers sentencepiece indic-nlp-library sacremoses
```

### Run Translation
To re-generate all 12 pre-translated language packs in `data/i18n/<lang>.json` on CPU:
```bash
python ml/translate/translate.py
```
This loads the source strings from `data/i18n/en.json`, protects placeholders (`{days}`, `{courtName}`, `{dlsaName}`, `{dlsaPhone}`), section numbers (`Section 479(3)`, `Section 479`, `Section 12`), and `"BNSS"`, performs script transliteration via Indic NLP, and outputs formatted JSON files.

### Run Verification / Sanity Check
To verify that all 13 files (`en.json` + 12 translations) are complete, valid, and retain 100% of required placeholders:
```bash
python ml/translate/check.py
```
This will print a verification table and exit with code `0` on success.
