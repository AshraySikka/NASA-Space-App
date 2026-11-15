"""Loads data/processed/*.json. This is the only data the backend ever reads.
If a file is missing the app reports it; it never falls back to placeholder data."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from . import config

REQUIRED = ["sources.json", "chunks.json", "tests.json", "cards.json", "ranges.json", "outcome_map.json", "rating_config.json", "web_context.json"]


class DataMissing(RuntimeError):
    pass


class Store:
    def __init__(self, data_dir: Path):
        missing = [f for f in REQUIRED if not (data_dir / f).exists()]
        if missing:
            raise DataMissing(f"Processed data not found in {data_dir}: {', '.join(missing)}. Run `make ingest` (needs raw_data/).")
        load = lambda n: json.loads((data_dir / n).read_text())  # noqa: E731
        self.sources: list[dict] = load("sources.json")
        self.chunks: list[dict] = load("chunks.json")
        self.tests: list[dict] = load("tests.json")
        self.cards: list[dict] = load("cards.json")
        self.ranges: dict = load("ranges.json")
        self.outcome_map: dict = load("outcome_map.json")
        self.rating_config: dict = load("rating_config.json")
        self.web_context: list[dict] = load("web_context.json")
        self.source_by_id = {s["id"]: s for s in self.sources}
        self.test_by_id = {t["test_id"]: t for t in self.tests}
        self.family_by_phrase = {c["outcome_text"]: c["family"] for c in self.outcome_map["classes"]}
        self.material_groups = [m["material_group"] for m in self.ranges["materials"]]


@lru_cache(maxsize=1)
def get_store() -> Store:
    return Store(config.DATA_DIR)
