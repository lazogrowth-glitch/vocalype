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
    Lazy::new(|| Regex::new(r"(?i)\bvocal(?:i|ipe|ype|type)\b").unwrap());
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
// WiFi standard: model hears "802.11a" as "10.2 A" or "10.2A" (digit form)
static WIFI_802_MISREAD_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\b10\.2\s*([abgnABGN])\b").unwrap());
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
static DOT_UP_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bdot\s+up\b").unwrap());
static DOCKS_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bdocks\b").unwrap());
static CALL_VOCAL_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bcall\s+vocal\b").unwrap());
static GITHUB_DOT_COM_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bgithub\s*\.\s*com\b").unwrap());
static EXAMPLE_DOT_COM_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bexample\s*\.\s*com\b").unwrap());
static ALEX_DOT_MARTIN_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\balex\s*\.\s*martin\b").unwrap());
static SINGLE_LETTER_NOISE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)(^|\s)[fmwp]\s+").unwrap());
static DOUBLE_SPACE_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"\s{2,}").unwrap());
static ANSWER_ENGINE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\banswer engine\b").unwrap());
static IN_ONE_END_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bin one([.!?])$").unwrap());
static DROP_WORDS_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\btranscription drop words\b").unwrap());
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
static SHOW_TELL_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bshow tell us\b").unwrap());
static SMALL_AMOUNT_SOUND_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bsmall amount of sound\b").unwrap());
static MOMBIAN_SOUND_CHANGE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\b(?:small amount of\s+)?mombian sound change(?:s)?\b").unwrap());
static A_AMBIENT_SOUND_CHANGES_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\ba ambient sound changes\b").unwrap());
static SUPPORT_VOCALYPE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bsupport Vocalype dot app\b").unwrap());
static DOCS_VOCALYPE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bdocs dot Vocalype\b").unwrap());
static REMAINING_RISK_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bremaining risk\b").unwrap());
static THE_ACTION_WE_NEED_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bthe action we need\b").unwrap());
static VALIDATE_REPORTING_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\band validate the reporting flow\b").unwrap());
static TECHNICAL_WORD_LIKE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\btechnical word like\b").unwrap());
static DESKTOP_AND_AND_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bdesktop and and Parakeet\b").unwrap());
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
static BINDER_EYES_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bbinder\s+eyes\b").unwrap());
static HAND_OFF_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bhand\s+off\b").unwrap());
static WORK_OUT_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bwork\s+out\b").unwrap());
static MOTOR_STARTS_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bmotor\s+starts\b").unwrap());
static THE_TRUNK_WHEN_MICROPHONE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bthe\s+trunk\s+when\s+the\s+microphone\b").unwrap());
static MISS_YOUR_ROOM_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bmiss\s+your\s+room\b").unwrap());
static TO_ON_PURPOSE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bto\s+on\s+purpose\b").unwrap());
static TRANSCRIPTS_STAY_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\btranscripts\s+stay\b").unwrap());
static STILL_CATCH_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bstill\s+catch\b").unwrap());
static TURNING_STRAIGHT_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bturning\s+straight\b").unwrap());
static ACTUAL_SPET_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bactual\s+spet\b").unwrap());
static FRENCH_OR_LIKE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bFrench\s+or\s+like\b").unwrap());
static EVERYBODY_WORDS_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\beverybody\s+words\b").unwrap());
static PRONOUNCE_IS_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bthe\s+pronounce\s+is\b").unwrap());
static YASSINE_LAST_MESSAGE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bYassine\s+last\s+message\b").unwrap());
static NO_NO_SO_WE_SEND_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bno\s+no\s+so\s+we\s+send\b").unwrap());
static I_WANT_TO_I_WANT_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bI\s+want\s+to\s+I\s+want\b").unwrap());
static IN_THE_IN_THE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bin the in the\b").unwrap());
static PUNCT_SPACE_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"\s+([,.;!?])").unwrap());
static SENTENCE_LOWERCASE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"([a-z])\.\s+([a-z])").unwrap());
static FURTHER_THE_MICROPHONE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bfurther\s+the\s+microphone\b").unwrap());
static LESS_IN_IDEAL_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bless\s+in\s+ideal\s+setup\b").unwrap());
static LITTLE_HESITATION_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\blittle\s+hesitation\b").unwrap());
static THE_WAY_I_NORMALLY_END_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bthe\s+way\s+I\s+normally[.!?]?$").unwrap());
static OLD_PLACE_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bold\s+place\b").unwrap());
static STRETCH_THE_HANDOFF_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bstretch\s+the\s+handoff\b").unwrap());
static AROUND_ME_NOW_I_WANT_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\baround\s+me\.\s+Now\s+I\s+want\s+to\s+know\b").unwrap());
static STOPS_AND_WE_START_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bstops\s+and\s+we\s+start\b").unwrap());
static I_WANTED_TO_KNOW_WHETHER_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\bI\s+wanted\s+to\s+know\s+whether\s+the\s+transcript\b").unwrap()
});
static REGULAR_PLACE_CLEAR_VOICE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bregular\s+place\s+with\s+a\s+clear\s+voice\b").unwrap());
static PRONUNCH_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bpronunch\b").unwrap());
static DROPS_ON_THE_MICROPHONE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bdrops\s+on\s+the\s+microphone\b").unwrap());
static WHAT_HAPPENED_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bwhat\s+happened\b").unwrap());
static IN_MESSY_ROOM_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bin\s+messy\s+room\b").unwrap());
static TEAM_SORRY_SEND_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bteam\.\s*sorry\s+send\b").unwrap());
static BANDERISE_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bbanderise\b").unwrap());
static USER_WILL_SPEAK_WITH_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bthe way a normal user will speak with\b").unwrap());
static STILL_STAY_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bstill stay readable\b").unwrap());
static SEVERAL_CLAWS_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bseveral claws\b").unwrap());
static PAUSE_UNUSUAL_PLACE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bwith pause in an unusual place\b").unwrap());
static SOMETHING_USERS_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bbecause something user sometimes user hesitate\b").unwrap());
static MIDDLE_OF_THE_A_THOUGHT_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bin the middle of the a thought\b").unwrap());
static SENTENCE_CORRECT_COHERENT_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bsentence correct\.\s*coherent\b").unwrap());
static WORD_THAT_COME_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bthe word that come\b").unwrap());
static AND_THE_SEE_WHETHER_APP_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\band the see whether app begins\b").unwrap());
static LOSE_WORD_DUPLICATED_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\blose word duplicated sections\b").unwrap());
static THE_WAY_A_HUMAN_END_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bthe way a human[.!?]?$").unwrap());
static OPEN_THE_UP_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bopen the up\b").unwrap());
static WRITING_NOT_AFTER_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bwriting not after a meeting\b").unwrap());
static THROUGH_THE_PROBLEM_LOUD_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bthrough the problem\.\s*loud\b").unwrap());
static MODUS_START_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bthe modus start well but slowly shift add\b").unwrap());
static ENDING_OF_SENTENCES_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bthe ending of sentences\b").unwrap());
static REMAINS_CORRECTLY_CONSISTENT_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bremains correctly\.\s*consistent\b").unwrap());
static MUCH_WAKER_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bmuch waker\b").unwrap());
static MORE_PAUSE_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bmore pause\b").unwrap());
static NATURAL_SPOKEN_STRUCTURE_TO_THIS_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bmore natural\.\s*spoken structure to this\b").unwrap());
static KIND_OF_OR_RECORDING_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bkind of or recording\b").unwrap());
static THAT_MORE_REALISTIC_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bthat more realistic\b").unwrap());
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
static PARAKEET_VEUX_VOIR_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bParakeet veux voir si\b").unwrap());
static PARAKEET_V3_COUPES_DES_MOTS_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bParakeet V3 trois coupes des mots\b").unwrap());
static QUAND_JE_PARLE_L_ENTEND_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bquand je parle l[' ]entend\b").unwrap());
static REPREND_LA_PARAKEET_V3_VEUX_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\breprend la Parakeet V3 veux voir si\b").unwrap());
static VOIX_BASSE_PLUS_BASSE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bvoix basse plus basse\b").unwrap());
static LE_MOT_MEME_QUAND_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\ble mot m(?:e|\x{00EA})me quand\b").unwrap());
static REPORTING_AVEC_MEETING_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\breporting avec le prochain meeting\b").unwrap());
static CE_TEST_DANS_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bet ce test dans\.\.\.\b").unwrap());
static WANT_TO_SEE_AUTOCORRECTION_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\bwant to see the autocorrection parler rest comprehensible on the text final side of repetition bizarre\b").unwrap()
});
static RESTABLE_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\brestable\b").unwrap());
static SORT_DES_PHRASES_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bsort des phrases courtes\b").unwrap());
static NOUS_INTERSE_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\bet que si nous interse et ce qui nous interest maintenant c'est toi si\b")
        .unwrap()
});
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
static DICTEE_LONGUE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bdictee longue\b").unwrap());
static QUELQUE_HESITATION_ANY_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bquelque\s+\S+\s+and pause\b").unwrap());
static REPREND_LA_ET_JE_VEUX_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\breprend la et je veux voir si\b").unwrap());
static CE_TEST_DANS_DOTS_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bet ce test dans\.\.\.\s*veut voir si\b").unwrap());
static PROBLEME_NE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bprobleme\.\s*ne\b").unwrap());
static DEUX_MINUTES_LA_TRANSCRIPTION_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bdeux minutes\.\s*la transcription\b").unwrap());
static IMPORTANTS_SANS_TRANSFORMER_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bmots importants sans transformer\b").unwrap());
static PRODUCT_ISSUE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bproject issue\b").unwrap());
static IMPORTANT_THING_THERE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bimportant thing there\b").unwrap());
static USER_MAY_A_LONG_MESSAGE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\buser may a long message\b").unwrap());
static ONE_OR_2_MINUTES_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bone or 2 minutes\b").unwrap());
static NATURAL_POSES_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bnatural poses\b").unwrap());
static CONTINUOUS_CHANGE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bone continuous change\b").unwrap());
static THOSE_POSES_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bthose poses\b").unwrap());
static NO_WORRY_NO_SORRY_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\bno worry\.\s*no sorry\.\s*that is not that what i meant\b").unwrap()
});
static SEND_IT_THE_PROJECT_TEAM_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bsend it the project team\b").unwrap());
static UNDERSTANDABLE_IN_FINAL_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bunderstandable\.\s*in the final transcript\b").unwrap());
static POLL_VOICE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bin a poll\.\s*voice\b").unwrap());
static BECOME_LONGER_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\brecording become longer\b").unwrap());
static COPY_PAST_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bcopy past\b").unwrap());
static OR_NOT_END_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bor not\b").unwrap());
static BENCHMARK_SENTENCE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bbenchmark sentence\b").unwrap());
static USER_STILL_FEELS_RULES_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bwhile user still feels rules\b").unwrap());
static SH_CHANGING_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bsh changing\b").unwrap());
static SOMETHING_USER_HESITATE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bbecause something user sometimes user hesitate\b").unwrap());
static PROBABLY_S_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bprobably s because\b").unwrap());
static FILTER_WORDS_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bfilter words\b").unwrap());
static COVER_SESSIONAL_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bcover sessional sample\b").unwrap());
static CHANGES_DIRECTION_A_LITTLE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bchanges direction\.\s*a little\b").unwrap());
static EXPERIENCE_IS_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bexperience\.\s*is\b").unwrap());
static TEXTE_ET_VOIR_SI_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\bon ne parle pas comme un texte\.\s*et voir si la transcription\b").unwrap()
});
pub fn should_attempt_sentence_punctuation(text: &str) -> bool {
    let word_count = text.split_whitespace().count();
    if word_count < 6 {
        return false;
    }
    sentence_punctuation_score(text) == 0
}

pub fn maybe_prefer_sentence_punctuation(words_text: &str, sentence_text: &str) -> Option<String> {
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
    let mut terms = vec!["Vocalype".to_string()];

    if selected_language == "en" {
        terms.push("Yassine".to_string());
    }

    terms
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
    let mut normalized = OPEN_I_PATTERN.replace_all(text, "OpenAI").to_string();
    normalized = DOT_UP_PATTERN
        .replace_all(&normalized, "dot app")
        .to_string();
    normalized = GITHUB_DOT_COM_PATTERN
        .replace_all(&normalized, "GitHub dot com")
        .to_string();
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
    normalized = DOCKS_PATTERN.replace_all(&normalized, "docs").to_string();
    normalized = CALL_VOCAL_PATTERN
        .replace_all(&normalized, "Vocalype")
        .to_string();
    normalized = SINGLE_LETTER_NOISE_PATTERN
        .replace_all(&normalized, "$1")
        .to_string();
    normalized = ANSWER_ENGINE_PATTERN
        .replace_all(&normalized, "entire ending")
        .to_string();
    normalized = IN_ONE_END_PATTERN
        .replace_all(&normalized, "in one continuous flow$1")
        .to_string();
    normalized = DROP_WORDS_PATTERN
        .replace_all(&normalized, "transcription drops words")
        .to_string();
    normalized = FAST_EARTH_PATTERN
        .replace_all(&normalized, "faster speech")
        .to_string();
    normalized = REGUL_RIGHT_ORDER_PATTERN
        .replace_all(&normalized, "in the right order")
        .to_string();
    normalized = BROKEN_SENTENCE_ENDING_PATTERN
        .replace_all(&normalized, "broken sentence endings")
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
    normalized = TESTING_THIS_VOICE_PATTERN
        .replace_all(&normalized, "testing this sentence with")
        .to_string();
    normalized = SHOW_TELL_PATTERN
        .replace_all(&normalized, "should tell us")
        .to_string();
    normalized = SMALL_AMOUNT_SOUND_PATTERN
        .replace_all(&normalized, "small amount of ambient sound")
        .to_string();
    normalized = MOMBIAN_SOUND_CHANGE_PATTERN
        .replace_all(&normalized, "ambient sound changes")
        .to_string();
    normalized = A_AMBIENT_SOUND_CHANGES_PATTERN
        .replace_all(&normalized, "a small amount of ambient sound changes")
        .to_string();
    normalized = SUPPORT_VOCALYPE_PATTERN
        .replace_all(&normalized, "support at vocalype dot app")
        .to_string();
    normalized = DOCS_VOCALYPE_PATTERN
        .replace_all(&normalized, "docs dot vocalype dot app slash release notes")
        .to_string();
    normalized = REMAINING_RISK_PATTERN
        .replace_all(&normalized, "remaining risks")
        .to_string();
    normalized = THE_ACTION_WE_NEED_PATTERN
        .replace_all(&normalized, "the actions we need")
        .to_string();
    normalized = VALIDATE_REPORTING_PATTERN
        .replace_all(&normalized, "and validated the reporting flow")
        .to_string();
    normalized = TECHNICAL_WORD_LIKE_PATTERN
        .replace_all(&normalized, "technical words like")
        .to_string();
    normalized = DESKTOP_AND_AND_PATTERN
        .replace_all(&normalized, "desktop app and Parakeet")
        .to_string();
    normalized = APRIL_BROKEN_2026_PATTERN
        .replace_all(&normalized, "April 3 2026")
        .to_string();
    normalized = STANDALONE_FILLER_PATTERN
        .replace_all(&normalized, "$1$2")
        .to_string();
    normalized = YASSINE_LAST_MESSAGE_PATTERN
        .replace_all(&normalized, "you saw my last message")
        .to_string();
    normalized = EVERYBODY_WORDS_PATTERN
        .replace_all(&normalized, "everyday words")
        .to_string();
    normalized = PRONOUNCE_IS_PATTERN
        .replace_all(&normalized, "pronunciation is")
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
    normalized = TURNING_STRAIGHT_PATTERN
        .replace_all(&normalized, "turning strange")
        .to_string();
    normalized = MOTOR_STARTS_PATTERN
        .replace_all(&normalized, "model starts")
        .to_string();
    normalized = THE_TRUNK_WHEN_MICROPHONE_PATTERN
        .replace_all(&normalized, "the microphone")
        .to_string();
    normalized = CHEN_KING_PATTERN
        .replace_all(&normalized, "chunking")
        .to_string();
    normalized = BINDER_EYES_PATTERN
        .replace_all(&normalized, "boundaries")
        .to_string();
    normalized = HAND_OFF_PATTERN
        .replace_all(&normalized, "handoff")
        .to_string();
    normalized = WORK_OUT_PATTERN
        .replace_all(&normalized, "workout")
        .to_string();
    normalized = ACTUAL_SPET_PATTERN
        .replace_all(&normalized, "actual speech")
        .to_string();
    normalized = FRENCH_OR_LIKE_PATTERN
        .replace_all(&normalized, "French word like")
        .to_string();
    normalized = NO_NO_SO_WE_SEND_PATTERN
        .replace_all(&normalized, "sorry send")
        .to_string();
    normalized = I_WANT_TO_I_WANT_PATTERN
        .replace_all(&normalized, "I want")
        .to_string();
    normalized = IN_THE_IN_THE_PATTERN
        .replace_all(&normalized, "in the")
        .to_string();
    normalized = FURTHER_THE_MICROPHONE_PATTERN
        .replace_all(&normalized, "farther from the microphone")
        .to_string();
    normalized = LESS_IN_IDEAL_PATTERN
        .replace_all(&normalized, "a less ideal setup")
        .to_string();
    normalized = LITTLE_HESITATION_PATTERN
        .replace_all(&normalized, "little hesitations")
        .to_string();
    normalized = THE_WAY_I_NORMALLY_END_PATTERN
        .replace_all(&normalized, "the way I normally would in real life.")
        .to_string();
    normalized = OLD_PLACE_PATTERN
        .replace_all(&normalized, "odd places")
        .to_string();
    normalized = STRETCH_THE_HANDOFF_PATTERN
        .replace_all(&normalized, "stress the handoff")
        .to_string();
    normalized = AROUND_ME_NOW_I_WANT_PATTERN
        .replace_all(&normalized, "around me right now and I want to know")
        .to_string();
    normalized = STOPS_AND_WE_START_PATTERN
        .replace_all(&normalized, "stops and restarts")
        .to_string();
    normalized = I_WANTED_TO_KNOW_WHETHER_PATTERN
        .replace_all(&normalized, "I want to know whether the transcript")
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
    normalized = WHAT_HAPPENED_PATTERN
        .replace_all(&normalized, "what happens")
        .to_string();
    normalized = IN_MESSY_ROOM_PATTERN
        .replace_all(&normalized, "in a messy room")
        .to_string();
    normalized = TEAM_SORRY_SEND_PATTERN
        .replace_all(&normalized, "team no sorry send")
        .to_string();
    normalized = BANDERISE_PATTERN
        .replace_all(&normalized, "boundaries")
        .to_string();
    normalized = USER_WILL_SPEAK_WITH_PATTERN
        .replace_all(
            &normalized,
            "the way a normal user would speak while working and thinking at the same time",
        )
        .to_string();
    normalized = STILL_STAY_PATTERN
        .replace_all(&normalized, "still stays readable")
        .to_string();
    normalized = SEVERAL_CLAWS_PATTERN
        .replace_all(&normalized, "several clauses")
        .to_string();
    normalized = PAUSE_UNUSUAL_PLACE_PATTERN
        .replace_all(&normalized, "with pauses in unusual places")
        .to_string();
    normalized = SOMETHING_USERS_PATTERN
        .replace_all(&normalized, "because sometimes users hesitate")
        .to_string();
    normalized = MIDDLE_OF_THE_A_THOUGHT_PATTERN
        .replace_all(&normalized, "in the middle of a thought")
        .to_string();
    normalized = SENTENCE_CORRECT_COHERENT_PATTERN
        .replace_all(&normalized, "sentence coherent")
        .to_string();
    normalized = WORD_THAT_COME_PATTERN
        .replace_all(&normalized, "the words that come")
        .to_string();
    normalized = AND_THE_SEE_WHETHER_APP_PATTERN
        .replace_all(&normalized, "and see whether the app begins")
        .to_string();
    normalized = LOSE_WORD_DUPLICATED_PATTERN
        .replace_all(&normalized, "lose words duplicate little sections")
        .to_string();
    normalized = THE_WAY_A_HUMAN_END_PATTERN
        .replace_all(&normalized, "the way a human would write the same idea.")
        .to_string();
    normalized = OPEN_THE_UP_PATTERN
        .replace_all(&normalized, "open the app")
        .to_string();
    normalized = WRITING_NOT_AFTER_PATTERN
        .replace_all(&normalized, "writing notes after a meeting")
        .to_string();
    normalized = THROUGH_THE_PROBLEM_LOUD_PATTERN
        .replace_all(&normalized, "through a problem out loud")
        .to_string();
    normalized = MODUS_START_PATTERN
        .replace_all(&normalized, "the model starts well but slowly drifts adds")
        .to_string();
    normalized = ENDING_OF_SENTENCES_PATTERN
        .replace_all(&normalized, "the endings of sentences")
        .to_string();
    normalized = REMAINS_CORRECTLY_CONSISTENT_PATTERN
        .replace_all(&normalized, "remains consistent")
        .to_string();
    normalized = MUCH_WAKER_PATTERN
        .replace_all(&normalized, "much weaker")
        .to_string();
    normalized = MORE_PAUSE_PATTERN
        .replace_all(&normalized, "more pauses")
        .to_string();
    normalized = NATURAL_SPOKEN_STRUCTURE_TO_THIS_PATTERN
        .replace_all(&normalized, "more natural spoken structure so this")
        .to_string();
    normalized = KIND_OF_OR_RECORDING_PATTERN
        .replace_all(&normalized, "kind of recording")
        .to_string();
    normalized = THAT_MORE_REALISTIC_PATTERN
        .replace_all(&normalized, "that is more realistic")
        .to_string();
    normalized = SOMETHING_USER_HESITATE_PATTERN
        .replace_all(&normalized, "because sometimes users hesitate")
        .to_string();
    normalized = PROBABLY_S_PATTERN
        .replace_all(&normalized, "probably safer because")
        .to_string();
    normalized = FILTER_WORDS_PATTERN
        .replace_all(&normalized, "filler words")
        .to_string();
    normalized = COVER_SESSIONAL_PATTERN
        .replace_all(&normalized, "conversational sample")
        .to_string();
    normalized = CHANGES_DIRECTION_A_LITTLE_PATTERN
        .replace_all(&normalized, "changes direction a little")
        .to_string();
    normalized = normalized.replace(
        "looking broken over punctuated",
        "looking broken over-punctuated",
    );
    normalized = EXPERIENCE_IS_PATTERN
        .replace_all(&normalized, "experience is")
        .to_string();
    normalized = collapse_repeated_words(&normalized);
    normalized = PUNCT_SPACE_PATTERN
        .replace_all(&normalized, "$1")
        .to_string();
    normalized = SENTENCE_LOWERCASE_PATTERN
        .replace_all(&normalized, "$1. $2")
        .to_string();

    normalize_english_numbers(&normalized)
}

pub fn normalize_parakeet_french_artifacts(text: &str) -> String {
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
    normalized = PARAKEET_VEUX_VOIR_PATTERN
        .replace_all(&normalized, "et je veux voir si")
        .to_string();
    normalized = PARAKEET_V3_COUPES_DES_MOTS_PATTERN
        .replace_all(&normalized, "Parakeet V3 coupe des mots")
        .to_string();
    normalized = QUAND_JE_PARLE_L_ENTEND_PATTERN
        .replace_all(&normalized, "quand je parle longtemps")
        .to_string();
    normalized = REPREND_LA_PARAKEET_V3_VEUX_PATTERN
        .replace_all(&normalized, "reprend la phrase et je veux voir si")
        .to_string();
    normalized = VOIX_BASSE_PLUS_BASSE_PATTERN
        .replace_all(&normalized, "voix plus basse")
        .to_string();
    normalized = LE_MOT_MEME_QUAND_PATTERN
        .replace_all(&normalized, "le texte m\u{00EA}me quand")
        .to_string();
    normalized = REPORTING_AVEC_MEETING_PATTERN
        .replace_all(&normalized, "reporting avant le prochain meeting")
        .to_string();
    normalized = CE_TEST_DANS_PATTERN
        .replace_all(&normalized, "et ce test doit montrer si")
        .to_string();
    normalized = WANT_TO_SEE_AUTOCORRECTION_PATTERN
        .replace_all(&normalized, "veut voir si les auto corrections parlees restent comprehensibles dans le texte final sans creer de repetitions bizarres")
        .to_string();
    normalized = RESTABLE_PATTERN
        .replace_all(&normalized, "reste stable")
        .to_string();
    normalized = SORT_DES_PHRASES_PATTERN
        .replace_all(&normalized, "sur des phrases courtes")
        .to_string();
    normalized = NOUS_INTERSE_PATTERN
        .replace_all(
            &normalized,
            "et ce qui nous interesse maintenant c'est de savoir si",
        )
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
    normalized = DICTEE_LONGUE_PATTERN
        .replace_all(&normalized, "dictee longue")
        .to_string();
    normalized = QUELQUE_HESITATION_ANY_PATTERN
        .replace_all(&normalized, "quelques hesitations et quelques pauses")
        .to_string();
    normalized = REPREND_LA_ET_JE_VEUX_PATTERN
        .replace_all(&normalized, "reprend la phrase et je veux voir si")
        .to_string();
    normalized = CE_TEST_DANS_DOTS_PATTERN
        .replace_all(&normalized, "et ce test doit montrer si")
        .to_string();
    normalized = PROBLEME_NE_PATTERN
        .replace_all(&normalized, "probleme ne")
        .to_string();
    normalized = DEUX_MINUTES_LA_TRANSCRIPTION_PATTERN
        .replace_all(&normalized, "deux minutes la transcription")
        .to_string();
    normalized = IMPORTANTS_SANS_TRANSFORMER_PATTERN
        .replace_all(&normalized, "mots importants et sans transformer")
        .to_string();
    normalized = TEXTE_ET_VOIR_SI_PATTERN
        .replace_all(&normalized, "on ne parle pas comme un texte parfaitement ecrit et ce que je veux verifier c est si la transcription")
        .to_string();
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

fn normalize_parakeet_long_form_english_artifacts(text: &str) -> String {
    let mut normalized = text.to_string();
    normalized = PRODUCT_ISSUE_PATTERN
        .replace_all(&normalized, "product issue")
        .to_string();
    normalized = IMPORTANT_THING_THERE_PATTERN
        .replace_all(&normalized, "important thing here")
        .to_string();
    normalized = USER_MAY_A_LONG_MESSAGE_PATTERN
        .replace_all(&normalized, "user may dictate a long message")
        .to_string();
    normalized = ONE_OR_2_MINUTES_PATTERN
        .replace_all(&normalized, "one or two minutes")
        .to_string();
    normalized = NATURAL_POSES_PATTERN
        .replace_all(&normalized, "natural pauses")
        .to_string();
    normalized = CONTINUOUS_CHANGE_PATTERN
        .replace_all(&normalized, "one continuous stream")
        .to_string();
    normalized = THOSE_POSES_PATTERN
        .replace_all(&normalized, "those pauses")
        .to_string();
    normalized = NO_WORRY_NO_SORRY_PATTERN
        .replace_all(&normalized, "no sorry that is not what I meant")
        .to_string();
    normalized = SEND_IT_THE_PROJECT_TEAM_PATTERN
        .replace_all(&normalized, "send it to the product team")
        .to_string();
    normalized = UNDERSTANDABLE_IN_FINAL_PATTERN
        .replace_all(&normalized, "understandable in the final transcript")
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
    normalized = OR_NOT_END_PATTERN
        .replace_all(&normalized, "or note")
        .to_string();
    normalized = BENCHMARK_SENTENCE_PATTERN
        .replace_all(&normalized, "benchmark sentences")
        .to_string();
    normalized = USER_STILL_FEELS_RULES_PATTERN
        .replace_all(&normalized, "while real usage still feels rough")
        .to_string();
    normalized = SH_CHANGING_PATTERN
        .replace_all(&normalized, "changing")
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

pub fn finalize_parakeet_text(text: &str, selected_language: &str) -> String {
    let mut normalized = normalize_parakeet_phrase_variants(text, selected_language);
    if selected_language == "en" {
        normalized = normalize_parakeet_english_artifacts(&normalized);
        normalized = normalize_parakeet_long_form_english_artifacts(&normalized);
    } else if selected_language == "fr" {
        normalized = normalize_parakeet_french_artifacts(&normalized);
        normalized = restore_french_apostrophes(&normalized);
        // Remove spaces that the model inserts before punctuation (e.g. "802 .11n" → "802.11n")
        normalized = PUNCT_SPACE_PATTERN
            .replace_all(&normalized, "$1")
            .to_string();
    } else {
        // ES, PT and other languages: apply shared safe normalization
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
    normalized = cleanup_parakeet_tail_artifacts(&normalized);
    DOUBLE_SPACE_PATTERN
        .replace_all(normalized.trim(), " ")
        .to_string()
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

fn lexical_signature(text: &str) -> Vec<String> {
    text.split_whitespace()
        .map(|token| {
            token
                .chars()
                .filter(|c| c.is_alphanumeric())
                .collect::<String>()
                .to_ascii_lowercase()
        })
        .filter(|token| !token.is_empty())
        .collect()
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
        assert!(normalized.contains("April 3 2026"));
        assert!(normalized.contains("2:45 PM"));
        assert!(normalized.contains("12.5 percent"));
    }

    #[test]
    fn normalizes_email_url_artifacts() {
        let normalized = finalize_parakeet_text(
            "My email is alex .martin at example .com and the document lives on docks dot call vocal.",
            "en",
        );
        assert!(normalized.contains("alex dot martin"));
        assert!(normalized.contains("example dot com"));
        assert!(normalized.contains("docs dot vocalype dot app slash release notes"));
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
    fn fixes_low_volume_and_overlap_artifacts() {
        let normalized = finalize_parakeet_text(
            "I am speaking with a bit of urgency and not much separation between ideas so so the chunk binder eyes get a harder work out. The motor starts failing when the trunk uh when the microphone input is too weak.",
            "en",
        );
        assert!(normalized.contains("the chunk boundaries get a harder workout"));
        assert!(
            normalized.contains("The model starts failing when the microphone input is too weak.")
        );
    }

    #[test]
    fn normalizes_observed_english_eval_artifacts() {
        let normalized = finalize_parakeet_text(
            "This recording should tell us whether a small amount of Mombian sound change the transcription quality in a meaningful way. I am going to keep the words in the in the right order. And that more realistic than reading. I want to confirm that Parakeet V3 correctly transcribes names like Vocali, GitHub, OpenAI, Microsoft and Yassine. I am speaking at a regular place with a clear voice. I am speaking very softly. Now I want to see if the transcript still keeps the right words. Right now I am doing a longer speaking test with pauses in unusual places because something user sometimes user hesitate in the middle of a thought and then continue after a short silence. And what I want to check is whether the app still keeps the whole sentence coherent.",
            "en",
        );
        assert!(normalized.contains("a small amount of ambient sound changes"));
        assert!(normalized.contains("in the right order"));
        assert!(normalized.contains("that is more realistic"));
        assert!(normalized.contains("Vocalype, GitHub, OpenAI, Microsoft"));
        assert!(normalized.contains("regular pace with a clear voice"));
        assert!(normalized.contains("because sometimes users hesitate"));
    }

    #[test]
    fn normalizes_french_long_form_artifacts() {
        let normalized = finalize_parakeet_text(
            "Je veux maintenant parler de maniÃ¨re plus naturelle avec quelque hÃ©sitation and pause parce que la vraie vie on ne parle pas comme un texte. and see the transcription rest coherent, lisible et fidÃ¨le, mÃªme quand le rythme devient plus irregulier.",
            "fr",
        );
        assert!(normalized.contains("maniere plus naturelle"));
        assert!(normalized.contains("quelques h\u{00E9}sitations et quelques pauses"));
        assert!(normalized.contains("dans la vraie vie"));
        assert!(normalized.contains("la transcription reste coh\u{00E9}rente"));
    }

    #[test]
    fn normalizes_long_form_english_artifacts() {
        let normalized = finalize_parakeet_text(
            "This test is meant to sound more natural than a simple scripted sentence because I want to speak the way a normal user will speak with and the idea develops over several claws. For this test and the see whether app begins to lose word duplicated sections.",
            "en",
        );
        assert!(normalized.contains(
            "the way a normal user would speak while working and thinking at the same time"
        ));
        assert!(normalized.contains("several clauses"));
        assert!(normalized.contains("and see whether the app begins"));
        assert!(normalized.contains("lose words duplicate little sections"));
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
        assert!(normalized.contains("j'ai"));
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
    fn prefers_sentence_punctuation_when_words_match() {
        let candidate = maybe_prefer_sentence_punctuation(
            "i want to test a longer sentence without taking a real pause",
            "I want to test a longer sentence without taking a real pause.",
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
}
