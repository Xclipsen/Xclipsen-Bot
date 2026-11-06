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
        ("gg", "dschi dschi"),
        ("GG ez", "dschi dschi iesi"),
        ("bin afk", "bin a ef ka"),
        ("brb", "bin gleich zurück"),
        ("idk", "keine Ahnung"),
        ("wtf", "we te ef"),
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
        "dschi dschi, das waren fünfzehn Kills in zwei Komma fünf Minuten!!!"
    )


def test_pronunciation_entries_are_spelled_out():
    assert normalize("Wer kommt mit in die Dungeons?") == "Wer kommt mit in die dandschens?"
    assert normalize("Mein Golden  Dragon und ein dragon") == "Mein golden dräggen und ein dräggen"
    # Only whole words: "gamesense" stays as it is.
    assert normalize("gamesense") == "gamesense"


def test_pronunciation_files_override_and_skip_bad_lines(tmp_path):
    from normalize import load_word_list

    base = tmp_path / "base.txt"
    base.write_text("# comment\nslayer = sleier\nkaputt\n", encoding="utf-8")
    extra = tmp_path / "extra.txt"
    extra.write_text("Slayer = släjer\nCrimson   Isle = krimsen eil\n", encoding="utf-8")

    assert load_word_list((base, extra, tmp_path / "missing.txt")) == {
        "slayer": "släjer",
        "crimson isle": "krimsen eil",
    }


def test_english_voices_get_english_numbers_and_no_spelling_list():
    assert normalize("gg, 3 Dungeons for 2.5 coins & brb", "en") == (
        "g g, three Dungeons for two point five coins and be right back"
    )


def test_abbreviations_are_written_out_and_pronounced():
    assert normalize("vllt hab ich nen zweiten acc, kp") == "vielleicht hab ich nen zweiten äkaunt, kein Plan"
    assert normalize("gl hf") == "gud lack häw fann"


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("500k", "fünfhundert k"),
        ("1m", "eine Million"),
        ("2.5b", "zwei Komma fünf Milliarden"),
        ("für 1,5m verkauft", "für eins Komma fünf Millionen verkauft"),
        ("Ich bin 5 min weg", "Ich bin fünf minuten weg"),
    ],
)
def test_coin_amounts(text, expected):
    assert normalize(text) == expected


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("gg m7 und f7", "dschi dschi master mohd sieben und flohr sieben"),
        ("hotm7 fertig", "haart of de mauntn sieben fertig"),
        ("64x enchanted", "vierundsechzig mal entschäntet"),
        ("wtb aotv", "wont to bai äspekt of de weud"),
        # German words with English twins stay untouched outside the listed phrases.
        ("Die nächste Phase war privat, Chance auf Mode", "Die nächste Phase war privat, Chance auf Mode"),
    ],
)
def test_skyblock_terms(text, expected):
    assert normalize(text) == expected
