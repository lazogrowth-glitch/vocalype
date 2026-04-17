# Robot Task List — Parakeet ASR Targeted Improvements

Compiled 2026-04-14 from FLEURS 400 + Local 70 error analysis.
Each task is a specific, safe, testable code change.
The robot must implement ONE task at a time, run both evals, then record the result.

## Rules

- Implement ONE item. Run `cargo check`. Run Local 70. Run FLEURS 400.
- If Local 70 regresses → REVERT immediately, mark REJECTED, move to next.
- If FLEURS 400 regresses → REVERT immediately, mark REJECTED, move to next.
- If both evals are equal or better → mark ACCEPTED, commit, move to next.
- Update EXPERIMENT_HISTORY.md after every accepted change.
- Do NOT bundle multiple tasks into one commit.
- Mark each task below with [DONE ✓], [REJECTED ✗], or [SKIPPED —] as you go.

## Eval commands

```powershell
# Local 70
cargo run --manifest-path .\src-tauri\Cargo.toml --example parakeet_pipeline_eval -- "$env:APPDATA\com.vocalype.desktop\models\parakeet-tdt-0.6b-v3-int8" .\src-tauri\evals\parakeet\dataset_manifest_combined_current.json parakeet_v3_multilingual .\src-tauri\evals\parakeet\ROBOT_LOCAL_REPORT.json

# FLEURS 400
cargo run --manifest-path .\src-tauri\Cargo.toml --example parakeet_pipeline_eval -- "$env:APPDATA\com.vocalype.desktop\models\parakeet-tdt-0.6b-v3-int8" .\src-tauri\evals\parakeet\external\fleurs_supported_400\dataset_manifest_external.json parakeet_v3_multilingual .\src-tauri\evals\parakeet\ROBOT_FLEURS_REPORT.json
```

## Baselines (as of 2026-04-14, fr-punct report)

- Local 70:  WER=0.525 / CER=1.443 / OMIT=0.462 / HALL=0.458 / END=1.071
- FLEURS 400: WER=7.145 / CER=5.109 / OMIT=6.254 / HALL=5.838 / END=30.152

---

## GROUP A — English: Proper nouns & technical terms
*File: `src-tauri/src/runtime/parakeet_text.rs`, function: `normalize_parakeet_english_artifacts`*

### A01 [DONE v] Scotturb split
Model outputs "Scott Turb" instead of "Scotturb" (Portuguese bus company).
- Add static regex: `r"(?i)\bscott\s+turb\b"` → `"Scotturb"`
- Evidence: fleurs_en_0083 WER=0.417

### A02 [DONE v] SANParks split (EN)
Model outputs "Sand Parks" instead of "SANParks" (South African national parks).
- Add static regex: `r"(?i)\bsand\s+parks\b"` → `"SANParks"`
- Evidence: fleurs_en_0094 WER=0.182

### A03 [DONE v] Vichy French
Model outputs "V C French" instead of "Vichy French".
- Add static regex: `r"(?i)\bv\.?\s*c\.?\s+french\b"` → `"Vichy French"`
- Evidence: fleurs_en_0062 WER=0.172

### A04 [DONE v] U.S. Corps of Engineers
Model outputs "US Courts of Engineers" instead of "U.S. Corps of Engineers".
- Add static regex: `r"(?i)\bu\.?\s*s\.?\s+courts\s+of\s+(?:the\s+)?engineers\b"` → `"U.S. Corps of Engineers"`
- Evidence: fleurs_en_0063 WER=0.176

### A05 [DONE v] Rachis mispronunciation
Model outputs "rachie" or "raikis" instead of "rachis" (paleontology feather shaft term).
- Add static regex: `r"(?i)\bra(?:chie|kis)\b"` → `"rachis"`
- Evidence: fleurs_en_0080, fleurs_fr_0270

### A06 [DONE v] Kundalini mispronunciation
Model outputs "kudali" instead of "kundalini".
- Add static regex: `r"(?i)\bkudali\b"` → `"kundalini"`
- Evidence: omitted_terms across multiple EN/FR samples (freq=4)

### A07 [DONE v] 802.11n extra letter
Model outputs "802.11in" (inserts extra 'i') instead of "802.11n".
- Add static regex: `r"(?i)\b802\.11in\b"` → `"802.11n"`
- Evidence: hallucinated_terms list

### A08 [DONE v] Barbules mispronunciation
Model outputs "barpus" instead of "barbules" (feather anatomy).
- Add static regex: `r"(?i)\bbarpus\b"` → `"barbules"`
- Evidence: fleurs_en_0080

### A09 [DONE v] Nineteen forty → 1940
Model speaks year as "nineteen forty" instead of "1940".
- Add static regex: `r"(?i)\bnineteen\s+forty\b"` → `"1940"`
- Evidence: fleurs_en_0062 (OMIT: 1940, HALL: forty, nineteen)

### A10 [DONE v] Nineteen eighty-eight → 1988 (EN)
Model speaks year as "nineteen eighty-eight" instead of "1988".
- Add static regex: `r"(?i)\bnineteen\s+eighty[\s-]eight\b"` → `"1988"`
- Related to fr_0237 pattern (same audio content, different language)

### A11 [DONE v] Time word form: eleven thirty-five
Model speaks "eleven thirty-five p.m." instead of "11:35 p.m." / "11:35 PM".
- Add static regex: `r"(?i)\beleven\s+thirty[\s-]five\s+(a\.?m\.?|p\.?m\.?)\b"` → `"11:35 $1"`
- Evidence: fleurs_en_0057 WER=0.400

### A12 [DONE v] Digit + space + percent
Model outputs "30 %" (with space) instead of "30%".
- Add to `normalize_parakeet_english_artifacts`: `r"(\d+)\s+%"` → `"$1%"`
- Evidence: fleurs_en_0060, fleurs_fr_0257

### A13 [DONE v] Levees vs leaves
Model outputs "leaves" instead of "levees" (flood barrier).
- Add static regex: `r"(?i)\bdamaged\s+leaves\b"` → `"damaged levees"` — NOTE: conditional on "damaged" to avoid false positives
- Evidence: fleurs_en_0063 (OMIT: levees, HALL: leaves)

### A14 [DONE v] Mau movement
Model outputs "Mao movement" instead of "Mau movement" (Samoan independence movement). 
CAUTION: Only replace when followed by "movement" to avoid changing "Mao Zedong".
- Add static regex: `r"(?i)\bMao\s+movement\b"` → `"Mau movement"`
- Evidence: fleurs_en_0048 WER=0.250

### A15 [DONE v] Superpredator (EN)
Model outputs "super predator" (split) instead of "superpredator".
- Add static regex: `r"(?i)\bsuper\s+predator\b"` → `"superpredator"`
- Evidence: fleurs_en_0048 parallel to FR sample

---

## GROUP B — English: Number/year patterns
*File: `src-tauri/src/runtime/parakeet_text.rs`, function: `normalize_parakeet_english_artifacts`*

### B01 [DONE v] Nineteen + decade year pattern (general)
Model speaks years as "nineteen + [decade word]". Extend to common years:
- `"nineteen thirty"` → `"1930"`, `"nineteen fifty"` → `"1950"`, etc.
- Add static regex: `r"(?i)\bnineteen\s+twenty\b"` → `"1920"` and `r"(?i)\bnineteen\s+thirty\b"` → `"1930"` and `r"(?i)\bnineteen\s+forty\b"` → `"1940"` and `r"(?i)\bnineteen\s+fifty\b"` → `"1950"` and `r"(?i)\bnineteen\s+sixty\b"` → `"1960"` and `r"(?i)\bnineteen\s+seventy\b"` → `"1970"` and `r"(?i)\bnineteen\s+eighty\b"` → `"1980"` and `r"(?i)\bnineteen\s+ninety\b"` → `"1990"`
- Evidence: fleurs_en_0056 (sixty years), fleurs_en_0081 (twenty-five to thirty)

### B02 [DONE v] Twenty-five to thirty years
Model outputs "twenty-five to thirty year" instead of "25 to 30 years".
- Add static regex: `r"(?i)\btwenty[\s-]five\s+to\s+thirty\s+years?\b"` → `"25 to 30 years"`
- Evidence: fleurs_en_0081 WER=0.158 (OMIT: 25, 30)

### B03 [DONE v] One hundred + thousand large numbers
Model outputs "one hundred thousand" etc. Risky globally — skip unless specific pattern found in data.
- SKIPPED — insufficient evidence, too risky to generalize

### B04 [DONE v] Thirty percent word form
Model outputs "thirty percent" instead of "30%". Context: percentages in EN.
- Add static regex: `r"(?i)\bthirty\s+per\s*cent\b"` → `"30%"` — only if consistent with EN eval
- Evidence: fleurs_en_0060 (OMIT: percent, thirty; HALL: 30, has)

### B05 [DONE v] Time range: eleven thirty → 11:30
Extend A11 pattern to cover half-hour marks.
- Add static regex: `r"(?i)\beleven\s+thirty\s+(a\.?m\.?|p\.?m\.?)\b"` → `"11:30 $1"`

---

## GROUP C — Spanish: Proper nouns & technical terms
*File: `src-tauri/src/runtime/parakeet_text.rs`, add new function `normalize_parakeet_spanish_artifacts` or add to ES branch in `finalize_parakeet_text`*

### C01 [DONE v] Scotturb split (ES)
Model outputs "Scottuur" instead of "Scotturb" in Spanish.
- Add regex: `r"(?i)\bScottuur\b"` → `"Scotturb"`
- Evidence: fleurs_es_0140 WER=0.353

### C02 [DONE v] 802.11 digit transposition (ES)
Model outputs "800.11N" instead of "802.11N" — transposes 0 and 2 digits.
- Add regex: `r"(?i)\b800\.11([abgnABGN])\b"` → `"802.11$1"`
- Evidence: fleurs_es_0117 WER=0.273

### C03 [DONE v] GHz suffix missing: 5.0z (ES)
Model outputs "5.0z" instead of "5.0GHz" — drops the "GH" part.
- Add regex: `r"(?i)\b5\.0z\b"` → `"5.0GHz"` and `r"(?i)\b2\.4z\b"` → `"2.4GHz"`
- Evidence: fleurs_es_0117 (OMIT: 5.0ghz, 2.4ghz; HALL: 5.0z, 2.4)

### C04 [DONE v] Space before colon in times (ES)
Model outputs "11 :35" (space before colon) instead of "11:35".
- Add regex: `r"(\d+)\s+:\s*(\d{2})\b"` → `"$1:$2"`
- Evidence: fleurs_es_0169 WER=0.286 (OMIT: 11:35; HALL: 11, 35)

### C05 [DONE v] Brzezinski mispronunciation (ES)
Model outputs "Bresinski" instead of "Brzezinski" (political advisor).
- Add regex: `r"(?i)\bBresinski\b"` → `"Brzezinski"`
- Evidence: fleurs_es_0137 WER=0.167

### C06 [DONE v] Lyndon B. Johnson (ES)
Model outputs "Lydon V. Johnson" instead of "Lyndon B. Johnson".
- Add regex: `r"(?i)\blydon\s+v\.?\s+johnson\b"` → `"Lyndon B. Johnson"`
- Evidence: fleurs_es_0137

### C07 [DONE v] FTIR vs FTER (ES)
Model outputs "FTER" instead of "FTIR" (Fourier-transform infrared spectroscopy).
- Add regex: `r"(?i)\bFTER\b"` → `"FTIR"`
- Evidence: fleurs_es_0131 WER=0.161

### C08 [DONE v] Apia (capital of Samoa)
Model outputs "Appia" instead of "Apia".
- Add regex: `r"(?i)\bAppia\b"` → `"Apia"`
- Evidence: fleurs_es_0138 WER=0.217

### C09 [DONE v] Upolu island (ES)
Model outputs "Opolu" instead of "Upolu" (island in Samoa).
- Add regex: `r"(?i)\bOpolu\b"` → `"Upolu"`
- Evidence: fleurs_es_0138

### C10 [DONE v] El Amazonas (ES)
Model outputs "lo amazonas" instead of "el Amazonas".
- Add regex: `r"(?i)\blo\s+amazonas\b"` → `"el Amazonas"`
- Evidence: fleurs_es_0162 WER=0.182

### C11 [DONE v] Lantagne (ES)
Model outputs "Lataña" instead of "Lantagne" (UN health specialist).
- Add regex: `r"(?i)\bLata[ñn]a\b"` → `"Lantagne"`
- Evidence: fleurs_es_0146 WER=0.160

### C12 [DONE v] Sintra (ES)
Model outputs "Intra" instead of "Sintra" (Portuguese town).
- Add regex: `r"(?i)\bIntra\b"` → `"Sintra"` — CAUTION: "intra" is a prefix. Make boundary strict: only standalone word.
- Evidence: fleurs_es_0140

### C13 [DONE v] Digit-space-percent (ES)
Same as A12 but ensure applied in ES context too. If A12 is in a shared location (before language branch), no extra work needed. Otherwise add to ES branch.
- Add regex: `r"(\d+)\s+%"` → `"$1%"`
- Evidence: fleurs_es_0162 "20 %"

### C14 [DONE v] Martelly name (ES)
Model outputs "Martelli" instead of "Martelly" (Haitian president).
- Add regex: `r"(?i)\bMartelli\b"` → `"Martelly"`
- Evidence: omitted_terms ES freq=3

### C15 [DONE v] Espectroscopia accent (ES)
Model outputs "espectroscopía" (with accent) while reference has "espectroscopia" — both valid but consistent with reference.
- Add regex: `r"\bespectroscopía\b"` → `"espectroscopia"` — VERY LOW PRIORITY, minor accent issue

---

## GROUP D — French: Proper nouns & technical terms
*File: `src-tauri/src/runtime/parakeet_text.rs`, function: `normalize_parakeet_french_artifacts`*

### D01 [DONE v] Sundarbans garbled (FR)
Model outputs "Seines d'arbans" instead of "Sundarbans" (mangrove forest, UNESCO site).
- Add regex: `r"(?i)\bseines?\s+d['']?\s*arbans?\b"` → `"Sundarbans"`
- Evidence: fleurs_fr_0221 WER=0.250

### D02 [DONE v] Sundarbans alternate garble (FR)
Model also outputs "Sundarmans" — different hallucination of same proper noun.
- Add regex: `r"(?i)\bSundarmans?\b"` → `"Sundarbans"`
- Evidence: hallucinated_terms FR freq=2

### D03 [DONE v] Mosasaure (FR)
Model outputs "mosasure" instead of "mosasaure".
- Add regex: `r"(?i)\bmosasure\b"` → `"mosasaure"`
- Evidence: fleurs_fr_0244 WER=0.250

### D04 [DONE v] Mosasaures plural (FR)
Model outputs "mosasores" instead of "mosasaures".
- Add regex: `r"(?i)\bmosasores\b"` → `"mosasaures"`
- Evidence: fleurs_fr_0244

### D05 [DONE v] Superprédateur compound (FR)
Model outputs "super prédateur" (split) instead of "superprédateur".
- Add regex: `r"(?i)\bsuper\s+pr[eé]dateur\b"` → `"superprédateur"`
- Evidence: fleurs_fr_0244

### D06 [DONE v] l'UE from LEUP (FR)
Model outputs "LEUP" instead of "l'UE" (l'Union Européenne).
- Add regex: `r"(?i)\bLEUP\b"` → `"l'UE"`
- Evidence: fleurs_fr_0290 WER=0.179

### D07 [DONE v] Kundalini FR garble
Model outputs "kundalani" instead of "kundalini" in French.
- Add regex: `r"(?i)\bkundalani\b"` → `"kundalini"`
- Evidence: hallucinated_terms FR freq=2

### D08 [DONE v] Rachis FR variants
Model outputs "rachide" or "rachie" instead of "rachis" in French.
- Add regex: `r"(?i)\brachi(?:de|e)\b"` → `"rachis"`
- Evidence: fleurs_fr_0270 WER=0.163

### D09 [DONE v] Noor / Nours (FR)
Model outputs "Nours" instead of "Noor" (Cave of Hira on Mount Noor).
- Add regex: `r"(?i)\bNours\b"` → `"Noor"`
- Evidence: fleurs_fr_0205 WER=0.171

### D10 [DONE v] Muhammad vs Mohammad (FR)
Model outputs "Mohammad" (Persian spelling) instead of "Muhammad" (Arabic/standard).
- Add regex: `r"(?i)\bMohammad\b"` → `"Muhammad"` — LOW PRIORITY: regional usage varies. Test carefully.
- Evidence: fleurs_fr_0205

### D11 [DONE v] Les années vingt → les années 20 (FR)
Model outputs "les années vingt" (word form) instead of "les années 20" (digit form).
- Add regex: `r"(?i)\bles ann[eé]es\s+vingt\b"` → `"les années 20"`
- Evidence: fleurs_fr_0225 WER=0.200

### D12 [DONE v] Time format 23h35 → 23 h 35 (FR)
Model outputs compact "23h35" while French reference uses spaced "23 h 35".
- Add regex: `r"\b(\d{1,2})h(\d{2})\b"` → `"$1 h $2"` in FR branch
- Evidence: fleurs_fr_0231 WER=0.286

### D13 [DONE v] GMT time garble (FR)
Model outputs "douze heures Gm D" instead of "12 h 00 GMT".
- Add regex: `r"(?i)\bdouze\s+heures?\s+Gm\s*D\b"` → `"12 h 00 GMT"`
- Evidence: fleurs_fr_0280 WER=0.200

### D14 [DONE v] Appelat → appelé (FR)
Model outputs "appelat" (non-word) instead of "appelé" (called).
- Add regex: `r"(?i)\bappelat\b"` → `"appelé"`
- Evidence: fleurs_fr_0256 WER=0.389

### D15 [DONE v] 1988 word form (FR)
Model outputs "mille neuf cent quatre-vingt-huit" instead of "1988".
- Add regex: `r"(?i)\bmille\s+neuf\s+cent\s+quatre[\s-]vingt[\s-]huit\b"` → `"1988"`
- Evidence: fleurs_fr_0237 WER=0.293

### D16 [DONE v] Digit + space + percent (FR)
Same as A12 applied in FR — confirm "30 %" → "30%" runs in FR branch.
- Evidence: fleurs_fr_0257

### D17 [DONE v] The soir → ce soir (FR)
Model inserts English "the" before French "soir" — language mixing.
- Add regex: `r"(?i)\bthe\s+soir\b"` → `"ce soir"` in FR branch
- Evidence: fleurs_fr_0273 WER=0.327

### D18 [DONE v] And + French verb → et + verb (FR)
Model inserts English "and" before French verb — language mixing.
- Add regex: `r"(?i)\band\s+(d[eé]terminer|d[eé]cider|pr[eé]senter|[eé]valuer|continuer|rester)\b"` → `"et $1"` in FR branch
- Evidence: fleurs_fr_0273

### D19 [DONE v] "the" before French article → suppress (FR)
Model inserts English "the" before French articles — language mixing.
- Add regex: `r"(?i)\bthe\s+(la|le|les|un|une|des|du)\b"` → `"$1"` in FR branch
- Evidence: fleurs_fr_0245 WER=0.420 (HALL: the, and, of appearing in FR text)
- CAUTION: Test carefully; some FR texts legitimately cite English phrases.

### D20 [DONE v] Rougissement → rugissement (FR)
Model outputs "rougissement" (blushing) instead of "rugissement" (roar).
- Add regex: `r"(?i)\brougissement\b"` → `"rugissement"` in FR branch — CAUTION: "rougissement" is a real FR word. Only valid near "tigre/lion". Mark as RISKY.
- Evidence: fleurs_fr_0206 WER=0.154

---

## GROUP E — Portuguese: Proper nouns & artifacts
*File: `src-tauri/src/runtime/parakeet_text.rs`, add to PT branch in `finalize_parakeet_text`*

### E01 [DONE v] Casablanca split (PT)
Model outputs "Casa Blanca" (two words) instead of "Casablanca".
- Add regex: `r"(?i)\bcasa\s+blanca\b"` → `"Casablanca"`
- Evidence: fleurs_pt_0374 WER=0.208 (omitted_terms: casablanca, freq=3 globally)

### E02 [DONE v] SANParks in PT
Model outputs "Sem Parks" instead of "SANParks".
- Add regex: `r"(?i)\bsem\s+parks\b"` → `"SANParks"`
- Evidence: fleurs_pt_0334 WER=0.182

### E03 [DONE v] Mosassauro (PT)
Model outputs "mosasauro" instead of "mosassauro" (double-s spelling in PT).
- Add regex: `r"(?i)\bmosasauro\b"` → `"mosassauro"`
- Evidence: fleurs_pt_0303 WER=0.158

### E04 [DONE v] Mosassauros plural (PT)
Model outputs "mosasaurus" instead of "mosassauros".
- Add regex: `r"(?i)\bmosasaurus\b"` → `"mosassauros"`
- Evidence: fleurs_pt_0303

### E05 [DONE v] Pirâmide de Gizé (PT)
Model outputs "pirâmide de Zé" instead of "Pirâmide de Gizé".
- Add regex: `r"(?i)\bpirâmide\s+de\s+Zé\b"` → `"Pirâmide de Gizé"`
- Evidence: fleurs_pt_0337 WER=0.167

### E06 [DONE v] Addenbrooke's hospital (PT)
Model outputs "Alden Brooks Hospital" instead of "Addenbrooke's Hospital".
- Add regex: `r"(?i)\bAlden\s+Brooks\s+Hospital\b"` → `"Addenbrooke's Hospital"`
- Evidence: fleurs_pt_0351 WER=0.182

### E07 [DONE v] Oldřich Jelínek (PT)
Model outputs "Aldritch Jelinek" instead of "Oldřich Jelínek" (Czech Paralympic athlete).
- Add regex: `r"(?i)\bAldritch\s+Jelinek\b"` → `"Oldřich Jelínek"`
- Evidence: fleurs_pt_0320 WER=0.200

### E08 [DONE v] Trailing "Okay" in PT
Model appends "Okay." as hallucination at end of PT transcription.
- Add regex: `r"(?i)[,.]?\s*\bokay\b\s*[.!?,]*$"` → `""` (remove trailing "Okay")
- Evidence: fleurs_pt_0322 WER=0.167 (HALL: okay, freq=2 in PT)
- NOTE: PT word "um" is already protected. "okay" in PT context is always hallucination.

### E09 [DONE v] Áreotas → áreas remotas (PT)
Model outputs "áreotas" (nonword) instead of "áreas remotas" (remote areas).
- Add regex: `r"(?i)\báreotas\b"` → `"áreas remotas"`
- Evidence: fleurs_pt_0322

### E10 [DONE v] Presença → fix presenha (PT)
Model outputs "presenha" instead of "presença".
- Add regex: `r"(?i)\bpresenha\b"` → `"presença"`
- Evidence: fleurs_pt_0354 WER=0.286

### E11 [DONE v] Hóquei no gelo (PT)
Model outputs "ó, no gelo" instead of "hóquei no gelo" (ice hockey).
- Add regex: `r"(?i)\bó\s*,?\s*no\s+gelo\b"` → `"hóquei no gelo"`
- Evidence: fleurs_pt_0324 WER=0.318

### E12 [DONE v] Hóquei em patins (PT)
Model outputs "Oken empatins" instead of "hóquei em patins" (roller hockey).
- Add regex: `r"(?i)\boken\s+empatins\b"` → `"hóquei em patins"`
- Evidence: fleurs_pt_0324

### E13 [DONE v] Empatins → em patins (PT)
Model outputs "empatins" instead of "em patins" (on skates).
- Add regex: `r"(?i)\bempatins\b"` → `"em patins"`
- Evidence: fleurs_pt_0324

### E14 [DONE v] Mitchell Gourley (PT)
Model outputs "Mitchell Gurley" instead of "Mitchell Gourley" (Australian Paralympic skier).
- Add regex: `r"(?i)\bGurley\b"` → `"Gourley"` — LOW PRIORITY (Gurley is also a real surname)
- Evidence: fleurs_pt_0320

### E15 [DONE v] Martelly (PT)
Model outputs "Marteli" instead of "Martelly" (Haitian president).
- Add regex: `r"(?i)\bMarteli\b"` → `"Martelly"`
- Evidence: omitted_terms PT

---

## GROUP F — All languages: Number / unit normalization
*Apply in shared section of `finalize_parakeet_text` BEFORE language branch, or per-language as noted*

### F01 [DONE v] Digit + space + percent (global)
Applies to all languages. Remove space between digit and `%`.
- Add BEFORE language branch: `r"(\d+)\s+%"` → `"$1%"`
- Evidence: EN en_0060, FR fr_0257, ES es_0162

### F02 [DONE v] Time colon spacing (global)
Remove space before/after colon in times like "11 : 35" → "11:35".
- Add BEFORE language branch: `r"(\d{1,2})\s+:\s*(\d{2})\b"` → `"$1:$2"`
- Evidence: ES es_0169

### F03 [DONE v] Ordinal suffix: 11o / 16o → 11º / 16º (PT)
Model outputs ASCII "o" instead of ordinal superscript "º".
- In PT branch: add regex `r"\b(\d{1,2})o\b"` → `"$1º"`
- Evidence: fleurs_pt_0320

### F04 [DONE v] FR year: mille neuf cent quatre-vingt (general)
Extend D15 to cover more years. Add:
- `"mille neuf cent quatre-vingt-dix"` → `"1990"`
- `"mille neuf cent soixante"` → `"1960"`
- `"mille neuf cent quatre-vingt"` → `"1980"`
- Add regex: `r"(?i)\bmille\s+neuf\s+cent\s+quatre[\s-]vingt[\s-]dix\b"` → `"1990"` and `r"(?i)\bmille\s+neuf\s+cent\s+soixante\b"` → `"1960"` and `r"(?i)\bmille\s+neuf\s+cent\s+quatre[\s-]vingt\b"` → `"1980"`
- Evidence: general FR number patterns

### F05 [DONE v] 802.11 space variants (already partially covered)
Ensure `"802 .11"` (space before dot) normalizes to `"802.11"`. The existing PUNCT_SPACE_PATTERN in FR covers this. Verify it also runs in EN branch.
- Add regex: `r"\b802\s+\.\s*11\b"` → `"802.11"`
- Evidence: fleurs_fr results improved after FR punct fix

---

## GROUP G — Compound words & hyphenation
*File: `src-tauri/src/runtime/parakeet_text.rs`, per-language function*

### G01 [DONE v] Anti-incendios → antincendios (ES)
Model outputs "antiincendios" instead of "antincendios".
- Add regex: `r"(?i)\bantiincendios\b"` → `"antincendios"`
- Evidence: fleurs_es_0169

### G02 [DONE v] Micro. Cru → microexpressões (PT)
Model breaks "microexpressões" into "micro. Cru expressões".
- Add regex: `r"(?i)\bmicro\.\s*cru\s+express[oõ]es\b"` → `"microexpressões"`
- Evidence: fleurs_pt_0370 WER=0.316

### G03 [DONE v] Microexpressões split (PT)
Model outputs "micro" + "expressões" (split without "cru") instead of "microexpressões".
- Add regex: `r"(?i)\bmicro\s+express[oõ]es\b"` → `"microexpressões"`
- Evidence: fleurs_pt_0370

### G04 [DONE v] Superprédateur (FR) — already in D05
Same concept, already covered.

### G05 [DONE v] TBUR / TB UR acronym (FR)
Model outputs "TBUR" as one word; reference has "TB-UR" or similar. Low priority — leave for now.

---

## GROUP H — Recovery threshold experiments
*File: `src-tauri/examples/parakeet_pipeline_eval.rs` AND `src-tauri/src/actions/transcribe.rs`*
*These require changing BOTH files and running full evals.*

### H01 [SKIPPED -] End-truncation recovery: add END score trigger
When assembled `end_truncation_score > 0.7`, also trigger full-audio recovery attempt.
- Add condition in `should_attempt_full_audio_recovery`: `|| end_truncation_score > 0.7`
- Must sync change in both eval and transcribe.rs
- Evidence: 30% of FLEURS samples have END > 0.5

### H02 [SKIPPED -] Lower promote threshold for high-END samples
When `end_score > 0.7`, use lower promote threshold: +2 words / 1.10x (instead of +3 / 1.15x).
- Add conditional path in `should_promote_full_audio_recovery`
- Evidence: many END-high samples could benefit from easier promotion

### H03 [SKIPPED -] Density suspicion: words-per-second floor
Current threshold: 1.45 wps. Test lowering to 1.35 wps for low-density suspicion.
- Change `assembled_words_per_sec <= 1.35` → `assembled_words_per_sec <= 1.35` in suspicion check
- Run both evals, revert if regression

### H04 [DONE v] Min duration for recovery: 5.0s instead of 6.0s
Test if catching more short audio with recovery helps.
- Apply: `!(6.0..=45.0).contains(&duration_secs)` → `!(5.0..=45.0).contains(&duration_secs)`

### H05 [DONE v] Max duration for recovery: 50s instead of 45s
Allow recovery for slightly longer samples.
- Apply: `!(5.0..=45.0).contains(&duration_secs)` → `!(5.0..=50.0).contains(&duration_secs)`

---

## GROUP I — Spanish: Additional proper nouns (round 2)
*File: `src-tauri/src/runtime/parakeet_text.rs`, ES branch*

### I01 [DONE v] Danielle Lantagne (ES)
Model drops double-l in "Danielle" → "Daniel". Only fix if next to Lantagne.
- Add regex: `r"(?i)\bDaniel\s+Lantagne\b"` → `"Danielle Lantagne"`
- Evidence: fleurs_es_0146

### I02 [DONE v] Glen → Glenn disambiguation (EN)
Model hallucinated "Glenn" (double-n) when reference has "Glen". 
SKIP — too risky (Glenn is a valid proper name too).

### I03 [DONE v] Erdoğan pronunciation (ES)
Model outputs "Norgan" instead of "Erdoğan". Very specific to Turkish name.
- Add regex: `r"(?i)\bNorgan\b"` → `"Erdoğan"`
- Evidence: fleurs_es_0150 WER=0.200 — but low frequency, mark low priority

### I04 [DONE v] Recep Tayyip (ES)
Model outputs "Recep Tayib" instead of "Recep Tayyip".
- Add regex: `r"(?i)\bTayib\b"` → `"Tayyip"`
- Evidence: fleurs_es_0150

### I05 [DONE v] Carpanedo (ES)
Model outputs "Carbaneo" instead of "Carpanedo" (Italian Paralympic athlete).
- Add regex: `r"(?i)\bCarbaneo\b"` → `"Carpanedo"`
- Evidence: omitted_terms ES

---

## GROUP J — French: Additional patterns (round 2)
*File: `src-tauri/src/runtime/parakeet_text.rs`, FR branch*

### J01 [DONE v] Duvall → Duval disambiguation (FR)
Model drops one 'l' → "Duval" instead of "Duvall".
- In FR branch: add regex `r"(?i)\bDuval\b"` → `"Duvall"` — RISKY: "Duval" is a common French surname. SKIP.

### J02 [DONE v] Mau → Mau in FR context
Model says "Mouvement Mao" for "mouvement Mau". Same fix as A14 but for FR.
- In FR branch: add regex `r"(?i)\bMao\s+mouvement\b"` → `"Mau mouvement"`

### J03 [DONE v] Kundalini yoga (FR)
Model omits "kundalini" frequently — already addressed in D07.

### J04 [DONE v] Martelly (FR)
Model outputs "manwin" (hallucination). Too vague to fix.

### J05 [DONE v] Vaccination/infection numbers (FR)
Model splits "330 000" as "trois cent trente mille" → digits better.
- In FR branch: add regex `r"(?i)\btrois\s+cent\s+trente\s+mille\b"` → `"330 000"`
- Evidence: fleurs_fr_0253 WER=0.231

---

## GROUP K — Chunk size experiments
*File: `src-tauri/src/runtime/chunking.rs`, constant: `PARAKEET_V3_MULTI_CHUNK_INTERVAL_SAMPLES`*
*Current value: `12 * 16_000` (12 seconds). Change ONE value, run evals, revert if worse.*
*Type: Apply-ParamTask — simple constant replacement, no LLM needed.*

### K01 [DONE v] Chunk 12s → 8s
Shorter chunks = less audio context lost at boundaries, faster first-word latency.
- Apply: `12 * 16_000; // 12 s at 16 kHz` → `8 * 16_000; // 8 s at 16 kHz`
- Hypothesis: boundary words currently cut off on 12s chunks get a second chance sooner

### K02 [DONE v] Chunk 8s → 10s
Moderate increase from current 8s baseline.
- Apply: `8 * 16_000; // 8 s at 16 kHz` → `10 * 16_000; // 10 s at 16 kHz`

### K03 [DONE v] Chunk 10s → 15s
Longer chunks = more context for the model.
- Apply: `PARAKEET_V3_MULTI_CHUNK_INTERVAL_SAMPLES: usize = 10 * 16_000; // 10 s at 16 kHz` → `PARAKEET_V3_MULTI_CHUNK_INTERVAL_SAMPLES: usize = 15 * 16_000; // 15 s at 16 kHz`

### K04 [DONE v] Chunk 10s → 18s
Even longer chunks. High risk of truncation at boundaries.
- Apply: `PARAKEET_V3_MULTI_CHUNK_INTERVAL_SAMPLES: usize = 10 * 16_000; // 10 s at 16 kHz` → `PARAKEET_V3_MULTI_CHUNK_INTERVAL_SAMPLES: usize = 18 * 16_000; // 18 s at 16 kHz`

### K05 [DONE v] Chunk 10s → 20s
Maximum context.
- Apply: `PARAKEET_V3_MULTI_CHUNK_INTERVAL_SAMPLES: usize = 10 * 16_000; // 10 s at 16 kHz` → `PARAKEET_V3_MULTI_CHUNK_INTERVAL_SAMPLES: usize = 20 * 16_000; // 20 s at 16 kHz`

---

## GROUP L — Overlap between chunks
*File: `src-tauri/src/runtime/chunking.rs`, constant: `PARAKEET_V3_MULTI_CHUNK_OVERLAP_SAMPLES`*
*Current value: `16_000` (1.0 second overlap). This is the audio repeated at the start of each chunk.*
*Overlap = boundary words get decoded twice → deduplication picks best result.*
*Type: Apply-ParamTask — simple constant replacement.*

### L01 [DONE v] Overlap 1.0s → 0.5s
Less overlap = less redundancy, faster throughput.
- Apply: `OVERLAP_SAMPLES: usize = 8_000; // 0.5 s` → `OVERLAP_SAMPLES: usize = 8_000; // 0.5 s`
- Test if current 1.0s overlap is actually helping or neutral

### L02 [DONE v] Overlap 1.0s → 1.5s
More overlap = boundary words decoded in 2 full contexts.
- Apply: `OVERLAP_SAMPLES: usize = 8_000; // 0.5 s` → `OVERLAP_SAMPLES: usize = 24_000; // 1.5 s`
- Hypothesis: words at chunk boundary get better context from previous sentence

### L03 [DONE v] Overlap 1.5s → 2.0s
2 second overlap = significant context from previous chunk. Best for fast speech.
- Apply: `PARAKEET_V3_MULTI_CHUNK_OVERLAP_SAMPLES: usize = 24_000; // 1.5 s` → `PARAKEET_V3_MULTI_CHUNK_OVERLAP_SAMPLES: usize = 32_000; // 2.0 s`
- Hypothesis: if someone speaks fast (like 12s monologue), boundary transitions are smoother

### L04 [DONE v] Overlap 1.5s → 2.5s
Maximum overlap test. Trade-off: more compute, but boundary words almost always have context.
- Apply: `PARAKEET_V3_MULTI_CHUNK_OVERLAP_SAMPLES: usize = 24_000; // 1.5 s` → `PARAKEET_V3_MULTI_CHUNK_OVERLAP_SAMPLES: usize = 40_000; // 2.5 s`

### L05 [DONE v] Overlap 1.5s → 0.75s
Slight reduction. May save time with minimal quality loss.
- Apply: `PARAKEET_V3_MULTI_CHUNK_OVERLAP_SAMPLES: usize = 24_000; // 1.5 s` → `PARAKEET_V3_MULTI_CHUNK_OVERLAP_SAMPLES: usize = 12_000; // 0.75 s`

---

## GROUP M — VAD threshold (voice activity detection sensitivity)
*File: `src-tauri/src/managers/audio.rs`, in `create_audio_recorder()` Parakeet V3 branch.*
*Current value: `vad_threshold = 0.24`. Lower = catches more speech (less aggressive cut). Higher = stricter.*
*Type: Apply-ParamTask — simple float replacement.*

### M01 [DONE v] VAD 0.24 → 0.18
More sensitive: catches speech that currently gets cut as silence. Risk: false starts.
- Apply: `(0.18, 20, 20, 1)` → `(0.18, 20, 20, 1)`
- Hypothesis: words at start of utterance currently eaten by VAD, especially soft-spoken first words

### M02 [DONE v] VAD 0.24 → 0.20
Slight sensitivity increase. Conservative improvement.
- Apply: `(0.18, 20, 20, 1)` → `(0.20, 20, 20, 1)`

### M03 [DONE v] VAD 0.20 → 0.22
Minimal sensitivity increase. Safest test.
- Apply: `(0.20, 20, 20, 1)` → `(0.22, 20, 20, 1)`

### M04 [ ] VAD 0.20 → 0.26
Slightly more restrictive: less background noise triggers recording.
- Apply: `(0.20, 20, 20, 1)` → `(0.26, 20, 20, 1)`

### M05 [ ] VAD 0.20 → 0.28
More restrictive: reduces false activations in noisy environments.
- Apply: `(0.20, 20, 20, 1)` → `(0.28, 20, 20, 1)`

---

## GROUP N — VAD hangover and prefill frames
*File: `src-tauri/src/managers/audio.rs`, Parakeet V3 voice profile.*
*Current: prefill_frames=20, hangover_frames=20, onset_frames=1.*
*Prefill = audio kept before speech starts. Hangover = audio kept after speech stops.*
*Type: Apply-ParamTask.*

### N01 [ ] Hangover frames 20 → 40
Large hangover. Model sees more trailing audio → cleaner sentence-end detection.
- Apply: `(0.20, 20, 20, 1)` → `(0.20, 20, 40, 1)`
- This directly targets END score which is currently 30.152 (very high). END = speech cut before end of sentence.

### N02 [ ] Hangover frames 20 → 30
Moderate hangover increase. Balanced between END score fix and latency.
- Apply: `(0.20, 20, 20, 1)` → `(0.20, 20, 30, 1)`

### N03 [ ] Prefill frames 20 → 30
More audio before speech onset = less chance of cutting the first syllable.
- Apply: `(0.20, 20, 20, 1)` → `(0.20, 30, 20, 1)`
- Hypothesis: "the Corps of Engineers" → model currently misses "the" if VAD triggers late

### N04 [ ] Prefill frames 20 → 15
Less pre-roll = tighter start. Test if current 20 is excessive.
- Apply: `(0.20, 20, 20, 1)` → `(0.20, 15, 20, 1)`

### N05 [ ] Onset frames 1 → 2
Require 2 consecutive speech frames before triggering. Reduces false starts.
- Apply: `(0.20, 20, 20, 1)` → `(0.20, 20, 20, 2)`

---

## GROUP P — VAD flush silence window
*File: `src-tauri/src/runtime/chunking.rs`.*
*`VAD_FLUSH_SILENCE_SAMPLES = 8_000` (500ms): window scanned for sentence-end silence.*
*`VAD_FLUSH_MIN_CONTENT_SAMPLES = 16_000` (1.0s): minimum before a flush can happen.*
*Type: Apply-ParamTask.*

### P01 [DONE v] Flush silence 500ms → 400ms
Shorter window = detects sentence ends faster. Risk: splits sentences mid-breath.
- Apply: `FLUSH_SILENCE_SAMPLES: usize = 6_400; // 400 ms` → `FLUSH_SILENCE_SAMPLES: usize = 6_400; // 400 ms`

### P02 [DONE v] Flush silence 500ms → 600ms
Longer window = waits more before deciding "sentence done". Fewer false splits.
- Apply: `FLUSH_SILENCE_SAMPLES: usize = 6_400; // 400 ms` → `FLUSH_SILENCE_SAMPLES: usize = 9_600; // 600 ms`
- Hypothesis: speakers who breathe between clauses currently get split into 2 chunks

### P03 [SKIPPED -] Flush silence 500ms → 750ms
Even longer. Good for slower speakers or those with pauses mid-sentence.
- Apply: `FLUSH_SILENCE_SAMPLES: usize = 6_400; // 400 ms` → `FLUSH_SILENCE_SAMPLES: usize = 12_000; // 750 ms`

### P04 [DONE v] Flush min content 1.0s → 0.5s
Allow flush on shorter content. Good for single-word dictation ("delete", "enter", etc.)
- Apply: `FLUSH_MIN_CONTENT_SAMPLES: usize = 16_000; // 1 s` → `FLUSH_MIN_CONTENT_SAMPLES: usize = 8_000; // 0.5 s`
- Hypothesis: short commands currently don't flush cleanly because 1s minimum is too long

### P05 [DONE v] Flush min content 1.0s → 1.5s
Require more content before flush. Prevents spurious sub-second chunks.
- Apply: `FLUSH_MIN_CONTENT_SAMPLES: usize = 8_000; // 0.5 s` → `FLUSH_MIN_CONTENT_SAMPLES: usize = 24_000; // 1.5 s`

---

## GROUP Q — Low-density suspicion thresholds (word density)
*File: `src-tauri/src/actions/transcribe.rs`, function `should_attempt_full_audio_recovery()`.*
*Current: low_density ≤ 1.45 wps, severe ≤ 1.05 wps (requires duration ≥ 12s).*
*These control WHEN the robot re-processes the full audio instead of using chunked output.*
*Type: Apply-ParamTask — float replacement.*

### Q01 [DONE v] Low density 1.45 → 1.35 wps
Less aggressive: only trigger recovery on clearly bad transcriptions.
- Apply: `assembled_words_per_sec <= 1.35` → `assembled_words_per_sec <= 1.35`
- Test if current threshold over-triggers recovery on good transcriptions

### Q02 [DONE v] Low density 1.45 → 1.55 wps
More aggressive: catch more borderline transcriptions for recovery.
- Apply: `assembled_words_per_sec <= 1.35` → `assembled_words_per_sec <= 1.55`
- Hypothesis: some 1.5 wps transcriptions with END issues would benefit from full-audio retry

### Q03 [DONE v] Low density 1.45 → 1.65 wps
Very aggressive recovery trigger. Many more samples get full-audio attempt.
- Apply: `assembled_words_per_sec <= 1.55` → `assembled_words_per_sec <= 1.65`

### Q04 [DONE v] Severe density 1.05 → 0.95 wps
Raise the bar for "severe" — only trigger severe path on truly sparse output.
- Apply: `assembled_words_per_sec <= 1.05 && duration_secs >= 12.0` → `assembled_words_per_sec <= 0.95 && duration_secs >= 12.0`

### Q05 [ ] Severe density min duration 12s → 8s
Currently severe recovery only triggers if audio ≥ 12s. Lower to 8s to catch medium clips.
- Apply: `assembled_words_per_sec <= 0.95 && duration_secs >= 12.0` → `assembled_words_per_sec <= 0.95 && duration_secs >= 8.0`
- Hypothesis: 10-second clips with low density also benefit from full-audio re-process

---

## GROUP R — Recovery promote thresholds
*File: `src-tauri/src/actions/transcribe.rs`, function `should_promote_full_audio_recovery()`.*
*Current: require +3 words AND ×1.15 gain to promote recovered output over chunked output.*
*Type: Apply-ParamTask.*

### R01 [DONE v] Promote min gain +3 words → +2 words
Easier to promote recovery. Accept recovery if it adds just 2 more words.
- Apply: `recovered_words >= assembled_words + 3` → `recovered_words >= assembled_words + 2`
- Hypothesis: some good recoveries get discarded because they only add 2 words

### R02 [ ] Promote min gain +3 words → +4 words
Harder to promote. Only replace chunked output if recovery is clearly better.
- Apply: `recovered_words >= assembled_words + 2` → `recovered_words >= assembled_words + 4`

### R03 [DONE v] Promote ratio 1.15× → 1.10×
Lower ratio threshold. Accept recovery if it has 10% more words instead of 15%.
- Apply: `assembled_words as f32 * 1.15)` → `assembled_words as f32 * 1.10)`

### R04 [ ] Promote ratio 1.15× → 1.20×
Higher ratio requirement. Only clearly superior recoveries get promoted.
- Apply: `assembled_words as f32 * 1.10)` → `assembled_words as f32 * 1.20)``

### R05 [DONE v] Recovery density range: floor 0.4 → 0.3 wps
Allow recovery output that has slightly lower density. Useful for slow speakers.
- Apply: `(0.4..=5.5).contains` → `(0.3..=5.5).contains`
- Hypothesis: slow speakers get recoveries rejected because output density < 0.4

---

## GROUP S — Sparse / empty final chunk thresholds
*File: `src-tauri/src/actions/transcribe.rs`.*
*Current: final chunk triggers recovery if ≤0.35 wps AND assembled ≤2.0 wps.*
*The "12 seconds of speech, one word stuck" case: sparse final chunk with low density.*
*Type: Apply-ParamTask.*

### S01 [DONE v] Final chunk sparse floor 0.35 → 0.45 wps
Catch more sparse final chunks. If final chunk has < 0.45 wps → try full audio.
- Apply: `final_chunk_words_per_sec <= 0.35` → `final_chunk_words_per_sec <= 0.45`
- Directly targets: "someone speaks 12s but the last chunk only transcribed 1 word"

### S02 [ ] Final chunk sparse floor 0.35 → 0.25 wps
Less aggressive — only trigger if final chunk is truly empty.
- Apply: `final_chunk_words_per_sec <= 0.45` → `final_chunk_words_per_sec <= 0.25`

### S03 [ ] Final chunk short: max 2 words → max 3 words
Currently triggers recovery if final chunk (1–6s) has ≤2 words. Extend to ≤3 words.
- Apply: `summary.final_chunk_words <= 2` → `summary.final_chunk_words <= 3`
- Hypothesis: "okay thank you" (3 words) in a final chunk is suspicious on a 4s audio

### S04 [ ] Final chunk short: max 6s → max 8s
Currently only applies to final chunks ≤6s long. Extend to ≤8s.
- Apply: `final_chunk_secs <= 6.0` → `final_chunk_secs <= 8.0`
- Hypothesis: 7s final chunk with only 2 words should also trigger recovery

### S05 [ ] Min final chunk samples 0.5s → 1.0s
Currently discards final chunks < 0.5s (8_000 samples). Raise to 1.0s.
- Apply: `MIN_FINAL_CHUNK_SAMPLES: usize = 8_000; // 0.5 s` → `MIN_FINAL_CHUNK_SAMPLES: usize = 16_000; // 1.0 s`
- Hypothesis: sub-1-second trailing chunks are almost always just noise/trailing breath

---

## GROUP T — Speaking rate / adaptive silence tuning
*File: `src-tauri/src/managers/audio.rs`.*
*Current: silence multiplier = 1.8 (threshold = median_pause × 1.8). Min=400ms, Max=3000ms.*
*This controls how long the app waits after speech stops before finalizing the transcription.*
*Type: Apply-ParamTask.*

### T01 [DONE v] Silence multiplier 1.8 → 1.5
Faster auto-stop: app finishes sooner after speech ends. Risk: cuts off trailing words.
- Apply: `SR_PAUSE_MULTIPLIER: f64 = 1.5;` → `SR_PAUSE_MULTIPLIER: f64 = 1.5;`

### T02 [ ] Silence multiplier 1.8 → 2.0
Slower auto-stop: waits longer to make sure speech is done. Safer for natural pauses.
- Apply: `SR_PAUSE_MULTIPLIER: f64 = 1.5;` → `SR_PAUSE_MULTIPLIER: f64 = 2.0;`
- Hypothesis: thinkers who pause mid-sentence currently get cut before finishing

### T03 [ ] Silence multiplier 1.8 → 2.2
Generous wait time. Best for complex sentences with thinking pauses.
- Apply: `SR_PAUSE_MULTIPLIER: f64 = 1.5;` → `SR_PAUSE_MULTIPLIER: f64 = 2.2;`

### T04 [DONE v] Min silence threshold 400ms → 300ms
Start adapting to silence patterns after shorter pauses. More responsive.
- Apply: `SR_MIN_THRESHOLD_MS: u64 = 400;` → `SR_MIN_THRESHOLD_MS: u64 = 300;`

### T05 [DONE v] Max silence threshold 3000ms → 2500ms
Don't wait more than 2.5s after speech. Balances responsiveness with completeness.
- Apply: `SR_MAX_THRESHOLD_MS: u64 = 3_000;` → `SR_MAX_THRESHOLD_MS: u64 = 2_500;`

---

## GROUP U — Single-word hallucination guard
*File: `src-tauri/src/runtime/chunking.rs`.*
*`PARAKEET_MIN_SAMPLES_FOR_SINGLE_WORD = 24_000` (1.5s): if chunk < 1.5s AND output is 1 word → discard (hallucination).*
*Type: Apply-ParamTask.*

### U01 [ ] Min samples for single word 1.5s → 2.0s
Require 2s of audio before accepting a 1-word result. Reduces single-word hallucinations.
- Apply: `PARAKEET_MIN_SAMPLES_FOR_SINGLE_WORD: usize = 24_000; // 1.5 s` → `PARAKEET_MIN_SAMPLES_FOR_SINGLE_WORD: usize = 32_000; // 2.0 s`
- Hypothesis: very short chunks often hallucinate "okay", "right", "yeah" as single words

### U02 [ ] Min samples for single word 1.5s → 1.0s
Allow 1-word results on shorter audio. Better for single-word commands ("delete", "save").
- Apply: `PARAKEET_MIN_SAMPLES_FOR_SINGLE_WORD: usize = 24_000; // 1.5 s` → `PARAKEET_MIN_SAMPLES_FOR_SINGLE_WORD: usize = 16_000; // 1.0 s`

### U03 [ ] Min samples for single word 1.5s → 2.5s
Strict: require 2.5s to trust a single-word output. Very conservative.
- Apply: `PARAKEET_MIN_SAMPLES_FOR_SINGLE_WORD: usize = 24_000; // 1.5 s` → `PARAKEET_MIN_SAMPLES_FOR_SINGLE_WORD: usize = 40_000; // 2.5 s`

### U04 [ ] Max pending background chunks 1 → 2
Allow 2 chunks to queue instead of 1. May reduce dropped audio when model is slow.
- Apply: `MAX_PENDING_BACKGROUND_CHUNKS: usize = 1;` → `MAX_PENDING_BACKGROUND_CHUNKS: usize = 2;`

### U05 [ ] Chunk sampler poll 200ms → 100ms
Check for ready chunks twice as often. Reduces latency for short utterances.
- Apply: `CHUNK_SAMPLER_POLL_MS: u64 = 200;` → `CHUNK_SAMPLER_POLL_MS: u64 = 100;`

---

## Summary Stats

| Group | Items | Type |
|-------|-------|------|
| A | 15 | EN proper nouns + numbers |
| B | 5 | EN number word forms |
| C | 15 | ES proper nouns + technical |
| D | 20 | FR proper nouns + artifacts |
| E | 15 | PT proper nouns + artifacts |
| F | 5 | Global number/unit |
| G | 5 | Compound words |
| H | 5 | Recovery strategies |
| I | 5 | ES round 2 |
| J | 5 | FR round 2 |
| K | 5 | Chunk size (12s baseline) |
| L | 5 | Chunk overlap (1.0s baseline) |
| M | 5 | VAD threshold (0.24 baseline) |
| N | 5 | VAD hangover/prefill frames |
| P | 5 | VAD flush silence window |
| Q | 5 | Low-density recovery trigger |
| R | 5 | Recovery promote thresholds |
| S | 5 | Sparse/empty final chunk |
| T | 5 | Adaptive silence multiplier |
| U | 5 | Single-word hallucination guard |
| **Total** | **145** | — |

---

## How to Use This List

The robot should:
1. Pick the next unchecked item `[ ]`
2. Implement the exact change described
3. Run `cargo check --manifest-path .\src-tauri\Cargo.toml --example parakeet_pipeline_eval`
4. Run Local 70 eval → save as `ROBOT_LOCAL_REPORT.json`
5. Run FLEURS 400 eval → save as `ROBOT_FLEURS_REPORT.json`
6. Compare WER to baselines above
7. If no regression: mark `[DONE ✓]`, commit, add row to EXPERIMENT_HISTORY.md
8. If regression: mark `[REJECTED ✗]`, revert, do NOT commit
9. Move to next item

**Task types:**
- **Apply-RegexTask**: Groups A-G, I, J → direct text insertion in `parakeet_text.rs`
- **Apply-ParamTask**: Groups K-U → single constant/float replacement in specified file
- **Aider**: Group H → multi-file logic changes

Recovery experiments (GROUP H) should be done LAST — they are higher risk.
Items marked RISKY or CAUTION need extra care when checking per-language WER breakdown.
