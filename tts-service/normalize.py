"""German text normalization for chat messages before TTS.

The bot already strips Discord mentions, links and emojis, so this only
handles what is left in ordinary chat text: chat abbreviations, numbers,
stretched words and characters a TTS engine cannot speak.
"""

from __future__ import annotations

import re

from num2words import num2words

# Whole-word chat abbreviations (matched case-insensitively).
ABBREVIATIONS: dict[str, str] = {
    "gg": "good game",
    "ggs": "good games",
    "afk": "a f k",
    "brb": "bin gleich zurück",
    "lol": "lol",
    "idk": "keine Ahnung",
    "wtf": "w t f",
    "k": "okay",
    "kk": "okay",
    "ok": "okay",
    "np": "kein Problem",
    "ty": "danke",
    "thx": "danke",
    "pls": "bitte",
    "plz": "bitte",
    "irl": "im echten Leben",
    "imo": "meiner Meinung nach",
}

# Symbols that have a spoken form; everything else unspeakable is dropped.
SYMBOLS: dict[str, str] = {
    "&": " und ",
    "+": " plus ",
    "%": " Prozent ",
    "€": " Euro ",
    "$": " Dollar ",
    "°": " Grad ",
}

# Integers with digits read as one number up to this length; longer runs
# (IDs, phone numbers, keyboard mashing) are read digit by digit.
MAX_NUMBER_DIGITS = 12

_REPEAT_RE = re.compile(r"(\D)\1{3,}")
_XD_RE = re.compile(r"\bx+d+\b", re.IGNORECASE)
_LOL_RE = re.compile(r"\blo+l+\b", re.IGNORECASE)
_WORD_RE = re.compile(r"\b[^\W\d_]+\b")
# 1.000.000 style thousands separators (German).
_THOUSANDS_RE = re.compile(r"(?<![\d.,])\d{1,3}(?:\.\d{3})+(?![\d,]|\.\d)")
# Optional minus, integer part, optional decimal part ("3,5" or "3.5").
_NUMBER_RE = re.compile(r"(-)?(\d+)(?:[.,](\d+))?")
_UNSPEAKABLE_RE = re.compile(r"[^\w\s.,!?;:'\"()\-]|_")
_SPACE_RE = re.compile(r"\s+")
_SPACE_BEFORE_PUNCT_RE = re.compile(r"\s+([.,!?;:])")


def _digits(digits: str) -> str:
    return " ".join(num2words(int(d), lang="de") for d in digits)


def _integer(digits: str) -> str:
    if len(digits) > MAX_NUMBER_DIGITS:
        return _digits(digits)
    return num2words(int(digits), lang="de")


def _number(match: re.Match[str]) -> str:
    sign, whole, frac = match.group(1), match.group(2), match.group(3)
    start = match.start()
    text = match.string
    # A minus only counts as a sign at a word start ("-5", "(-5"), not "3-5".
    if sign and start > 0 and not text[start - 1].isspace() and text[start - 1] != "(":
        prefix = "-"
        sign = None
    else:
        prefix = ""
    words = _integer(whole)
    if frac is not None:
        words = f"{words} Komma {_digits(frac)}"
    if sign:
        words = f"minus {words}"
    return f"{prefix} {words} "


def _abbreviation(match: re.Match[str]) -> str:
    word = match.group(0)
    return ABBREVIATIONS.get(word.lower(), word)


def normalize(text: str) -> str:
    """Return speakable German text, or an empty string if nothing is left."""
    if not text:
        return ""

    # "jaaaaaa" -> "jaaa", "!!!!!!" -> "!!!"; digits are left alone.
    text = _REPEAT_RE.sub(lambda m: m.group(1) * 3, text)

    text = _XD_RE.sub(" iks de ", text)
    text = _LOL_RE.sub("lol", text)
    text = _WORD_RE.sub(_abbreviation, text)

    for symbol, spoken in SYMBOLS.items():
        text = text.replace(symbol, spoken)

    text = _THOUSANDS_RE.sub(lambda m: m.group(0).replace(".", ""), text)
    text = _NUMBER_RE.sub(_number, text)

    text = _UNSPEAKABLE_RE.sub(" ", text)
    text = _SPACE_RE.sub(" ", text)
    text = _SPACE_BEFORE_PUNCT_RE.sub(r"\1", text).strip()

    # Pure punctuation is not worth synthesizing.
    if not re.search(r"[^\W_]", text):
        return ""
    return text
