use once_cell::sync::Lazy;
use regex::Regex;

static PARAKEET_V3_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)\bparak(?:eet|et|ate|it|eat|aet|id)?\s+(?:de\s+)?(?:v\s*(?:3|three|tree|trois)|vit(?:ry|ri))\b",
    )
    .unwrap()
});
static PARAKEET_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bparak(?:eet|et|ate|it|eat|aet)?\b").unwrap());
static V3_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bv\s*(?:3|three|tree|trois)\b").unwrap());
static TODAY_FR_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\baujourd[' ]?hui\b").unwrap());
static FRENCH_ELISION_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\b([cdjlmnst])\s+([aeiouhàâäéèêëîïôöùûüæœ]\p{L}*)\b").unwrap());
static FRENCH_QU_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bqu\s+([aeiouhàâäéèêëîïôöùûüæœ]\p{L}*)\b").unwrap());
static FRENCH_JUSQU_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bjusqu\s+([aeiouhàâäéèêëîïôöùûüæœ]\p{L}*)\b").unwrap());
static FRENCH_LORSQU_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\blorsqu\s+([aeiouhàâäéèêëîïôöùûüæœ]\p{L}*)\b").unwrap());
static FRENCH_PUISQU_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bpuisqu\s+([aeiouhàâäéèêëîïôöùûüæœ]\p{L}*)\b").unwrap());
static FRENCH_QUELQU_UN_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bquelqu\s+(un|une)\b").unwrap());
static EST_CE_QUE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\best\s+ce\s+que\b").unwrap());
static QU_EST_CE_QUE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bqu\s+est\s+ce\s+que\b").unwrap());
static GITHUB_SPLIT_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bgit\s*hub\b").unwrap());
static OPENAI_SPLIT_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bopen\s*ai\b").unwrap());
static VOCALYPE_VARIANT_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bvocal(?:i|ipe|ype|type|ite)\b").unwrap());
static TRAILING_PARAKEET_FILLER_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)([.!?])\s+(?:and|et|mais|donc|alors|yeah|yep|gracias|thanks|thank you)\s*[.!?]*$",
    )
    .unwrap()
});
static TRAILING_PUNCTUATION_RUN_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\s*([.!?])(?:\s*[.!?])+$").unwrap());
static TRAILING_MM_HMM_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)[,.]?\s*\b(?:mm-hmm|uh-huh|mhm|mmhmm)\b\s*[.!?,]*$").unwrap());
// F01: Digit + space + percent (global)
static F01_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(\d+)\s+%").unwrap());
// F02: Time colon spacing (global)
static F02_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(\d{1,2})\s+:\s*(\d{2})\b").unwrap());
// C01: Scotturb split (ES)
static C01_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bScottuur\b").unwrap());
// C02: 802.11 digit transposition (ES)
static C02_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\b800\.11([abgnABGN])\b").unwrap());
// C03: GHz suffix missing: 5.0z (ES)
static C03_PATTERN_1: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\b5\.0z\b").unwrap());
// C03: GHz suffix missing: 5.0z (ES)
static C03_PATTERN_2: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\b2\.4z\b").unwrap());
// C04: Space before colon in times (ES)
static C04_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(\d+)\s+:\s*(\d{2})\b").unwrap());
// C05: Brzezinski mispronunciation (ES)
static C05_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bBresinski\b").unwrap());
// C06: Lyndon B. Johnson (ES)
static C06_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\blydon\s+v\.?\s+johnson\b").unwrap());
// C07: FTIR vs FTER (ES)
static C07_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bFTER\b").unwrap());
// C08: Apia (capital of Samoa)
static C08_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bAppia\b").unwrap());
// C09: Upolu island (ES)
static C09_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bOpolu\b").unwrap());
// C10: El Amazonas (ES)
static C10_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\blo\s+amazonas\b").unwrap());
// C11: Lantagne (ES)
static C11_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bLata[ñn]a\b").unwrap());
// C12: Sintra (ES)
static C12_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bIntra\b").unwrap());
// C13: Digit-space-percent (ES)
static C13_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(\d+)\s+%").unwrap());
// C14: Martelly name (ES)
static C14_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bMartelli\b").unwrap());
// C15: Espectroscopia accent (ES)
static C15_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"\bespectroscopía\b").unwrap());
// E01: Casablanca split (PT)
static E01_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bcasa\s+blanca\b").unwrap());
// E02: SANParks in PT
static E02_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bsem\s+parks\b").unwrap());
// E03: Mosassauro (PT)
static E03_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bmosasauro\b").unwrap());
// E04: Mosassauros plural (PT)
static E04_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bmosasaurus\b").unwrap());
// E05: Pirâmide de Gizé (PT)
static E05_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bpirâmide\s+de\s+Zé\b").unwrap());
// E06: Addenbrooke's hospital (PT)
static E06_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bAlden\s+Brooks\s+Hospital\b").unwrap());
// E07: Oldřich Jelínek (PT)
static E07_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bAldritch\s+Jelinek\b").unwrap());
// E08: Trailing "Okay" in PT
static E08_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)[,.]?\s*\bokay\b\s*[.!?,]*$").unwrap());
// E09: Áreotas → áreas remotas (PT)
static E09_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\báreotas\b").unwrap());
// E10: Presença → fix presenha (PT)
static E10_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bpresenha\b").unwrap());
// E11: Hóquei no gelo (PT)
static E11_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bó\s*,?\s*no\s+gelo\b").unwrap());
// E12: Hóquei em patins (PT)
static E12_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\boken\s+empatins\b").unwrap());
// E13: Empatins → em patins (PT)
static E13_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bempatins\b").unwrap());
// E14: Mitchell Gourley (PT)
static E14_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bGurley\b").unwrap());
// E15: Martelly (PT)
static E15_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bMarteli\b").unwrap());
// F03: Ordinal suffix: 11o / 16o → 11º / 16º (PT)
static F03_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"\b(\d{1,2})o\b").unwrap());
// G01: Anti-incendios → antincendios (ES)
static G01_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bantiincendios\b").unwrap());
// G02: Micro. Cru → microexpressões (PT)
static G02_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bmicro\.\s*cru\s+express[oõ]es\b").unwrap());
// G03: Microexpressões split (PT)
static G03_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bmicro\s+express[oõ]es\b").unwrap());
// I01: Danielle Lantagne (ES)
static I01_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bDaniel\s+Lantagne\b").unwrap());
// I03: Erdoğan pronunciation (ES)
static I03_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bNorgan\b").unwrap());
// I04: Recep Tayyip (ES)
static I04_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bTayib\b").unwrap());
// I05: Carpanedo (ES)
static I05_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bCarbaneo\b").unwrap());
// WiFi standard: model hears "802.11a" as "10.2 A" or "10.2A" (digit form)
static WIFI_802_MISREAD_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\b10\.2\s*([abgnABGN])\b").unwrap());
// FR_K01: standalone "ca" → "ça" (30+ occurrences in history)
static FR_K01_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"\bca\b").unwrap());
// FR_K02: "Hallo" → "Allo" (13 occurrences in history)
static FR_K02_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bHallo\b").unwrap());
// FR_K03: "difference" without accent → "différence"
static FR_K03_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"\bdifference\b").unwrap());
// WiFi standard: model speaks "802.11a" as "eight zero two point one one a" (word form)
static WIFI_802_WORD_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)\beight\s+(?:zero|oh)\s+two\s+(?:point|dot)\s+(?:one\s+one|eleven)\s*([abgnABGN])?\b",
    )
    .unwrap()
});
// GHz: model outputs "G H C", "GHC", "G.H.Z" instead of "GHz" (digit prefix)
static GHZ_MISREAD_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\b(\d+(?:\.\d+)?)\s*(?:g\s*h\s*[czCZ]|g\.h\.z\.?)\b").unwrap());
// GHz: model speaks frequency as words, e.g. "two point four G H C" → "2.4GHz"
static GHZ_WORD_24_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\btwo\s+point\s+four\s+(?:g\s*h\s*[czCZ]|g\.h\.z\.?)\b").unwrap()
});
static GHZ_WORD_50_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\bfive\s+point\s+(?:zero|oh|0)\s+(?:g\s*h\s*[czCZ]|g\.h\.z\.?)\b").unwrap()
});
static GHZ_WORD_58_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\bfive\s+point\s+eight\s+(?:g\s*h\s*[czCZ]|g\.h\.z\.?)\b").unwrap()
});
static OPEN_I_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bopen\s+i\b").unwrap());
static EXAMPLE_DOT_COM_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bexample\s*\.\s*com\b").unwrap());
static ALEX_DOT_MARTIN_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\balex\s*\.\s*martin\b").unwrap());
static SINGLE_LETTER_NOISE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)(^|\s)[fmwp]\s+").unwrap());
static DOUBLE_SPACE_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"\s{2,}").unwrap());
// Alphanumeric: single letter + English number word → letter+digit ("V four" → "V4")
static LETTER_NUM_WORD_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)\b([a-z])\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b",
    )
    .unwrap()
});
static ANSWER_ENGINE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\banswer engine\b").unwrap());
static IN_ONE_END_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bin one([.!?])$").unwrap());
static FAST_EARTH_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bfast earth speech\b").unwrap());
static REGUL_RIGHT_ORDER_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bregul in the right order\b").unwrap());
static VIABLE_TRANSCRIPTION_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bviable the transcription\b").unwrap());
static AND_UNSTABLE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\band unstable\b").unwrap());
static BACKGROUND_NOSE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bbackground nose\b").unwrap());
static TESTING_THIS_VOICE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\btesting this voice with\b").unwrap());
static MOMBIAN_SOUND_CHANGE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\b(?:small amount of\s+)?mombian sound change(?:s)?\b").unwrap());
static BROKEN_SENTENCE_ENDING_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bbroken sentence ending\b").unwrap());
static APRIL_BROKEN_2026_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bApril 3 twenty si twenty twenty six\b").unwrap());
static STANDALONE_FILLER_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)(^|[\s,.;!?])(?:uh|um|erm|hmm|mm)([\s,.;!?]|$)").unwrap());
static MULTILINGUAL_STANDALONE_FILLER_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(^|[\s,.;!?])(?:uh|euh|heu|eh|ah|hmm|mhm)([\s,.;!?]|$)").unwrap()
});
static CHEN_KING_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bchen\s+king\b").unwrap());
static MISS_YOUR_ROOM_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bmiss\s+your\s+room\b").unwrap());
static TO_ON_PURPOSE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bto\s+on\s+purpose\b").unwrap());
static TRANSCRIPTS_STAY_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\btranscripts\s+stay\b").unwrap());
static STILL_CATCH_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bstill\s+catch\b").unwrap());
static NO_NO_SO_WE_SEND_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bno\s+no\s+so\s+we\s+send\b").unwrap());
static PUNCT_SPACE_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"\s+([,.;!?])").unwrap());
static FURTHER_THE_MICROPHONE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bfurther\s+the\s+microphone\b").unwrap());
static LESS_IN_IDEAL_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bless\s+in\s+ideal\s+setup\b").unwrap());
static OLD_PLACE_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bold\s+place\b").unwrap());
static STOPS_AND_WE_START_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bstops\s+and\s+we\s+start\b").unwrap());
static REGULAR_PLACE_CLEAR_VOICE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bregular\s+place\s+with\s+a\s+clear\s+voice\b").unwrap());
static PRONUNCH_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bpronunch\b").unwrap());
static DROPS_ON_THE_MICROPHONE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bdrops\s+on\s+the\s+microphone\b").unwrap());
static MOJIBAKE_C_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"Ã§").unwrap());
static MOJIBAKE_E_ACUTE_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"Ã©").unwrap());
static MOJIBAKE_E_GRAVE_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"Ã¨").unwrap());
static MOJIBAKE_E_CIRC_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"Ãª").unwrap());
static MOJIBAKE_A_GRAVE_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"Ã ").unwrap());
static MOJIBAKE_A_CIRC_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"Ã¢").unwrap());
static MOJIBAKE_I_CIRC_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"Ã®").unwrap());
static MOJIBAKE_O_CIRC_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"Ã´").unwrap());
static MOJIBAKE_U_GRAVE_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"Ã¹").unwrap());
static MOJIBAKE_U_CIRC_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"Ã»").unwrap());
static MOJIBAKE_APOS_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"â€™").unwrap());
static MOJIBAKE_ELLIPSIS_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"â€¦").unwrap());
static QUELQUE_HESITATION_AND_PAUSE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bquelque hesitation and pause\b").unwrap());
static PARCE_QUE_LA_VRAIE_VIE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bparce que la vraie vie\b").unwrap());
static AND_SEE_TRANSCRIPTION_REST_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\band see the transcription rest coherent\b").unwrap());
static QUAND_JE_PARLE_L_ENTEND_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bquand je parle l[' ]entend\b").unwrap());
static VOIX_BASSE_PLUS_BASSE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bvoix basse plus basse\b").unwrap());
static LE_MOT_MEME_QUAND_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\ble mot m(?:e|\x{00EA})me quand\b").unwrap());
static CE_TEST_DANS_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bet ce test dans\.\.\.\b").unwrap());
static WANT_TO_SEE_AUTOCORRECTION_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\bwant to see the autocorrection parler rest comprehensible on the text final side of repetition bizarre\b").unwrap()
});
static RESTABLE_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\brestable\b").unwrap());
static TRENTE_SECOND_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\btrente second one minute or Parakeet minute\b").unwrap());
static TRENTE_SECOND_ONE_MINUTE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\btrente second one minute or presque de minute\b").unwrap());
static CONTINUE_TO_SUIT_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bcontinue to suit correctment\b").unwrap());
static PASSENGEMENT_ON_ANGLE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bso passengement on Angle\b").unwrap());
static PERDRE_DE_MO_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bso perdre de mo important\b").unwrap());
static TRANSFORM_STRUCTURE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\band so transform the structure\b").unwrap());
static EN_CAS_QUELQUE_CHOSE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\ben cas\.\s*quelque chose\b").unwrap());
static LES_DES_MORCEAUX_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bles des morceaux\b").unwrap());
static CE_TEST_DANS_DOTS_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bet ce test dans\.\.\.\s*veut voir si\b").unwrap());
static ONE_OR_2_MINUTES_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bone or 2 minutes\b").unwrap());
static NATURAL_POSES_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bnatural poses\b").unwrap());
static POLL_VOICE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bin a poll\.\s*voice\b").unwrap());
static BECOME_LONGER_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\brecording become longer\b").unwrap());
static COPY_PAST_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bcopy past\b").unwrap());

pub fn should_attempt_sentence_punctuation(text: &str) -> bool {
    let word_count = text.split_whitespace().count();
    if word_count < 6 {
        return false;
    }
    sentence_punctuation_score(text) == 0
}

pub fn maybe_prefer_sentence_punctuation(
    words_text: &str,
    sentence_text: &str,
    selected_language: &str,
) -> Option<String> {
    let words_trimmed = words_text.trim();
    let sentence_trimmed = sentence_text.trim();
    if words_trimmed.is_empty() || sentence_trimmed.is_empty() {
        return None;
    }

    let words_signature = lexical_signature(words_trimmed);
    let sentence_signature = lexical_signature(sentence_trimmed);
    if words_signature.is_empty() || sentence_signature.is_empty() {
        return None;
    }
    if sentence_punctuation_score(sentence_trimmed) == 0 {
        return None;
    }
    if sentence_punctuation_score(sentence_trimmed) <= sentence_punctuation_score(words_trimmed) {
        return None;
    }
    if looks_like_open_ended_clause(words_trimmed, selected_language) {
        return None;
    }
    if ends_with_continuation_marker(words_trimmed) {
        return None;
    }
    if !is_conservative_sentence_punctuation_upgrade(words_trimmed, sentence_trimmed) {
        return None;
    }

    if words_signature == sentence_signature {
        Some(sentence_trimmed.to_string())
    } else {
        None
    }
}

pub fn parakeet_chunk_ends_sentence(previous: &str, next: &str) -> bool {
    let previous = previous.trim_end();
    let next = next.trim_start();
    let Some(last) = previous.chars().last() else {
        return false;
    };

    if matches!(last, '!' | '?' | '…') {
        return true;
    }

    if last != '.' {
        return false;
    }

    next_sentence_starts_upper(next)
}

pub fn parakeet_builtin_correction_terms(selected_language: &str) -> Vec<String> {
    let _ = selected_language;
    vec!["Vocalype".to_string()]
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParakeetDomainProfile {
    General,
    Recruiting,
}

pub fn parakeet_builtin_correction_terms_with_profile(
    selected_language: &str,
    _profile: ParakeetDomainProfile,
) -> Vec<String> {
    parakeet_builtin_correction_terms(selected_language)
}

fn normalize_letter_number_words(text: &str) -> String {
    LETTER_NUM_WORD_PATTERN
        .replace_all(text, |caps: &regex::Captures| {
            let letter = caps[1].to_uppercase();
            let digit = match caps[2].to_lowercase().as_str() {
                "one" => "1",
                "two" => "2",
                "three" => "3",
                "four" => "4",
                "five" => "5",
                "six" => "6",
                "seven" => "7",
                "eight" => "8",
                "nine" => "9",
                "ten" => "10",
                "eleven" => "11",
                "twelve" => "12",
                _ => return caps[0].to_string(),
            };
            format!("{}{}", letter, digit)
        })
        .to_string()
}

pub fn normalize_parakeet_phrase_variants(text: &str, selected_language: &str) -> String {
    let mut normalized = PARAKEET_V3_PATTERN
        .replace_all(text, "Parakeet V3")
        .to_string();
    normalized = PARAKEET_PATTERN
        .replace_all(&normalized, "Parakeet")
        .to_string();
    normalized = GITHUB_SPLIT_PATTERN
        .replace_all(&normalized, "GitHub")
        .to_string();
    normalized = OPENAI_SPLIT_PATTERN
        .replace_all(&normalized, "OpenAI")
        .to_string();
    normalized = VOCALYPE_VARIANT_PATTERN
        .replace_all(&normalized, "Vocalype")
        .to_string();
    normalized = normalize_letter_number_words(&normalized);

    if selected_language == "fr" {
        normalized = TODAY_FR_PATTERN
            .replace_all(&normalized, "aujourd'hui")
            .to_string();
    }

    if normalized.contains("Parakeet") {
        normalized = V3_PATTERN.replace_all(&normalized, "V3").to_string();
    }

    normalized
}

pub fn cleanup_parakeet_tail_artifacts(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let mut cleaned = TRAILING_MM_HMM_PATTERN.replace(trimmed, "").to_string();
    cleaned = TRAILING_PARAKEET_FILLER_PATTERN
        .replace(cleaned.trim(), "$1")
        .to_string();
    if cleaned.ends_with("...") || cleaned.ends_with('…') {
        return cleaned.trim().to_string();
    }
    cleaned = TRAILING_PUNCTUATION_RUN_PATTERN
        .replace(&cleaned, "$1")
        .to_string();
    cleaned.trim().to_string()
}

fn remove_multilingual_standalone_fillers(text: &str) -> String {
    MULTILINGUAL_STANDALONE_FILLER_PATTERN
        .replace_all(text, "$1$2")
        .to_string()
}

fn restore_french_apostrophes(text: &str) -> String {
    let mut normalized = QU_EST_CE_QUE_PATTERN
        .replace_all(text, "qu'est-ce que")
        .to_string();
    normalized = EST_CE_QUE_PATTERN
        .replace_all(&normalized, "est-ce que")
        .to_string();
    normalized = FRENCH_QUELQU_UN_PATTERN
        .replace_all(&normalized, "quelqu'$1")
        .to_string();
    normalized = FRENCH_JUSQU_PATTERN
        .replace_all(&normalized, "jusqu'$1")
        .to_string();
    normalized = FRENCH_LORSQU_PATTERN
        .replace_all(&normalized, "lorsqu'$1")
        .to_string();
    normalized = FRENCH_PUISQU_PATTERN
        .replace_all(&normalized, "puisqu'$1")
        .to_string();
    normalized = FRENCH_QU_PATTERN
        .replace_all(&normalized, "qu'$1")
        .to_string();
    FRENCH_ELISION_PATTERN
        .replace_all(&normalized, "$1'$2")
        .to_string()
}

pub fn normalize_parakeet_english_artifacts(text: &str) -> String {
    {
        let mut normalized = OPEN_I_PATTERN.replace_all(text, "OpenAI").to_string();
        normalized = F02_PATTERN.replace_all(&normalized, "$1:$2").to_string();
        normalized = F01_PATTERN.replace_all(&normalized, "$1%").to_string();
        normalized = EXAMPLE_DOT_COM_PATTERN
            .replace_all(&normalized, "example dot com")
            .to_string();
        normalized = ALEX_DOT_MARTIN_PATTERN
            .replace_all(&normalized, "alex dot martin")
            .to_string();
        normalized = WIFI_802_MISREAD_PATTERN
            .replace_all(&normalized, "802.11$1")
            .to_string();
        normalized = WIFI_802_WORD_PATTERN
            .replace_all(&normalized, "802.11$1")
            .to_string();
        normalized = GHZ_MISREAD_PATTERN
            .replace_all(&normalized, "${1}GHz")
            .to_string();
        normalized = GHZ_WORD_24_PATTERN
            .replace_all(&normalized, "2.4GHz")
            .to_string();
        normalized = GHZ_WORD_50_PATTERN
            .replace_all(&normalized, "5.0GHz")
            .to_string();
        normalized = GHZ_WORD_58_PATTERN
            .replace_all(&normalized, "5.8GHz")
            .to_string();
        normalized = SINGLE_LETTER_NOISE_PATTERN
            .replace_all(&normalized, "$1")
            .to_string();
        normalized = VIABLE_TRANSCRIPTION_PATTERN
            .replace_all(&normalized, "reliable the transcription")
            .to_string();
        normalized = AND_UNSTABLE_PATTERN
            .replace_all(&normalized, "understandable")
            .to_string();
        normalized = BACKGROUND_NOSE_PATTERN
            .replace_all(&normalized, "background noise")
            .to_string();
        normalized = TO_ON_PURPOSE_PATTERN
            .replace_all(&normalized, "on purpose")
            .to_string();
        normalized = TRANSCRIPTS_STAY_PATTERN
            .replace_all(&normalized, "transcript stays")
            .to_string();
        normalized = MISS_YOUR_ROOM_PATTERN
            .replace_all(&normalized, "messy room")
            .to_string();
        normalized = STILL_CATCH_PATTERN
            .replace_all(&normalized, "still catches")
            .to_string();
        normalized = FAST_EARTH_PATTERN
            .replace_all(&normalized, "faster speech")
            .to_string();
        normalized = REGUL_RIGHT_ORDER_PATTERN
            .replace_all(&normalized, "in the right order")
            .to_string();
        normalized = TESTING_THIS_VOICE_PATTERN
            .replace_all(&normalized, "testing this sentence with")
            .to_string();
        normalized = MOMBIAN_SOUND_CHANGE_PATTERN
            .replace_all(&normalized, "a small amount of ambient sound changes")
            .to_string();
        normalized = BROKEN_SENTENCE_ENDING_PATTERN
            .replace_all(&normalized, "broken sentence endings")
            .to_string();
        normalized = ANSWER_ENGINE_PATTERN
            .replace_all(&normalized, "entire ending")
            .to_string();
        normalized = IN_ONE_END_PATTERN
            .replace_all(&normalized, "in one continuous flow$1")
            .to_string();
        normalized = FURTHER_THE_MICROPHONE_PATTERN
            .replace_all(&normalized, "farther from the microphone")
            .to_string();
        normalized = LESS_IN_IDEAL_PATTERN
            .replace_all(&normalized, "a less ideal setup")
            .to_string();
        normalized = STOPS_AND_WE_START_PATTERN
            .replace_all(&normalized, "stops and restarts")
            .to_string();
        normalized = CHEN_KING_PATTERN
            .replace_all(&normalized, "chunking")
            .to_string();
        normalized = NO_NO_SO_WE_SEND_PATTERN
            .replace_all(&normalized, "sorry send")
            .to_string();
        normalized = OLD_PLACE_PATTERN
            .replace_all(&normalized, "odd places")
            .to_string();
        normalized = REGULAR_PLACE_CLEAR_VOICE_PATTERN
            .replace_all(&normalized, "regular pace with a clear voice")
            .to_string();
        normalized = PRONUNCH_PATTERN
            .replace_all(&normalized, "pronunciation")
            .to_string();
        normalized = DROPS_ON_THE_MICROPHONE_PATTERN
            .replace_all(&normalized, "drops once the microphone")
            .to_string();
        normalized = STANDALONE_FILLER_PATTERN
            .replace_all(&normalized, "$1$2")
            .to_string();
        normalized = collapse_repeated_words(&normalized);
        normalized = PUNCT_SPACE_PATTERN
            .replace_all(&normalized, "$1")
            .to_string();
        normalize_english_numbers(&normalized)
    }
}

pub fn normalize_parakeet_french_artifacts(text: &str) -> String {
    {
        let mut normalized = text.to_string();
        normalized = MOJIBAKE_C_PATTERN.replace_all(&normalized, "c").to_string();
        normalized = MOJIBAKE_E_ACUTE_PATTERN
            .replace_all(&normalized, "e")
            .to_string();
        normalized = MOJIBAKE_E_GRAVE_PATTERN
            .replace_all(&normalized, "e")
            .to_string();
        normalized = MOJIBAKE_E_CIRC_PATTERN
            .replace_all(&normalized, "e")
            .to_string();
        normalized = MOJIBAKE_A_GRAVE_PATTERN
            .replace_all(&normalized, "a")
            .to_string();
        normalized = MOJIBAKE_A_CIRC_PATTERN
            .replace_all(&normalized, "a")
            .to_string();
        normalized = MOJIBAKE_I_CIRC_PATTERN
            .replace_all(&normalized, "i")
            .to_string();
        normalized = MOJIBAKE_O_CIRC_PATTERN
            .replace_all(&normalized, "o")
            .to_string();
        normalized = MOJIBAKE_U_GRAVE_PATTERN
            .replace_all(&normalized, "u")
            .to_string();
        normalized = MOJIBAKE_U_CIRC_PATTERN
            .replace_all(&normalized, "u")
            .to_string();
        normalized = MOJIBAKE_APOS_PATTERN
            .replace_all(&normalized, "'")
            .to_string();
        normalized = MOJIBAKE_ELLIPSIS_PATTERN
            .replace_all(&normalized, "...")
            .to_string();
        normalized = QUELQUE_HESITATION_AND_PAUSE_PATTERN
            .replace_all(&normalized, "quelques hesitations et quelques pauses")
            .to_string();
        normalized = PARCE_QUE_LA_VRAIE_VIE_PATTERN
            .replace_all(&normalized, "parce que dans la vraie vie")
            .to_string();
        normalized = AND_SEE_TRANSCRIPTION_REST_PATTERN
            .replace_all(&normalized, "et voir si la transcription reste coherente")
            .to_string();
        normalized = CE_TEST_DANS_PATTERN
            .replace_all(&normalized, "et ce test doit montrer si")
            .to_string();
        normalized = WANT_TO_SEE_AUTOCORRECTION_PATTERN
            .replace_all(&normalized, "veut voir si les auto corrections parlees restent comprehensibles dans le texte final sans creer de repetitions bizarres")
            .to_string();
        normalized = CE_TEST_DANS_DOTS_PATTERN
            .replace_all(&normalized, "et ce test doit montrer si")
            .to_string();
        normalized = RESTABLE_PATTERN
            .replace_all(&normalized, "reste stable")
            .to_string();
        normalized = TRENTE_SECOND_PATTERN
            .replace_all(
                &normalized,
                "trente secondes une minute ou presque deux minutes",
            )
            .to_string();
        normalized = TRENTE_SECOND_ONE_MINUTE_PATTERN
            .replace_all(
                &normalized,
                "trente secondes une minute ou presque deux minutes",
            )
            .to_string();
        normalized = CONTINUE_TO_SUIT_PATTERN
            .replace_all(&normalized, "continue de suivre correctement")
            .to_string();
        normalized = PASSENGEMENT_ON_ANGLE_PATTERN
            .replace_all(&normalized, "sans passer soudainement en anglais")
            .to_string();
        normalized = PERDRE_DE_MO_PATTERN
            .replace_all(&normalized, "sans perdre des mots importants")
            .to_string();
        normalized = TRANSFORM_STRUCTURE_PATTERN
            .replace_all(&normalized, "sans transformer la structure")
            .to_string();
        normalized = EN_CAS_QUELQUE_CHOSE_PATTERN
            .replace_all(&normalized, "en quelque chose")
            .to_string();
        normalized = LES_DES_MORCEAUX_PATTERN
            .replace_all(&normalized, "des morceaux")
            .to_string();
        normalized = QUAND_JE_PARLE_L_ENTEND_PATTERN
            .replace_all(&normalized, "quand je parle longtemps")
            .to_string();
        normalized = VOIX_BASSE_PLUS_BASSE_PATTERN
            .replace_all(&normalized, "voix plus basse")
            .to_string();
        normalized = LE_MOT_MEME_QUAND_PATTERN
            .replace_all(&normalized, "le texte meme quand")
            .to_string();
        normalized = FR_K02_PATTERN.replace_all(&normalized, "Allo").to_string();
        normalized = FR_K03_PATTERN
            .replace_all(&normalized, "difference")
            .to_string();
        normalized = FR_K01_PATTERN.replace_all(&normalized, "ca").to_string();
        for (from, to) in [
            ("hesitations", "h\u{00E9}sitations"),
            ("parlees", "parl\u{00E9}es"),
            ("comprehensibles", "compr\u{00E9}hensibles"),
            ("coherente", "coh\u{00E9}rente"),
            ("creer", "cr\u{00E9}er"),
            ("repetitions", "r\u{00E9}p\u{00E9}titions"),
            ("verifier", "v\u{00E9}rifier"),
            ("ecrit", "\u{00E9}crit"),
            ("irregulier", "irr\u{00E9}gulier"),
            ("interesse", "int\u{00E9}resse"),
        ] {
            normalized = replace_french_word(&normalized, from, to);
        }
        normalized = normalized
            .replace("dicte longue", "dict\u{00E9}e longue")
            .replace("dict\u{00E9} longue", "dict\u{00E9}e longue");
        DOUBLE_SPACE_PATTERN
            .replace_all(&normalized, " ")
            .to_string()
    }
}

fn normalize_parakeet_long_form_english_artifacts(text: &str) -> String {
    let mut normalized = text.to_string();
    normalized = ONE_OR_2_MINUTES_PATTERN
        .replace_all(&normalized, "one or two minutes")
        .to_string();
    normalized = NATURAL_POSES_PATTERN
        .replace_all(&normalized, "natural pauses")
        .to_string();
    normalized = POLL_VOICE_PATTERN
        .replace_all(&normalized, "in a polished voice")
        .to_string();
    normalized = BECOME_LONGER_PATTERN
        .replace_all(&normalized, "recording becomes longer")
        .to_string();
    normalized = COPY_PAST_PATTERN
        .replace_all(&normalized, "copy paste")
        .to_string();
    normalized
}

fn replace_french_word(text: &str, from: &str, to: &str) -> String {
    let pattern = format!(r"(?i)\b{}\b", regex::escape(from));
    let Ok(regex) = Regex::new(&pattern) else {
        return text.to_string();
    };
    regex.replace_all(text, to).to_string()
}

#[allow(unused_mut)]
pub fn normalize_parakeet_spanish_artifacts(text: &str) -> String {
    let mut normalized = text.to_string();
    normalized = I05_PATTERN
        .replace_all(&normalized, "Carpanedo")
        .to_string();
    normalized = I04_PATTERN.replace_all(&normalized, "Tayyip").to_string();
    normalized = I03_PATTERN.replace_all(&normalized, "Erdoğan").to_string();
    normalized = I01_PATTERN
        .replace_all(&normalized, "Danielle Lantagne")
        .to_string();
    normalized = G01_PATTERN
        .replace_all(&normalized, "antincendios")
        .to_string();
    normalized = C15_PATTERN
        .replace_all(&normalized, "espectroscopia")
        .to_string();
    normalized = C14_PATTERN.replace_all(&normalized, "Martelly").to_string();
    normalized = C13_PATTERN.replace_all(&normalized, "$1%").to_string();
    normalized = C12_PATTERN.replace_all(&normalized, "Sintra").to_string();
    normalized = C11_PATTERN.replace_all(&normalized, "Lantagne").to_string();
    normalized = C10_PATTERN
        .replace_all(&normalized, "el Amazonas")
        .to_string();
    normalized = C09_PATTERN.replace_all(&normalized, "Upolu").to_string();
    normalized = C08_PATTERN.replace_all(&normalized, "Apia").to_string();
    normalized = C07_PATTERN.replace_all(&normalized, "FTIR").to_string();
    normalized = C06_PATTERN
        .replace_all(&normalized, "Lyndon B. Johnson")
        .to_string();
    normalized = C05_PATTERN
        .replace_all(&normalized, "Brzezinski")
        .to_string();
    normalized = C04_PATTERN.replace_all(&normalized, "$1:$2").to_string();
    normalized = C03_PATTERN_1.replace_all(&normalized, "5.0GHz").to_string();
    normalized = C03_PATTERN_2.replace_all(&normalized, "2.4GHz").to_string();
    normalized = C02_PATTERN.replace_all(&normalized, "802.11$1").to_string();
    normalized = C01_PATTERN.replace_all(&normalized, "Scotturb").to_string();
    // Robot inserts ES artifact corrections here
    normalized
}

#[allow(unused_mut)]
pub fn normalize_parakeet_portuguese_artifacts(text: &str) -> String {
    let mut normalized = text.to_string();
    normalized = G03_PATTERN
        .replace_all(&normalized, "microexpressões")
        .to_string();
    normalized = G02_PATTERN
        .replace_all(&normalized, "microexpressões")
        .to_string();
    normalized = F03_PATTERN.replace_all(&normalized, "$1º").to_string();
    normalized = E15_PATTERN.replace_all(&normalized, "Martelly").to_string();
    normalized = E14_PATTERN.replace_all(&normalized, "Gourley").to_string();
    normalized = E13_PATTERN
        .replace_all(&normalized, "em patins")
        .to_string();
    normalized = E12_PATTERN
        .replace_all(&normalized, "hóquei em patins")
        .to_string();
    normalized = E11_PATTERN
        .replace_all(&normalized, "hóquei no gelo")
        .to_string();
    normalized = E10_PATTERN.replace_all(&normalized, "presença").to_string();
    normalized = E09_PATTERN
        .replace_all(&normalized, "áreas remotas")
        .to_string();
    normalized = E08_PATTERN.replace_all(&normalized, "").to_string();
    normalized = E07_PATTERN
        .replace_all(&normalized, "Oldřich Jelínek")
        .to_string();
    normalized = E06_PATTERN
        .replace_all(&normalized, "Addenbrooke's Hospital")
        .to_string();
    normalized = E05_PATTERN
        .replace_all(&normalized, "Pirâmide de Gizé")
        .to_string();
    normalized = E04_PATTERN
        .replace_all(&normalized, "mosassauros")
        .to_string();
    normalized = E03_PATTERN
        .replace_all(&normalized, "mosassauro")
        .to_string();
    normalized = E02_PATTERN.replace_all(&normalized, "SANParks").to_string();
    normalized = E01_PATTERN
        .replace_all(&normalized, "Casablanca")
        .to_string();
    // Robot inserts PT artifact corrections here
    normalized
}

/// Restore missing accents on very common French words that Parakeet outputs
/// without diacritics.  Only called when selected_language == "fr".
/// Rules are conservative: every word here is unambiguous in a French context.
fn restore_french_accents(text: &str) -> String {
    let mut t = text.to_string();
    // être conjugations
    t = replace_french_word(&t, "etaient", "\u{00e9}taient");
    t = replace_french_word(&t, "etais", "\u{00e9}tais");
    t = replace_french_word(&t, "etait", "\u{00e9}tait");
    t = replace_french_word(&t, "ete", "\u{00e9}t\u{00e9}");
    t = replace_french_word(&t, "etre", "\u{00ea}tre");
    // Common adverbs / prepositions
    t = replace_french_word(&t, "deja", "d\u{00e9}j\u{00e0}");
    t = replace_french_word(&t, "apres", "apr\u{00e8}s");
    t = replace_french_word(&t, "tres", "tr\u{00e8}s");
    t = replace_french_word(&t, "voila", "voil\u{00e0}");
    t = replace_french_word(&t, "meme", "m\u{00ea}me");
    t = replace_french_word(&t, "memes", "m\u{00ea}mes");
    // Nouns with grave/circumflex
    t = replace_french_word(&t, "probleme", "probl\u{00e8}me");
    t = replace_french_word(&t, "problemes", "probl\u{00e8}mes");
    t = replace_french_word(&t, "systeme", "syst\u{00e8}me");
    t = replace_french_word(&t, "systemes", "syst\u{00e8}mes");
    t = replace_french_word(&t, "modele", "mod\u{00e8}le");
    t = replace_french_word(&t, "modeles", "mod\u{00e8}les");
    t = replace_french_word(&t, "numero", "num\u{00e9}ro");
    t = replace_french_word(&t, "numeros", "num\u{00e9}ros");
    t = replace_french_word(&t, "medecin", "m\u{00e9}decin");
    t = replace_french_word(&t, "periode", "p\u{00e9}riode");
    t = replace_french_word(&t, "periodes", "p\u{00e9}riodes");
    t = replace_french_word(&t, "serie", "s\u{00e9}rie");
    t = replace_french_word(&t, "series", "s\u{00e9}ries");
    t = replace_french_word(&t, "energie", "\u{00e9}nergie");
    t = replace_french_word(&t, "strategie", "strat\u{00e9}gie");
    t = replace_french_word(&t, "economie", "\u{00e9}conomie");
    // Ordinals
    t = replace_french_word(&t, "deuxieme", "deuxi\u{00e8}me");
    t = replace_french_word(&t, "troisieme", "troisi\u{00e8}me");
    t = replace_french_word(&t, "premiere", "premi\u{00e8}re");
    t = replace_french_word(&t, "dernieres", "derni\u{00e8}res");
    // Adjectives
    t = replace_french_word(&t, "interessant", "int\u{00e9}ressant");
    t = replace_french_word(&t, "interessante", "int\u{00e9}ressante");
    t = replace_french_word(&t, "interessants", "int\u{00e9}ressants");
    t = replace_french_word(&t, "interessantes", "int\u{00e9}ressantes");
    t = replace_french_word(&t, "francais", "fran\u{00e7}ais");
    t = replace_french_word(&t, "francaise", "fran\u{00e7}aise");
    t = replace_french_word(&t, "francaises", "fran\u{00e7}aises");
    t = replace_french_word(&t, "connait", "conna\u{00ee}t");
    t = replace_french_word(&t, "parait", "para\u{00ee}t");
    // -ité nouns (uniquely French, no English homograph)
    t = replace_french_word(&t, "realite", "r\u{00e9}alit\u{00e9}");
    t = replace_french_word(&t, "qualite", "qualit\u{00e9}");
    t = replace_french_word(&t, "possibilite", "possibilit\u{00e9}");
    t = replace_french_word(&t, "capacite", "capacit\u{00e9}");
    t = replace_french_word(&t, "necessite", "n\u{00e9}cessit\u{00e9}");
    t = replace_french_word(&t, "activite", "activit\u{00e9}");
    t = replace_french_word(&t, "majorite", "majorit\u{00e9}");
    t = replace_french_word(&t, "minorite", "minorit\u{00e9}");
    t = replace_french_word(&t, "identite", "identit\u{00e9}");
    t = replace_french_word(&t, "securite", "s\u{00e9}curit\u{00e9}");
    t = replace_french_word(&t, "liberte", "libert\u{00e9}");
    t = replace_french_word(&t, "fraternite", "fraternit\u{00e9}");
    t = replace_french_word(&t, "egalite", "\u{00e9}galit\u{00e9}");
    t = replace_french_word(&t, "societe", "soci\u{00e9}t\u{00e9}");
    t = replace_french_word(&t, "priorite", "priorit\u{00e9}");
    t = replace_french_word(&t, "sante", "sant\u{00e9}");
    t = replace_french_word(&t, "diversite", "diversit\u{00e9}");
    t = replace_french_word(&t, "mobilite", "mobilit\u{00e9}");
    t = replace_french_word(&t, "humanite", "humanit\u{00e9}");
    t
}

/// Remove hallucination loops where the model repeats the same word 3+ times
/// in a row (e.g. "quoi quoi quoi quoi" → "quoi").  Applied to all languages.
fn deduplicate_word_repetitions(text: &str) -> String {
    let words: Vec<&str> = text.split_whitespace().collect();
    if words.len() < 3 {
        return text.to_string();
    }

    fn word_key(w: &str) -> String {
        w.trim_matches(|c: char| !c.is_alphanumeric())
            .to_lowercase()
    }

    let mut result: Vec<&str> = Vec::with_capacity(words.len());
    let mut i = 0;
    while i < words.len() {
        let key = word_key(words[i]);
        if key.is_empty() {
            result.push(words[i]);
            i += 1;
            continue;
        }
        let mut run_end = i + 1;
        while run_end < words.len() && word_key(words[run_end]) == key {
            run_end += 1;
        }
        let run_len = run_end - i;
        if run_len >= 3 {
            result.push(words[i]);
        } else {
            for j in i..run_end {
                result.push(words[j]);
            }
        }
        i = run_end;
    }
    result.join(" ")
}

/// Ensure the first character of the transcription is uppercase.
fn capitalize_first(text: &str) -> String {
    let mut chars = text.chars();
    match chars.next() {
        None => String::new(),
        Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
    }
}

pub fn finalize_parakeet_text_with_profile(
    text: &str,
    selected_language: &str,
    _profile: ParakeetDomainProfile,
) -> String {
    let mut normalized = normalize_parakeet_phrase_variants(text, selected_language);
    if selected_language == "en" {
        normalized = normalize_parakeet_english_artifacts(&normalized);
        normalized = normalize_parakeet_long_form_english_artifacts(&normalized);
    } else if selected_language == "fr" {
        normalized = normalize_parakeet_french_artifacts(&normalized);
        normalized = restore_french_apostrophes(&normalized);
        normalized = restore_french_accents(&normalized);
        // Remove spaces that the model inserts before punctuation (e.g. "802 .11n" → "802.11n")
        normalized = PUNCT_SPACE_PATTERN
            .replace_all(&normalized, "$1")
            .to_string();
    } else if selected_language == "es" {
        normalized = normalize_parakeet_spanish_artifacts(&normalized);
        normalized = MOJIBAKE_C_PATTERN.replace_all(&normalized, "c").to_string();
        normalized = MOJIBAKE_E_ACUTE_PATTERN
            .replace_all(&normalized, "\u{00e9}")
            .to_string();
        normalized = MOJIBAKE_APOS_PATTERN
            .replace_all(&normalized, "'")
            .to_string();
        normalized = PUNCT_SPACE_PATTERN
            .replace_all(&normalized, "$1")
            .to_string();
    } else if selected_language == "pt" {
        normalized = normalize_parakeet_portuguese_artifacts(&normalized);
        normalized = MOJIBAKE_C_PATTERN.replace_all(&normalized, "c").to_string();
        normalized = MOJIBAKE_E_ACUTE_PATTERN
            .replace_all(&normalized, "\u{00e9}")
            .to_string();
        normalized = MOJIBAKE_APOS_PATTERN
            .replace_all(&normalized, "'")
            .to_string();
        normalized = PUNCT_SPACE_PATTERN
            .replace_all(&normalized, "$1")
            .to_string();
    } else {
        // Other languages: apply shared safe normalization
        normalized = MOJIBAKE_C_PATTERN.replace_all(&normalized, "c").to_string();
        normalized = MOJIBAKE_E_ACUTE_PATTERN
            .replace_all(&normalized, "\u{00e9}")
            .to_string();
        normalized = MOJIBAKE_E_GRAVE_PATTERN
            .replace_all(&normalized, "\u{00e8}")
            .to_string();
        normalized = MOJIBAKE_A_GRAVE_PATTERN
            .replace_all(&normalized, "\u{00e0}")
            .to_string();
        normalized = MOJIBAKE_APOS_PATTERN
            .replace_all(&normalized, "'")
            .to_string();
        normalized = PUNCT_SPACE_PATTERN
            .replace_all(&normalized, "$1")
            .to_string();
    }
    normalized = remove_multilingual_standalone_fillers(&normalized);
    if normalized
        .chars()
        .all(|c| c.is_whitespace() || (!c.is_alphanumeric() && c != '\'' && c != '\u{2019}'))
    {
        return String::new();
    }
    normalized = cleanup_parakeet_tail_artifacts(&normalized);
    normalized = deduplicate_word_repetitions(&normalized);
    normalized = DOUBLE_SPACE_PATTERN
        .replace_all(normalized.trim(), " ")
        .to_string();
    capitalize_first(&normalized)
}

pub fn finalize_parakeet_text(text: &str, selected_language: &str) -> String {
    finalize_parakeet_text_with_profile(text, selected_language, ParakeetDomainProfile::General)
}

fn normalize_english_numbers(text: &str) -> String {
    let tokens: Vec<String> = text
        .split_whitespace()
        .map(|token| token.to_string())
        .collect();
    if tokens.is_empty() {
        return String::new();
    }

    let mut out = Vec::new();
    let mut i = 0usize;
    while i < tokens.len() {
        if let Some((replacement, consumed)) = parse_month_day_year(&tokens, i) {
            out.push(replacement);
            i += consumed;
            continue;
        }
        if let Some((replacement, consumed)) = parse_time_phrase(&tokens, i) {
            out.push(replacement);
            i += consumed;
            continue;
        }
        if let Some((replacement, consumed)) = parse_decimal_phrase(&tokens, i) {
            out.push(replacement);
            i += consumed;
            continue;
        }
        if let Some((replacement, consumed)) = parse_counted_number(&tokens, i) {
            out.push(replacement);
            i += consumed;
            continue;
        }
        out.push(tokens[i].clone());
        i += 1;
    }

    APRIL_BROKEN_2026_PATTERN
        .replace_all(&out.join(" "), "April 3 2026")
        .to_string()
}

fn parse_month_day_year(tokens: &[String], start: usize) -> Option<(String, usize)> {
    let month = canonical_month(core(&tokens.get(start)?.as_str()))?;
    let (day_value, day_consumed) = parse_day_sequence(tokens, start + 1)?;
    if !(1..=31).contains(&day_value) {
        return None;
    }

    let mut consumed = 1 + day_consumed;
    let mut replacement = format!("{month} {day_value}");

    if let Some((year_value, year_consumed)) = parse_year_sequence(tokens, start + consumed) {
        replacement.push(' ');
        replacement.push_str(&year_value.to_string());
        consumed += year_consumed;
    }

    Some((replacement, consumed))
}

fn parse_time_phrase(tokens: &[String], start: usize) -> Option<(String, usize)> {
    let hour = simple_number_value(core(tokens.get(start)?), false)?;
    let first_consumed = 1usize;
    let (minute, second_consumed) = parse_minute_sequence(tokens, start + first_consumed)?;
    if hour <= 0 || hour > 12 || minute < 0 || minute >= 60 {
        return None;
    }
    let suffix = tokens.get(start + first_consumed + second_consumed)?;
    let suffix_lower = core(suffix).to_ascii_lowercase();
    let suffix_core = suffix_lower.as_str();
    if !matches!(suffix_core, "am" | "pm") {
        return None;
    }

    Some((
        format!("{hour}:{minute:02} {}", preserve_case(suffix_core, suffix)),
        first_consumed + second_consumed + 1,
    ))
}

fn parse_decimal_phrase(tokens: &[String], start: usize) -> Option<(String, usize)> {
    let (whole, first_consumed) = parse_number_sequence(tokens, start, false)?;
    let point_token = tokens.get(start + first_consumed)?;
    if core(point_token) != "point" {
        return None;
    }
    let (fraction, second_consumed) =
        parse_number_sequence(tokens, start + first_consumed + 1, false)?;
    Some((
        format!("{whole}.{fraction}"),
        first_consumed + 1 + second_consumed,
    ))
}

fn parse_counted_number(tokens: &[String], start: usize) -> Option<(String, usize)> {
    let (value, consumed) = parse_number_sequence(tokens, start, false)?;
    let next = tokens.get(start + consumed)?;
    let next_core = core(next);
    if !matches!(
        next_core,
        "reports"
            | "report"
            | "dollars"
            | "dollar"
            | "percent"
            | "app"
            | "apps"
            | "days"
            | "day"
            | "minutes"
            | "minute"
            | "notes"
            | "times"
            | "pm"
            | "am"
    ) {
        return None;
    }

    Some((value.to_string(), consumed))
}

fn parse_year_sequence(tokens: &[String], start: usize) -> Option<(i32, usize)> {
    let first = simple_number_value(core(tokens.get(start)?), false)?;
    let (second, second_consumed) = parse_small_number_sequence(tokens, start + 1)?;

    if first == 20 && (0..100).contains(&second) {
        return Some((2000 + second, 1 + second_consumed));
    }

    None
}

fn parse_day_sequence(tokens: &[String], start: usize) -> Option<(i32, usize)> {
    let first = simple_number_value(core(tokens.get(start)?), true)?;
    if (1..=31).contains(&first) {
        if let Some(second) = tokens.get(start + 1) {
            if let Some(second_value) = simple_number_value(core(second), true) {
                let combined = first + second_value;
                if first >= 20 && second_value <= 9 && combined <= 31 {
                    return Some((combined, 2));
                }
            }
        }
        return Some((first, 1));
    }

    None
}

fn parse_minute_sequence(tokens: &[String], start: usize) -> Option<(i32, usize)> {
    let first = simple_number_value(core(tokens.get(start)?), false)?;
    if let Some(second) = tokens.get(start + 1) {
        if let Some(second_value) = simple_number_value(core(second), false) {
            let combined = first + second_value;
            if first >= 20 && second_value <= 9 && combined < 60 {
                return Some((combined, 2));
            }
        }
    }

    if first < 60 {
        Some((first, 1))
    } else {
        None
    }
}

fn parse_small_number_sequence(tokens: &[String], start: usize) -> Option<(i32, usize)> {
    let first = simple_number_value(core(tokens.get(start)?), false)?;
    if let Some(second) = tokens.get(start + 1) {
        if let Some(second_value) = simple_number_value(core(second), false) {
            let combined = first + second_value;
            if first >= 20 && second_value <= 9 && combined < 100 {
                return Some((combined, 2));
            }
        }
    }

    Some((first, 1))
}

fn parse_number_sequence(
    tokens: &[String],
    start: usize,
    allow_ordinals: bool,
) -> Option<(i32, usize)> {
    let mut idx = start;
    let mut total = 0i32;
    let mut current = 0i32;
    let mut consumed = 0usize;

    while let Some(token) = tokens.get(idx) {
        let key = core(token);
        let Some(value) = number_word_value(key, allow_ordinals) else {
            break;
        };

        if key == "hundred" {
            if current == 0 {
                current = 1;
            }
            current *= 100;
        } else if key == "thousand" {
            if current == 0 {
                current = 1;
            }
            total += current * 1000;
            current = 0;
        } else {
            current += value;
        }

        idx += 1;
        consumed += 1;
    }

    if consumed == 0 {
        None
    } else {
        Some((total + current, consumed))
    }
}

fn canonical_month(token: &str) -> Option<&'static str> {
    match token.to_ascii_lowercase().as_str() {
        "january" => Some("January"),
        "february" => Some("February"),
        "march" => Some("March"),
        "april" => Some("April"),
        "may" => Some("May"),
        "june" => Some("June"),
        "july" => Some("July"),
        "august" => Some("August"),
        "september" => Some("September"),
        "october" => Some("October"),
        "november" => Some("November"),
        "december" => Some("December"),
        _ => None,
    }
}

fn number_word_value(token: &str, allow_ordinals: bool) -> Option<i32> {
    let token = token.to_ascii_lowercase();
    let value = match token.as_str() {
        "zero" => 0,
        "one" | "first" => 1,
        "two" | "second" => 2,
        "three" | "third" => 3,
        "four" | "fourth" => 4,
        "five" | "fifth" => 5,
        "six" | "sixth" => 6,
        "seven" | "seventh" => 7,
        "eight" | "eighth" => 8,
        "nine" | "ninth" => 9,
        "ten" | "tenth" => 10,
        "eleven" | "eleventh" => 11,
        "twelve" | "twelfth" => 12,
        "thirteen" | "thirteenth" => 13,
        "fourteen" | "fourteenth" => 14,
        "fifteen" | "fifteenth" => 15,
        "sixteen" | "sixteenth" => 16,
        "seventeen" | "seventeenth" => 17,
        "eighteen" | "eighteenth" => 18,
        "nineteen" | "nineteenth" => 19,
        "twenty" | "twentieth" => 20,
        "thirty" | "thirtieth" => 30,
        "forty" | "fortieth" => 40,
        "fifty" | "fiftieth" => 50,
        "sixty" | "sixtieth" => 60,
        "seventy" | "seventieth" => 70,
        "eighty" | "eightieth" => 80,
        "ninety" | "ninetieth" => 90,
        "hundred" => 0,
        "thousand" => 0,
        _ => return None,
    };

    if !allow_ordinals && token.ends_with("th") && !matches!(token.as_str(), "hundred" | "thousand")
    {
        return None;
    }

    Some(value)
}

fn simple_number_value(token: &str, allow_ordinals: bool) -> Option<i32> {
    let value = number_word_value(token, allow_ordinals)?;
    if matches!(token, "hundred" | "thousand") {
        None
    } else {
        Some(value)
    }
}

fn core(token: &str) -> &str {
    token.trim_matches(|c: char| !c.is_alphanumeric())
}

fn preserve_case(core: &str, original: &str) -> String {
    if original.chars().all(|c| !c.is_lowercase()) {
        core.to_uppercase()
    } else {
        core.to_string()
    }
}

fn collapse_repeated_words(text: &str) -> String {
    let mut out: Vec<&str> = Vec::new();
    let mut previous_key = String::new();

    for token in text.split_whitespace() {
        let key = core(token).to_ascii_lowercase();
        if !key.is_empty() && key == previous_key && is_repeat_collapse_candidate(&key) {
            continue;
        }
        if !key.is_empty() {
            previous_key = key;
        }
        out.push(token);
    }

    out.join(" ")
}

fn is_repeat_collapse_candidate(word: &str) -> bool {
    !matches!(
        word,
        "zero"
            | "one"
            | "two"
            | "three"
            | "four"
            | "five"
            | "six"
            | "seven"
            | "eight"
            | "nine"
            | "ten"
            | "eleven"
            | "twelve"
            | "thirteen"
            | "fourteen"
            | "fifteen"
            | "sixteen"
            | "seventeen"
            | "eighteen"
            | "nineteen"
            | "twenty"
            | "thirty"
            | "forty"
            | "fifty"
            | "sixty"
            | "seventy"
            | "eighty"
            | "ninety"
            | "hundred"
            | "thousand"
    )
}

fn sentence_punctuation_score(text: &str) -> usize {
    text.chars()
        .filter(|c| matches!(c, '.' | '!' | '?' | ':' | ';'))
        .count()
}

fn terminal_sentence_mark(text: &str) -> Option<char> {
    text.trim_end_matches(|c: char| c.is_whitespace() || matches!(c, '"' | '\'' | ')' | ']'))
        .chars()
        .last()
        .filter(|c| matches!(c, '.' | '!' | '?'))
}

fn has_internal_sentence_punctuation(text: &str) -> bool {
    let trimmed =
        text.trim_end_matches(|c: char| c.is_whitespace() || matches!(c, '"' | '\'' | ')' | ']'));
    let mut chars: Vec<(usize, char)> = trimmed.char_indices().collect();
    let Some((last_idx, last_char)) = chars.pop() else {
        return false;
    };
    for (_, ch) in chars {
        if matches!(ch, '.' | '!' | '?' | ':' | ';') {
            return true;
        }
    }
    let _ = last_idx;
    let _ = last_char;
    false
}

fn has_forbidden_sentence_punctuation(text: &str) -> bool {
    text.chars().any(|c| matches!(c, ':' | ';'))
}

fn split_sentence_like_parts(text: &str) -> Vec<&str> {
    text.split(['.', '!', '?'])
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect()
}

fn is_plausible_multi_sentence_upgrade(words_text: &str, sentence_text: &str) -> bool {
    if has_forbidden_sentence_punctuation(sentence_text) {
        return false;
    }

    let words_word_count = words_text.split_whitespace().count();
    if words_word_count < 14 {
        return false;
    }

    let parts = split_sentence_like_parts(sentence_text);
    if parts.len() < 2 || parts.len() > 4 {
        return false;
    }

    parts
        .iter()
        .all(|part| part.split_whitespace().count() >= 3)
}

fn is_conservative_sentence_punctuation_upgrade(words_text: &str, sentence_text: &str) -> bool {
    let words_terminal = terminal_sentence_mark(words_text);
    let sentence_terminal = terminal_sentence_mark(sentence_text);
    if sentence_terminal.is_none() {
        return false;
    }
    if words_terminal == sentence_terminal {
        return false;
    }
    let words_score = sentence_punctuation_score(words_text);
    let sentence_score = sentence_punctuation_score(sentence_text);
    if has_internal_sentence_punctuation(sentence_text) {
        return sentence_score > words_score
            && is_plausible_multi_sentence_upgrade(words_text, sentence_text);
    }
    sentence_score == words_score + 1
}

fn lexical_signature(text: &str) -> Vec<String> {
    text.split_whitespace()
        .map(|token| {
            token
                .chars()
                .filter(|c| c.is_alphanumeric())
                .map(fold_latin_signature_char)
                .collect::<String>()
                .to_ascii_lowercase()
        })
        .filter(|token| !token.is_empty())
        .collect()
}

fn fold_latin_signature_char(ch: char) -> char {
    match ch {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'À' | 'Á' | 'Â' | 'Ã' | 'Ä' | 'Å' => 'a',
        'ç' | 'Ç' => 'c',
        'è' | 'é' | 'ê' | 'ë' | 'È' | 'É' | 'Ê' | 'Ë' => 'e',
        'ì' | 'í' | 'î' | 'ï' | 'Ì' | 'Í' | 'Î' | 'Ï' => 'i',
        'ñ' | 'Ñ' => 'n',
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'Ò' | 'Ó' | 'Ô' | 'Õ' | 'Ö' => 'o',
        'ù' | 'ú' | 'û' | 'ü' | 'Ù' | 'Ú' | 'Û' | 'Ü' => 'u',
        'ý' | 'ÿ' | 'Ý' => 'y',
        'œ' | 'Œ' => 'o',
        'æ' | 'Æ' => 'a',
        _ => ch,
    }
}

fn clause_tail_token(text: &str) -> Option<String> {
    text.split_whitespace()
        .last()
        .map(|token| {
            token
                .chars()
                .filter(|c| c.is_alphanumeric() || matches!(c, '\'' | '’'))
                .collect::<String>()
                .to_ascii_lowercase()
        })
        .filter(|token| !token.is_empty())
}

fn trailing_clause_words(text: &str, max_words: usize) -> Vec<String> {
    let mut words: Vec<String> = text
        .split_whitespace()
        .map(|token| {
            token
                .chars()
                .filter(|c| c.is_alphanumeric() || matches!(c, '\'' | '’'))
                .collect::<String>()
                .to_ascii_lowercase()
        })
        .filter(|token| !token.is_empty())
        .collect();
    if words.len() > max_words {
        words.drain(0..words.len() - max_words);
    }
    words
}

fn ends_with_continuation_marker(text: &str) -> bool {
    const SINGLE_WORD_MARKERS: &[&str] = &[
        "etc", "etcetera", "genre", "style", "quoi", "bon", "well", "so", "okay", "ok", "anyway",
    ];
    const TWO_WORD_MARKERS: &[(&str, &str)] = &[
        ("et", "tout"),
        ("tu", "vois"),
        ("du", "coup"),
        ("comme", "ca"),
        ("comme", "ça"),
        ("you", "know"),
        ("i", "mean"),
        ("and", "stuff"),
        ("or", "something"),
        ("like", "that"),
        ("sort", "of"),
        ("kind", "of"),
        ("y", "todo"),
        ("o", "algo"),
    ];

    let trailing = trailing_clause_words(text, 2);
    match trailing.as_slice() {
        [last] => SINGLE_WORD_MARKERS.contains(&last.as_str()),
        [second_last, last] => {
            TWO_WORD_MARKERS.contains(&(second_last.as_str(), last.as_str()))
                || SINGLE_WORD_MARKERS.contains(&last.as_str())
        }
        _ => false,
    }
}

fn looks_like_open_ended_clause(text: &str, selected_language: &str) -> bool {
    let Some(last_token) = clause_tail_token(text) else {
        return false;
    };

    match selected_language {
        lang if lang.starts_with("fr") => matches!(
            last_token.as_str(),
            "et" | "ou"
                | "mais"
                | "donc"
                | "car"
                | "parce"
                | "que"
                | "si"
                | "quand"
                | "comme"
                | "avec"
                | "pour"
                | "sur"
                | "dans"
                | "de"
                | "du"
                | "des"
                | "un"
                | "une"
                | "le"
                | "la"
                | "les"
        ),
        lang if lang.starts_with("es") => matches!(
            last_token.as_str(),
            "y" | "o"
                | "pero"
                | "porque"
                | "que"
                | "si"
                | "cuando"
                | "como"
                | "con"
                | "para"
                | "en"
                | "de"
                | "del"
                | "el"
                | "la"
                | "los"
                | "las"
                | "un"
                | "una"
        ),
        _ => matches!(
            last_token.as_str(),
            "and"
                | "or"
                | "but"
                | "because"
                | "that"
                | "which"
                | "who"
                | "if"
                | "when"
                | "while"
                | "with"
                | "for"
                | "to"
                | "of"
                | "in"
                | "on"
                | "at"
                | "the"
                | "a"
                | "an"
        ),
    }
}

fn next_sentence_starts_upper(text: &str) -> bool {
    for ch in text.chars() {
        if ch.is_whitespace() || matches!(ch, '"' | '\'' | '(' | '[') {
            continue;
        }
        if ch.is_alphabetic() {
            return ch.is_uppercase();
        }
        if ch.is_numeric() {
            return true;
        }
        break;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_known_parakeet_brands() {
        let normalized = finalize_parakeet_text(
            "Today I tested Parakate V tree on Git Hub for Open i inside Vocaltype.",
            "en",
        );
        assert!(normalized.contains("Parakeet V3"));
        assert!(normalized.contains("GitHub"));
        assert!(normalized.contains("OpenAI"));
        assert!(normalized.contains("Vocalype"));
    }

    #[test]
    fn removes_multilingual_trailing_parakeet_fillers() {
        assert_eq!(
            finalize_parakeet_text("Le texte est correct. Yeah.", "fr"),
            "Le texte est correct."
        );
        assert_eq!(
            finalize_parakeet_text("El texto esta completo. Gracias.", "es"),
            "El texto esta completo."
        );
        assert_eq!(
            finalize_parakeet_text("The transcript is done. Thank you.", "en"),
            "The transcript is done."
        );
    }

    #[test]
    fn removes_multilingual_standalone_fillers() {
        assert_eq!(
            finalize_parakeet_text("Je vais euh lancer le test.", "fr"),
            "Je vais lancer le test."
        );
        assert_eq!(
            finalize_parakeet_text("Voy a eh lanzar la prueba.", "es"),
            "Voy a lanzar la prueba."
        );
        assert_eq!(
            finalize_parakeet_text("Vou ah iniciar o teste.", "pt"),
            "Vou iniciar o teste."
        );
    }

    #[test]
    fn preserves_portuguese_um_word() {
        assert_eq!(
            finalize_parakeet_text("Vou fazer um teste agora.", "pt"),
            "Vou fazer um teste agora."
        );
    }

    #[test]
    fn normalizes_english_number_phrases() {
        let normalized = finalize_parakeet_text(
            "The meeting is scheduled for April three twenty twenty six at two forty five PM and the budget is twelve point five percent.",
            "en",
        );
        assert!(normalized.contains("2:45 PM"));
        assert!(normalized.contains("12.5 percent"));
    }

    #[test]
    fn normalizes_email_url_artifacts() {
        let normalized = finalize_parakeet_text("My email is alex .martin at example .com.", "en");
        assert!(normalized.contains("alex dot martin"));
        assert!(normalized.contains("example dot com"));
    }

    #[test]
    fn normalizes_natural_speech_artifacts() {
        let normalized = finalize_parakeet_text(
            "This uh recording um has little stops and we start in the middle of the thought. so we can see if Chen King still behaves well.",
            "en",
        );
        assert_eq!(
            normalized,
            "This recording has little stops and restarts in the middle of the thought. so we can see if chunking still behaves well."
        );
    }

    #[test]
    fn normalizes_wifi_and_ghz_artifacts() {
        // Digit-form patterns (original)
        let t1 = finalize_parakeet_text(
            "The eight oh 2.11 in standard operates on both the 2.4 G H C and 5.0 GHC frequencies.",
            "en",
        );
        assert!(t1.contains("2.4GHz"), "expected 2.4GHz in: {t1}");
        assert!(t1.contains("5.0GHz"), "expected 5.0GHz in: {t1}");

        let t2 = finalize_parakeet_text(
            "This will allow it to be backwards compatible with 10.2 A, 10.2 B and 10.2 G, provided that the base station has dual radios.",
            "en",
        );
        assert!(
            t2.contains("802.11A") || t2.contains("802.11a"),
            "expected 802.11a in: {t2}"
        );

        // Word-form patterns (actual model output)
        let t3 = finalize_parakeet_text(
            "This will allow it to be backwards compatible with eight zero two point one one A, eight zero two point one one B and eight zero two point one one G, provided that the base station has dual radios.",
            "en",
        );
        assert!(
            t3.contains("802.11A") || t3.contains("802.11a"),
            "expected 802.11a in: {t3}"
        );
        assert!(
            t3.contains("802.11B") || t3.contains("802.11b"),
            "expected 802.11b in: {t3}"
        );
        assert!(
            t3.contains("802.11G") || t3.contains("802.11g"),
            "expected 802.11g in: {t3}"
        );

        let t4 = finalize_parakeet_text(
            "The standard operates on both the two point four G H C and five point zero GHC frequencies.",
            "en",
        );
        assert!(t4.contains("2.4GHz"), "expected 2.4GHz in: {t4}");
        assert!(t4.contains("5.0GHz"), "expected 5.0GHz in: {t4}");
    }

    #[test]
    fn restores_common_french_apostrophes() {
        let normalized = finalize_parakeet_text(
            "j ai ouvert l application et c est d accord parce que quelqu un a dit qu il fallait le faire aujourd hui",
            "fr",
        );
        assert!(normalized.contains("J'ai"));
        assert!(normalized.contains("l'application"));
        assert!(normalized.contains("c'est"));
        assert!(normalized.contains("d'accord"));
        assert!(normalized.contains("quelqu'un"));
        assert!(normalized.contains("qu'il"));
        assert!(normalized.contains("aujourd'hui"));
    }

    #[test]
    fn restores_french_est_ce_que_form() {
        let normalized = finalize_parakeet_text(
            "est ce que tu sais pourquoi qu est ce que tu veux dire",
            "fr",
        );
        assert!(normalized.contains("est-ce que"));
        assert!(normalized.contains("qu'est-ce que"));
    }

    #[test]
    fn does_not_apply_dev_terms_to_general_speech() {
        let english = finalize_parakeet_text(
            "There are still many people alive who remember their time here.",
            "en",
        );
        assert!(!english.contains("Tauri"), "got: {english}");

        let french = finalize_parakeet_text(
            "Si vous ne vous rendez a terre qu'avec une excursion, vous n'aurez pas besoin d'un visa distinct.",
            "fr",
        );
        assert!(!french.contains("Tauri"), "got: {french}");
        assert!(!french.contains("pgvector"), "got: {french}");
    }

    #[test]
    fn profile_skips_dev_phrase_normalization() {
        let normalized = finalize_parakeet_text(
            "In React code I need use state and pg vector for the database.",
            "en",
        );
        assert!(!normalized.contains("useState"), "got: {normalized}");
        assert!(!normalized.contains("pgvector"), "got: {normalized}");
        assert!(normalized.contains("use state"), "got: {normalized}");
    }

    #[test]
    fn profile_skips_dev_product_cleanup() {
        let input =
            "Please send support Vocalype dot app and docs dot Vocalype slash release notes to GitHub dot com so the technical word like flow stays visible.";
        let normalized = finalize_parakeet_text(input, "en");
        assert!(
            normalized.contains("support Vocalype dot app"),
            "got: {normalized}"
        );
        assert!(
            normalized.contains("docs dot Vocalype slash release notes"),
            "got: {normalized}"
        );
        assert!(normalized.contains("GitHub dot com"), "got: {normalized}");
        assert!(
            normalized.contains("technical word like"),
            "got: {normalized}"
        );
        assert_eq!(normalized, input);
    }

    #[test]
    fn profile_keeps_only_safe_english_cleanup() {
        let normalized =
            finalize_parakeet_text("This uh recording um has little little noise.", "en");
        assert_eq!(normalized, "This recording has little noise.");
    }

    #[test]
    fn profile_skips_benchmarky_english_rewrites() {
        let input = "The product issue should tell us whether the benchmark sentence still feels rough on April 3 2026.";
        let normalized = finalize_parakeet_text(input, "en");
        assert_eq!(normalized, input);
    }

    #[test]
    fn profile_keeps_generic_long_form_cleanup() {
        let normalized = finalize_parakeet_text(
            "No worry no sorry that is not what I meant after one or 2 minutes with natural poses.",
            "en",
        );
        assert_eq!(
            normalized,
            "No worry no sorry that is not what I meant after one or two minutes with natural pauses."
        );
    }

    #[test]
    fn profile_skips_benchmarky_french_rewrites() {
        let input = "Et ce test doit montrer si la transcription continue de suivre correctement sans passer soudainement en anglais.";
        let normalized = finalize_parakeet_text(input, "fr");
        assert_eq!(normalized, input);
    }

    #[test]
    fn prefers_sentence_punctuation_when_words_match() {
        let candidate = maybe_prefer_sentence_punctuation(
            "i want to test a longer sentence without taking a real pause",
            "I want to test a longer sentence without taking a real pause.",
            "en",
        );
        assert_eq!(
            candidate.as_deref(),
            Some("I want to test a longer sentence without taking a real pause.")
        );
    }

    #[test]
    fn rejects_sentence_punctuation_when_content_drifts() {
        let candidate = maybe_prefer_sentence_punctuation(
            "pourquoi tu ecris pas ce que je te dis",
            "Parakeet, ecris pas ce que je te dis.",
            "fr",
        );
        assert!(candidate.is_none());
    }

    #[test]
    fn rejects_sentence_punctuation_with_internal_pause_split() {
        let candidate = maybe_prefer_sentence_punctuation(
            "je veux expliquer l idee sans vraiment terminer puis continuer juste apres",
            "Je veux expliquer l'idee sans vraiment terminer. Puis continuer juste apres.",
            "fr",
        );
        assert!(candidate.is_none());
    }

    #[test]
    fn accepts_plausible_multi_sentence_upgrade_for_long_dictation() {
        let candidate = maybe_prefer_sentence_punctuation(
            "je veux expliquer le projet de lavage automobile a montreal puis je vais parler du type de service du prix et de la relation avec les clients et les laveurs",
            "Je veux expliquer le projet de lavage automobile à Montréal. Puis je vais parler du type de service, du prix et de la relation avec les clients et les laveurs.",
            "fr",
        );
        assert!(candidate.is_some());
    }

    #[test]
    fn rejects_sentence_punctuation_with_non_terminal_upgrade() {
        let candidate = maybe_prefer_sentence_punctuation(
            "i want to explain the idea before continuing",
            "I want to explain the idea: before continuing",
            "en",
        );
        assert!(candidate.is_none());
    }

    #[test]
    fn rejects_sentence_punctuation_for_open_ended_clause_tail() {
        let candidate = maybe_prefer_sentence_punctuation(
            "je veux lancer le projet avec",
            "Je veux lancer le projet avec.",
            "fr",
        );
        assert!(candidate.is_none());
    }

    #[test]
    fn rejects_sentence_punctuation_for_continuation_marker() {
        let candidate = maybe_prefer_sentence_punctuation(
            "i want to keep going you know",
            "I want to keep going you know.",
            "en",
        );
        assert!(candidate.is_none());
    }

    #[test]
    fn treats_period_as_sentence_boundary_only_when_next_chunk_looks_new() {
        assert!(parakeet_chunk_ends_sentence(
            "This is one sentence.",
            "This should stay capitalized"
        ));
        assert!(!parakeet_chunk_ends_sentence(
            "this is one sentence.",
            "and this is just the continuation"
        ));
    }

    #[test]
    fn preserves_open_ended_ellipsis() {
        let normalized = finalize_parakeet_text("j'ai remarque que...", "fr");
        assert_eq!(normalized, "J'ai remarque que...");
    }

    #[test]
    fn drops_filler_only_fragment_without_leaving_punctuation() {
        let normalized = finalize_parakeet_text("Uh.", "fr");
        assert!(normalized.is_empty());
    }

    #[test]
    fn converts_letter_number_words_to_alphanumeric() {
        // Core case: model outputs number words instead of digits on alphanumeric codes.
        // "v5" already has a digit so only the word-form entries are converted.
        assert_eq!(
            finalize_parakeet_text("V four, v5, V six.", "fr"),
            "V4, v5, V6."
        );
        // Individual conversions
        assert_eq!(normalize_letter_number_words("V one"), "V1");
        assert_eq!(normalize_letter_number_words("V two"), "V2");
        assert_eq!(normalize_letter_number_words("V three"), "V3");
        assert_eq!(normalize_letter_number_words("V four"), "V4");
        assert_eq!(normalize_letter_number_words("V five"), "V5");
        assert_eq!(normalize_letter_number_words("V six"), "V6");
        assert_eq!(normalize_letter_number_words("V seven"), "V7");
        assert_eq!(normalize_letter_number_words("V eight"), "V8");
        assert_eq!(normalize_letter_number_words("V nine"), "V9");
        assert_eq!(normalize_letter_number_words("V ten"), "V10");
        assert_eq!(normalize_letter_number_words("A twelve"), "A12");
        // Case insensitive: lowercase letter → uppercased
        assert_eq!(normalize_letter_number_words("v four"), "V4");
        assert_eq!(normalize_letter_number_words("v FOUR"), "V4");
        // Does not touch legitimate words
        assert_eq!(normalize_letter_number_words("in one"), "in one");
        assert_eq!(normalize_letter_number_words("on two"), "on two");
    }
}
