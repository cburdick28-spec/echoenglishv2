"""Shared pytest fixtures: fake environment, fake Supabase, and an API test client."""

import os
from types import SimpleNamespace as NS
from unittest.mock import MagicMock

import pytest

# Must be set before `index` is imported (the AI provider is chosen at import time).
os.environ.update(
    GROQ_API_KEY="test-key",
    SUPABASE_URL="https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY="test-service-key",
    MANAGER_EMAILS="Boss@Corp.com, other@corp.com",
)

import index  # noqa: E402  (import after env setup)
from fastapi.testclient import TestClient  # noqa: E402

TOKENS = {"emp": "Emp@Corp.com", "boss": "boss@corp.com", "emp2": "emp2@corp.com"}


class FakeSupabase:
    """Just enough of the Supabase client for the API under test."""

    def __init__(self) -> None:
        self.inserted: list[dict] = []
        self.auth = MagicMock()
        self.auth.get_user = self._get_user

    @staticmethod
    def _get_user(token: str):
        if token in TOKENS:
            return NS(user=NS(id=f"id-{token}", email=TOKENS[token]))
        raise Exception("invalid jwt")

    def table(self, _name: str):
        fake = self

        class Table:
            def insert(self, row):
                fake.inserted.append(row)
                return MagicMock()

        return Table()


@pytest.fixture(autouse=True)
def fake_supabase(monkeypatch):
    fake = FakeSupabase()
    monkeypatch.setattr(index, "_supabase", fake)
    index._recent_requests.clear()
    return fake


@pytest.fixture
def client():
    return TestClient(index.app)


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


AUDIO = {"audio": ("rec.webm", b"x" * 2000, "audio/webm;codecs=opus")}
