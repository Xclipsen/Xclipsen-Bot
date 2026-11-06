import asyncio

import pytest
from fastapi.testclient import TestClient

import main
from engines import Engine


class FakeEngine(Engine):
    engine = "fake"

    def __init__(self):
        self.id = self.label = "fake"
        self.calls = []

    def synthesize(self, text: str) -> bytes:
        self.calls.append(text)
        return b"RIFF" + text.encode()


@pytest.fixture
def engine(monkeypatch):
    fake = FakeEngine()
    monkeypatch.setitem(main.state, "voices", {"fake": fake})
    monkeypatch.setitem(main.state, "default", "fake")
    monkeypatch.setattr(main, "cache", main.LRUCache(16, 1024 * 1024))
    monkeypatch.setattr(main, "synth_lock", asyncio.Lock())
    monkeypatch.setattr(main, "pending", 0)
    return fake


def test_cache_evicts_by_bytes():
    cache = main.LRUCache(100, 400)
    cache.put(("v", "a"), b"x" * 100)
    cache.put(("v", "b"), b"x" * 100)
    cache.put(("v", "c"), b"x" * 100)
    assert cache.bytes == 300
    cache.get(("v", "a"))  # a is now the most recently used
    cache.put(("v", "d"), b"x" * 100)
    cache.put(("v", "e"), b"x" * 100)
    assert cache.get(("v", "b")) is None
    assert cache.get(("v", "a")) is not None
    assert cache.bytes <= 400 and len(cache) == 4
    # Larger than a quarter of the budget: not cached at all.
    cache.put(("v", "big"), b"x" * 101)
    assert cache.get(("v", "big")) is None
    # Replacing an entry does not count it twice.
    cache.put(("v", "a"), b"y" * 50)
    assert cache.bytes == 350


def test_cache_evicts_by_count():
    cache = main.LRUCache(2, 1024)
    for key in "abc":
        cache.put(("v", key), b"x")
    assert len(cache) == 2 and cache.get(("v", "a")) is None


def test_synthesize_normalizes_caps_and_caches(engine, monkeypatch):
    monkeypatch.setattr(main, "MAX_NORMALIZED_CHARS", 60)
    client = TestClient(main.app)
    response = client.post("/synthesize", json={"text": "123 " * 50})
    assert response.status_code == 200
    assert response.headers["X-TTS-Cache"] == "miss"
    spoken = engine.calls[0]
    assert len(spoken) <= 60 and spoken.endswith(" und so weiter")
    again = client.post("/synthesize", json={"text": "123 " * 50})
    assert again.headers["X-TTS-Cache"] == "hit"
    assert len(engine.calls) == 1


def test_synthesize_rejects_when_too_many_pending(engine, monkeypatch):
    monkeypatch.setattr(main, "pending", main.MAX_PENDING)
    response = TestClient(main.app).post("/synthesize", json={"text": "hallo"})
    assert response.status_code == 503
    assert engine.calls == []
    # Cache hits are served even when the queue is full.
    main.cache.put(("fake", "hallo"), b"cached")
    assert TestClient(main.app).post("/synthesize", json={"text": "hallo"}).status_code == 200


def test_pending_counter_is_released(engine):
    client = TestClient(main.app)
    for text in ("eins", "zwei", "drei"):
        assert client.post("/synthesize", json={"text": text}).status_code == 200
    assert main.pending == 0
