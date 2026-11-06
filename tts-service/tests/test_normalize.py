import pytest

from normalize import normalize


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Ich habe 3 Katzen", "Ich habe drei Katzen"),
        ("42", "zweiundvierzig"),
        ("Es ist 2026", "Es ist zweitausendsechsundzwanzig"),
        ("Das kostet 3,5 Euro", "Das kostet drei Komma fünf Euro"),
        ("Pi ist 3.14", "Pi ist drei Komma eins vier"),
        ("1.000.000 Leute", "eine Million Leute"),
        ("Es sind -5 Grad", "Es sind minus fünf Grad"),
        ("50%", "fünfzig Prozent"),
        ("10€", "zehn Euro"),
    ],
)
def test_numbers(text, expected):
    assert normalize(text) == expected


def test_long_digit_runs_are_read_digit_by_digit():
    assert normalize("1234567890123") == (
        "eins zwei drei vier fünf sechs sieben acht neun null eins zwei drei"
    )


def test_range_dash_is_not_a_minus():
    assert "minus" not in normalize("3-5 Spieler")


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("gg", "good game"),
        ("GG ez", "good game ez"),
        ("bin afk", "bin a f k"),
        ("brb", "bin gleich zurück"),
        ("idk", "keine Ahnung"),
        ("wtf", "w t f"),
        ("k", "okay"),
        ("ok", "okay"),
        ("np", "kein Problem"),
        ("ty", "danke"),
        ("thx", "danke"),
        ("pls", "bitte"),
        ("plz komm", "bitte komm"),
        ("irl", "im echten Leben"),
        ("imo ja", "meiner Meinung nach ja"),
        ("xd", "iks de"),
        ("XDDD", "iks de"),
        ("loool", "lol"),
    ],
)
def test_abbreviations(text, expected):
    assert normalize(text) == expected


def test_abbreviations_only_match_whole_words():
    assert normalize("Egge") == "Egge"
    assert normalize("Kartoffel") == "Kartoffel"
    assert normalize("tyrann") == "tyrann"


def test_repeated_characters_are_collapsed():
    assert normalize("jaaaaaaaa") == "jaaa"
    assert normalize("neiiiin!!!!!!") == "neiiin!!!"
    assert normalize("Moin") == "Moin"


def test_repeated_digits_are_kept():
    assert normalize("10000") == "zehntausend"


def test_unspeakable_characters_are_removed():
    assert normalize("hallo ~~ welt #^*") == "hallo welt"
    assert normalize("snake_case") == "snake case"
    assert normalize("Grüße, Straße!") == "Grüße, Straße!"


def test_ampersand_and_plus():
    assert normalize("du & ich") == "du und ich"
    assert normalize("2+2") == "zwei plus zwei"


@pytest.mark.parametrize("text", ["", "   ", "!!!", "~~~", "..."])
def test_nothing_speakable(text):
    assert normalize(text) == ""


def test_full_sentence():
    assert normalize("gg, das waren 15 Kills in 2,5 Minuten!!!!!") == (
        "good game, das waren fünfzehn Kills in zwei Komma fünf Minuten!!!"
    )
