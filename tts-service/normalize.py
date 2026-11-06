"""German text normalization for chat messages before TTS.

The bot already strips Discord mentions, links and emojis, so this only
handles what is left in ordinary chat text: chat abbreviations, numbers,
stretched words and characters a TTS engine cannot speak.
"""

from __future__ import annotations

import logging
import os
import re
from pathlib import Path

from num2words import num2words

# English voices only get the language-neutral ones; the rest is meant for German voices.
ABBREVIATIONS_EN: dict[str, str] = {
    "gg": "g g",
    "ggs": "g g s",
    "afk": "a f k",
    "brb": "be right back",
    "idk": "I don't know",
    "wtf": "w t f",
    "k": "okay",
    "kk": "okay",
    "ok": "okay",
    "np": "no problem",
    "ty": "thank you",
    "thx": "thanks",
    "pls": "please",
    "plz": "please",
    "irl": "in real life",
    "imo": "in my opinion",
}

log = logging.getLogger("tts.normalize")

PRONUNCIATION_FILES = (
    Path(__file__).with_name("pronunciation.txt"),
    Path(os.environ.get("TTS_PRONUNCIATION_FILE", "/voices/pronunciation.txt")),
)
ABBREVIATION_FILES = (
    Path(__file__).with_name("abbreviations.txt"),
    Path(os.environ.get("TTS_ABBREVIATION_FILE", "/voices/abbreviations.txt")),
)


def load_word_list(paths) -> dict[str, str]:
    """<word or phrase> = <replacement> lines; later files override earlier ones."""
    entries: dict[str, str] = {}
    for path in paths:
        try:
            if not path.is_file():
                continue
            lines = path.read_text(encoding="utf-8").splitlines()
        except OSError as error:
            log.warning("cannot read pronunciation file %s: %s", path, error)
            continue
        for number, line in enumerate(lines, 1):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            word, sep, spelling = line.partition("=")
            if not sep or not word.strip() or not spelling.strip():
                log.warning("%s:%d: expected '<word> = <replacement>'", path, number)
                continue
            entries[" ".join(word.lower().split())] = spelling.strip()
    return entries


def _pronunciation_pattern(entries: dict[str, str]) -> re.Pattern[str] | None:
    if not entries:
        return None
    # Longest first so "golden dragon" wins over "dragon"; spaces match any whitespace.
    words = sorted(entries, key=len, reverse=True)
    alternatives = "|".join(r"\s+".join(map(re.escape, word.split())) for word in words)
    return re.compile(rf"(?<!\w)(?:{alternatives})(?!\w)", re.IGNORECASE)


# German chat abbreviations (abbreviations.txt); English voices use ABBREVIATIONS_EN.
ABBREVIATIONS = load_word_list(ABBREVIATION_FILES)
PRONUNCIATIONS = load_word_list(PRONUNCIATION_FILES)
_PRONUNCIATION_RE = _pronunciation_pattern(PRONUNCIATIONS)


def _pronounce(match: re.Match[str]) -> str:
    return PRONUNCIATIONS[" ".join(match.group(0).lower().split())]


# Symbols that have a spoken form; everything else unspeakable is dropped.
SYMBOLS: dict[str, str] = {
    "&": " und ",
    "+": " plus ",
    "%": " Prozent ",
    "€": " Euro ",
    "$": " Dollar ",
    "°": " Grad ",
}
SYMBOLS_EN: dict[str, str] = {
    "&": " and ",
    "+": " plus ",
    "%": " percent ",
    "€": " euros ",
    "$": " dollars ",
    "°": " degrees ",
}
# Words for the decimal separator per language.
DECIMAL_WORD = {"de": "Komma", "en": "point"}
# Spoken after a cut: overlong digit runs and over-long normalized text.
AND_SO_ON = {"de": "und so weiter", "en": "and so on"}
MONTHS = {
    "de": (
        "Januar", "Februar", "März", "April", "Mai", "Juni",
        "Juli", "August", "September", "Oktober", "November", "Dezember",
    ),
    "en": (
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    ),
}

def _amount(match: re.Match[str], lang: str) -> str:
    value, unit = match.group(1), match.group(2).lower()
    singular, plural = AMOUNT_UNITS[lang][unit]
    if value == "1" and unit != "k":
        return f" {'eine' if lang == 'de' else 'one'} {singular} "
    return f" {value} {plural} "


# Integers with digits read as one number up to this length; longer runs
# (IDs, phone numbers, keyboard mashing) are read digit by digit.
MAX_NUMBER_DIGITS = 12
# Digit runs longer than this are cut: the first CUT_DIGITS digits, then "und so weiter".
MAX_SPOKEN_DIGITS = 20
CUT_DIGITS = 6

_REPEAT_RE = re.compile(r"(\D)\1{3,}")
_XD_RE = re.compile(r"\bx+d+\b", re.IGNORECASE)
_LOL_RE = re.compile(r"\blo+l+\b", re.IGNORECASE)
# Letters and digits, so abbreviations like "f7" or "m7" match as one token.
_WORD_RE = re.compile(r"\b[^\W_]+\b")
# Coin amounts as SkyBlock chat writes them: 500k, 1m, 2.5b, 1,5m.
_AMOUNT_RE = re.compile(r"(?<![\w.,])(\d+(?:[.,]\d+)?)([kmb])\b", re.IGNORECASE)
# "500 k": joined to "500k" before the abbreviations, so the "k" is not read as "okay".
_SPACED_AMOUNT_RE = re.compile(r"(?<![\w.,])(\d+(?:[.,]\d+)?)\s([kmb])\b", re.IGNORECASE)
# Stack counts: 64x or x64.
_MULTIPLIER_RE = re.compile(r"\b(?:(\d+)x|x(\d+))\b", re.IGNORECASE)
MULTIPLIER_WORD = {"de": "mal", "en": "times"}
AMOUNT_UNITS = {
    "de": {"k": ("k", "k"), "m": ("Million", "Millionen"), "b": ("Milliarde", "Milliarden")},
    "en": {"k": ("k", "k"), "m": ("million", "million"), "b": ("billion", "billion")},
}
# German dates: 06.11.2026, 6.11.26, 6.11. (day and month are range-checked in _date).
_DATE_RE = re.compile(r"(?<![\w.,])(\d{1,2})\.(\d{1,2})\.(?:(\d{4}|\d{2})(?![\w,]|\.\d))?(?![\w,])")
# Clock times: 5:30, 17:05, "5:30 Uhr" (hours 0-23, minutes 00-59 are checked in _time).
_TIME_RE = re.compile(r"(?<![\w.,:])(\d{1,2}):(\d{2})(?![\w:]|[.,]\d)(\s+Uhr\b)?")
# Words before a date that take the "-n" ending: "am sechsten November".
_DATIVE_WORDS = {"am", "vom", "zum", "dem", "den", "beim", "bis", "ab", "seit"}
# 1.000.000 style thousands separators (German).
_THOUSANDS_RE = re.compile(r"(?<![\d.,])\d{1,3}(?:\.\d{3})+(?![\d,]|\.\d)")
# Optional minus, integer part, optional decimal part ("3,5" or "3.5").
_NUMBER_RE = re.compile(r"(-)?(\d+)(?:[.,](\d+))?")
_UNSPEAKABLE_RE = re.compile(r"[^\w\s.,!?;:'\"()\-]|_")
_SPACE_RE = re.compile(r"\s+")
_SPACE_BEFORE_PUNCT_RE = re.compile(r"\s+([.,!?;:])")


def _digits(digits: str, lang: str) -> str:
    suffix = ""
    if len(digits) > MAX_SPOKEN_DIGITS:
        digits, suffix = digits[:CUT_DIGITS], f" {AND_SO_ON[lang]}"
    return " ".join(num2words(int(d), lang=lang) for d in digits) + suffix


def _date(match: re.Match[str], lang: str) -> str:
    day, month, year = int(match.group(1)), int(match.group(2)), match.group(3)
    if not (1 <= day <= 31 and 1 <= month <= 12):
        return match.group(0)
    ordinal = num2words(day, lang=lang, to="ordinal")
    month_name = MONTHS[lang][month - 1]
    if lang == "de":
        before = match.string[: match.start()].split()
        previous = before[-1].lower() if before else ""
        ordinal += "n" if previous in _DATIVE_WORDS else "" if previous in ("der", "die", "das") else "r"
        words = f"{ordinal} {month_name}"
    else:
        words = f"{ordinal} of {month_name}"
    if year:
        words += " " + (num2words(int(year), lang=lang, to="year") if len(year) == 4 else num2words(int(year), lang=lang))
    return f" {words} "


def _time(match: re.Match[str], lang: str) -> str:
    hour, minute = int(match.group(1)), int(match.group(2))
    if hour > 23 or minute > 59:
        return match.group(0)
    if lang == "en":
        if minute == 0:
            return f" {num2words(hour, lang='en')} o'clock "
        minutes = num2words(minute, lang="en") if minute >= 10 else f"oh {num2words(minute, lang='en')}"
        return f" {num2words(hour, lang='en')} {minutes} "
    words = f"{'ein' if hour == 1 else num2words(hour, lang='de')} Uhr"
    if minute:
        words += f" {num2words(minute, lang='de')}"
    return f" {words} "


def truncate(text: str, max_chars: int, language: str = "de") -> str:
    """Cut normalized text to at most max_chars at a word boundary, ending in "und so weiter"."""
    if max_chars <= 0 or len(text) <= max_chars:
        return text
    suffix = " " + AND_SO_ON["en" if language == "en" else "de"]
    cut = text[: max(0, max_chars - len(suffix)) + 1]
    # Drop the (possibly partial) last word, unless the cut already ends at a space.
    cut = cut.rsplit(" ", 1)[0] if " " in cut else ""
    cut = cut.rstrip(" ,;:-")
    return (cut + suffix).strip()


def _integer(digits: str, lang: str) -> str:
    if len(digits) > MAX_NUMBER_DIGITS:
        return _digits(digits, lang)
    return num2words(int(digits), lang=lang)


def _number(match: re.Match[str], lang: str = "de") -> str:
    sign, whole, frac = match.group(1), match.group(2), match.group(3)
    start = match.start()
    text = match.string
    # A minus only counts as a sign at a word start ("-5", "(-5"), not "3-5".
    if sign and start > 0 and not text[start - 1].isspace() and text[start - 1] != "(":
        prefix = "-"
        sign = None
    else:
        prefix = ""
    words = _integer(whole, lang)
    if frac is not None:
        words = f"{words} {DECIMAL_WORD[lang]} {_digits(frac, lang)}"
    if sign:
        words = f"minus {words}"
    return f"{prefix} {words} "


def normalize(text: str, language: str = "de") -> str:
    """Return speakable text for a German ("de") or English ("en") voice, or "" if nothing is left."""
    if not text:
        return ""
    lang = "en" if language == "en" else "de"
    abbreviations = ABBREVIATIONS_EN if lang == "en" else ABBREVIATIONS
    symbols = SYMBOLS_EN if lang == "en" else SYMBOLS

    # "jaaaaaa" -> "jaaa", "!!!!!!" -> "!!!"; digits are left alone.
    text = _REPEAT_RE.sub(lambda m: m.group(1) * 3, text)

    text = _XD_RE.sub(" ex dee " if lang == "en" else " iks de ", text)
    text = _LOL_RE.sub("lol", text)
    text = _SPACED_AMOUNT_RE.sub(r"\1\2", text)
    text = _WORD_RE.sub(lambda m: abbreviations.get(m.group(0).lower(), m.group(0)), text)
    # After the abbreviations, so the "k" of "500k" is not read as "okay".
    text = _AMOUNT_RE.sub(lambda m: _amount(m, lang), text)
    text = _MULTIPLIER_RE.sub(lambda m: f" {m.group(1) or m.group(2)} {MULTIPLIER_WORD[lang]} ", text)
    # The spelling list makes German voices say English words; English voices say them anyway.
    if lang == "de" and _PRONUNCIATION_RE is not None:
        text = _PRONUNCIATION_RE.sub(_pronounce, text)

    for symbol, spoken in symbols.items():
        text = text.replace(symbol, spoken)

    text = _DATE_RE.sub(lambda m: _date(m, lang), text)
    text = _TIME_RE.sub(lambda m: _time(m, lang), text)
    text = _THOUSANDS_RE.sub(lambda m: m.group(0).replace(".", ""), text)
    text = _NUMBER_RE.sub(lambda m: _number(m, lang), text)

    text = _UNSPEAKABLE_RE.sub(" ", text)
    text = _SPACE_RE.sub(" ", text)
    text = _SPACE_BEFORE_PUNCT_RE.sub(r"\1", text).strip()

    # Pure punctuation is not worth synthesizing.
    if not re.search(r"[^\W_]", text):
        return ""
    return text
