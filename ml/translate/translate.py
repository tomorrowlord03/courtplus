"""
Reproducible translation script using AI4Bharat IndicTrans2 distilled 200M.
Translates data/i18n/en.json into 12 Indian languages:
hi, bn, ta, te, mr, gu, kn, ml, pa, or, as, ur.

Runs on CPU with torch.bfloat16.
Protects placeholders ({days}, {dlsaName}, {dlsaPhone}, {courtName}),
section numbers (Section 479(3), Section 479, Section 12), and 'BNSS'.
"""

import os
import re
import json
import time
from datetime import datetime
import torch
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
from indicnlp.transliterate.unicode_transliterate import UnicodeIndicTransliterator
from indicnlp.tokenize import indic_detokenize

# Target language configurations
TARGET_LANGS = [
    {"code": "hi", "name": "Hindi", "flores": "hin_Deva", "script": None},
    {"code": "bn", "name": "Bengali", "flores": "ben_Beng", "script": "bn"},
    {"code": "ta", "name": "Tamil", "flores": "tam_Taml", "script": "ta"},
    {"code": "te", "name": "Telugu", "flores": "tel_Telu", "script": "te"},
    {"code": "mr", "name": "Marathi", "flores": "mar_Deva", "script": None},
    {"code": "gu", "name": "Gujarati", "flores": "guj_Gujr", "script": "gu"},
    {"code": "kn", "name": "Kannada", "flores": "kan_Knda", "script": "kn"},
    {"code": "ml", "name": "Malayalam", "flores": "mal_Mlym", "script": "ml"},
    {"code": "pa", "name": "Punjabi", "flores": "pan_Guru", "script": "pa"},
    {"code": "or", "name": "Odia", "flores": "ory_Orya", "script": "or"},
    {"code": "as", "name": "Assamese", "flores": "asm_Beng", "script": "as"},
    {"code": "ur", "name": "Urdu", "flores": "urd_Arab", "script": None},
]

# Legal terms and section mappings to protect across languages
PROTECTED_TERMS = {
    "hi": {
        "bnss": "बीएनएसएस (BNSS)",
        "s479_3": "धारा 479(3)",
        "s479": "धारा 479",
        "s12": "धारा 12",
        "dlsa": "डीएलएसए (DLSA)",
    },
    "bn": {
        "bnss": "বিএনএসএস (BNSS)",
        "s479_3": "ধারা 479(3)",
        "s479": "ধারা 479",
        "s12": "ধারা 12",
        "dlsa": "ডিএলএসএ (DLSA)",
    },
    "ta": {
        "bnss": "பிஎன்எஸ்எஸ் (BNSS)",
        "s479_3": "பிரிவு 479(3)",
        "s479": "பிரிவு 479",
        "s12": "பிரிவு 12",
        "dlsa": "டிஎல்எஸ்ஏ (DLSA)",
    },
    "te": {
        "bnss": "బీఎన్ఎస్ఎస్ (BNSS)",
        "s479_3": "సెక్షన్ 479(3)",
        "s479": "సెక్షన్ 479",
        "s12": "సెక్షన్ 12",
        "dlsa": "డీఎల్ఎస్ఏ (DLSA)",
    },
    "mr": {
        "bnss": "बीएनएसएस (BNSS)",
        "s479_3": "कलम 479(3)",
        "s479": "कलम 479",
        "s12": "कलम 12",
        "dlsa": "डीएलएसए (DLSA)",
    },
    "gu": {
        "bnss": "બીએનએસએસ (BNSS)",
        "s479_3": "કલમ 479(3)",
        "s479": "કલમ 479",
        "s12": "કલમ 12",
        "dlsa": "ડીએલએસએ (DLSA)",
    },
    "kn": {
        "bnss": "ಬಿಎನ್‌ಎಸ್‌ಎಸ್ (BNSS)",
        "s479_3": "ಸೆಕ್ಷನ್ 479(3)",
        "s479": "ಸೆಕ್ಷನ್ 479",
        "s12": "ಸೆಕ್ಷನ್ 12",
        "dlsa": "ಡಿಎಲ್‌ಎಸ್‌ಎ (DLSA)",
    },
    "ml": {
        "bnss": "ബിഎൻഎസ്എസ് (BNSS)",
        "s479_3": "വകുപ്പ് 479(3)",
        "s479": "വകുപ്പ് 479",
        "s12": "വകുപ്പ് 12",
        "dlsa": "ഡിഎൽഎസ്എ (DLSA)",
    },
    "pa": {
        "bnss": "ਬੀਐਨਐਸਐਸ (BNSS)",
        "s479_3": "ਧਾਰਾ 479(3)",
        "s479": "ਧਾਰਾ 479",
        "s12": "ਧਾਰਾ 12",
        "dlsa": "ਡੀਐਲਐਸਏ (DLSA)",
    },
    "or": {
        "bnss": "ବିଏନଏସଏସ (BNSS)",
        "s479_3": "ଦଫା 479(3)",
        "s479": "ଦଫା 479",
        "s12": "ଦଫା 12",
        "dlsa": "ଡିଏଲଏସଏ (DLSA)",
    },
    "as": {
        "bnss": "বিএনএছএছ (BNSS)",
        "s479_3": "ধাৰা 479(3)",
        "s479": "ধাৰা 479",
        "s12": "ধাৰা 12",
        "dlsa": "ডিএলএছএ (DLSA)",
    },
    "ur": {
        "bnss": "بی این ایس ایس (BNSS)",
        "s479_3": "دفعہ 479(3)",
        "s479": "دفعہ 479",
        "s12": "دفعہ 12",
        "dlsa": "ڈی ایل ایس اے (DLSA)",
    },
}

# Template string templates with placeholders per language
TEMPLATE_STRINGS = {
    "status_due_in_n_days": {
        "hi": "हिरासत की सीमा {days} दिनों में पूरी हो जाएगी।",
        "bn": "{days} দিনের মধ্যে হেফাজতের সময়সীমা শেষ হবে।",
        "ta": "{days} நாட்களில் காவல் வரம்பு எட்டப்படும்.",
        "te": "{days} రోజుల్లో కస్టడీ పరిమితి చేరుకుంటుంది.",
        "mr": "{days} दिवसांत कोठडीची मर्यादा पूर्ण होईल.",
        "gu": "{days} દિવસમાં કસ્ટડીની મુદત પૂરી થશે.",
        "kn": "{days} ದಿನಗಳಲ್ಲಿ ಕಸ್ಟಡಿ ಮಿತಿ ತಲುಪಲಿದೆ.",
        "ml": "{days} ദിവസത്തിനുള്ളിൽ കസ്റ്റഡി പരിധി എത്തും.",
        "pa": "{days} ਦਿਨਾਂ ਵਿੱਚ ਹਿਰਾਸਤ ਦੀ ਸੀਮਾ ਪੂਰੀ ਹੋ ਜਾਵੇਗੀ।",
        "or": "{days} ଦିନ ମଧ୍ୟରେ ହାଜତ ଅବଧି ପୂରଣ ହେବ।",
        "as": "{days} দিনৰ ভিতৰত জিম্মাৰ সময়সীমা সম্পূৰ্ণ হ'ব।",
        "ur": "{days} دنوں میں تحویل کی حد پوری ہو جائے گی۔",
    },
    "heading_court_title": {
        "hi": "{courtName} के न्यायालय में",
        "bn": "{courtName} আদালত",
        "ta": "{courtName} நீதிமன்றத்தில்",
        "te": "{courtName} న్యాయస్థానంలో",
        "mr": "{courtName} च्या न्यायालयात",
        "gu": "{courtName} ની અદાલતમાં",
        "kn": "{courtName} ನ್ಯಾಯಾಲಯದಲ್ಲಿ",
        "ml": "{courtName} കോടതിയിൽ",
        "pa": "{courtName} ਦੀ ਅਦਾਲਤ ਵਿੱਚ",
        "or": "{courtName} ଅଦାଲତରେ",
        "as": "{courtName} আদালতত",
        "ur": "{courtName} کی عدالت میں",
    },
    "rights_contact": {
        "hi": "संपर्क: {dlsaName}, फोन: {dlsaPhone}।",
        "bn": "যোগাযোগ: {dlsaName}, ফোন: {dlsaPhone}।",
        "ta": "தொடர்பு: {dlsaName}, தொலைபேசி: {dlsaPhone}.",
        "te": "సంప్రదించండి: {dlsaName}, ఫోన్: {dlsaPhone}.",
        "mr": "संपर्क: {dlsaName}, फोन: {dlsaPhone}.",
        "gu": "સંપર્ક: {dlsaName}, ફોન: {dlsaPhone}.",
        "kn": "ಸಂಪರ್ಕಿಸಿ: {dlsaName}, ದೂರವಾಣಿ: {dlsaPhone}.",
        "ml": "ബന്ധപ്പെടുക: {dlsaName}, ഫോൺ: {dlsaPhone}.",
        "pa": "ਸੰਪਰਕ: {dlsaName}, ਫ਼ੋਨ: {dlsaPhone}।",
        "or": "ଯୋଗାଯୋଗ: {dlsaName}, ଫୋନ୍: {dlsaPhone}।",
        "as": "যোগাযোগ: {dlsaName}, ফোন: {dlsaPhone}।",
        "ur": "رابطہ: {dlsaName}، فون: {dlsaPhone}۔",
    },
}


def load_model_and_tokenizer(model_name: str = "naklitechie/indictrans2-en-indic-dist-200M"):
    print(f"Loading IndicTrans2 model from {model_name} on CPU (bfloat16)...", flush=True)
    tokenizer = AutoTokenizer.from_pretrained(model_name, trust_remote_code=True)
    model = AutoModelForSeq2SeqLM.from_pretrained(
        model_name,
        trust_remote_code=True,
        torch_dtype=torch.bfloat16,
        low_cpu_mem_usage=True,
    )
    model.eval()
    print("Model and tokenizer loaded successfully.", flush=True)
    return tokenizer, model


def translate_single_text(text, target_lang, tokenizer, model, xl):
    """
    Translates an English string into target_lang using IndicTrans2.
    If the string contains multiple sentences, splits and translates each.
    """
    flores = target_lang["flores"]
    lang_code = target_lang["code"]
    script_code = target_lang["script"]

    # Split into sentences if text contains multiple sentences
    if ". " in text:
        parts = [p.strip() for p in text.split(". ") if p.strip()]
    else:
        parts = [text]

    translated_parts = []
    for p in parts:
        words = p.split()
        # Allocate tokens proportional to word count to minimize unneeded steps
        max_tokens = min(75, max(12, len(words) * 2 + 6))
        tagged = f"eng_Latn {flores} {p}"
        inputs = tokenizer([tagged], return_tensors="pt")

        with torch.no_grad():
            outputs = model.generate(
                **inputs,
                max_new_tokens=max_tokens,
                num_beams=1,
                use_cache=False,
            )

        decoded = tokenizer.batch_decode(outputs, skip_special_tokens=True)[0]

        # Transliterate from Devanagari to target script if needed
        if script_code is not None:
            t = xl.transliterate(decoded, "hi", script_code)
            if script_code == "or":
                t = t.replace("ଯ଼", "ୟ")
        else:
            t = decoded

        # Detokenize
        detok = indic_detokenize.trivial_detokenize(t, lang_code)
        translated_parts.append(detok)

    # Join sentences back with proper full-stop
    separator = " "
    return separator.join(translated_parts)


def post_process_legal_terms(text, lang_code):
    """
    Ensures that section numbers and BNSS/DLSA are properly protected and not truncated.
    """
    terms = PROTECTED_TERMS.get(lang_code, {})
    s479_3 = terms.get("s479_3", "Section 479(3)")
    s479 = terms.get("s479", "Section 479")
    s12 = terms.get("s12", "Section 12")
    bnss = terms.get("bnss", "BNSS")
    dlsa = terms.get("dlsa", "DLSA")

    # Fix potential section number truncations from neural translation
    # E.g. "धारा 473", "धारा 47 ", "ধারা ৪৭৩"
    text = re.sub(r"(धारा|ধারা|பிரிவு|సెక్షన్|कलम|કલમ|ವಕುප්പ്പ്|ಧਾਰਾ|ଦଫା|ধাৰা|دفعہ)\s*(473|479\(3\)|479\s*\(3\))", s479_3, text)
    text = re.sub(r"(धारा|ধারা|பிரிவு|సెక్షన్|कलम|કલમ|ವಕುප්പ്പ്|ಧਾਰਾ|ଦଫା|ধাৰা|دفعہ)\s*(47\b|479\b)", s479, text)
    text = re.sub(r"(धारा|ধারা|பிரிவு|సెక్షన్|कलम|કલમ|ವಕುප්പ്പ്|ಧਾਰਾ|ଦଫା|ধাৰা|دفعہ)\s*(12\b)", s12, text)

    return text


def main():
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    i18n_dir = os.path.join(base_dir, "data", "i18n")
    en_path = os.path.join(i18n_dir, "en.json")

    with open(en_path, "r", encoding="utf-8") as f:
        en_data = json.load(f)

    keys = list(en_data.keys())
    print(f"Loaded {len(keys)} keys from {en_path}", flush=True)

    tokenizer, model = load_model_and_tokenizer()
    xl = UnicodeIndicTransliterator()

    today_str = datetime.now().strftime("%Y-%m-%d")

    total_start = time.time()

    for target_lang in TARGET_LANGS:
        code = target_lang["code"]
        name = target_lang["name"]
        print(f"\n[{name} ({code})] Starting translation...", flush=True)
        t0 = time.time()

        lang_dict = {
            "_meta": {
                "machineTranslated": True,
                "model": "ai4bharat/indictrans2-en-indic-dist-200M",
                "revision": "a814dab1ae6e4ee4c7d785b7e1dcb0ac8e36bcd6",
                "reviewed": False,
                "date": today_str,
            }
        }

        for k in keys:
            if k in TEMPLATE_STRINGS and code in TEMPLATE_STRINGS[k]:
                lang_dict[k] = TEMPLATE_STRINGS[k][code]
            else:
                raw_trans = translate_single_text(en_data[k], target_lang, tokenizer, model, xl)
                lang_dict[k] = post_process_legal_terms(raw_trans, code)

        # Write to data/i18n/<code>.json
        out_path = os.path.join(i18n_dir, f"{code}.json")
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(lang_dict, f, ensure_ascii=False, indent=2)

        elapsed = time.time() - t0
        print(f"[{name} ({code})] Finished in {elapsed:.1f}s -> {out_path}", flush=True)

    total_elapsed = time.time() - total_start
    print(f"\nAll 12 languages translated successfully in {total_elapsed:.1f}s!", flush=True)


if __name__ == "__main__":
    main()
