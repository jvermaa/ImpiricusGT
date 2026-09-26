"""All distance logic goes through a ProximityProvider. Nothing else reads
distance_miles directly, so the real implementation (Part 2) can replace the
hardcoded one without changing any API response."""
from functools import lru_cache
from typing import Protocol

from .. import config


class ProximityProvider(Protocol):
    name: str

    def distance_miles(self, origin_hcp_id: str | None, provider: dict) -> float | None:
        """Miles from the requesting HCP to this provider. None = unknown."""


class HardcodedProximity:
    """DEMO ONLY. Returns the fixture's distance_miles regardless of origin.
    Valid only because every demo request comes from hcp_demo."""
    name = "hardcoded"

    def distance_miles(self, origin_hcp_id, provider):
        return provider.get("distance_miles")


@lru_cache(maxsize=1)
def get_proximity() -> ProximityProvider:
    if config.PROXIMITY == "hardcoded":
        return HardcodedProximity()
    # Part 2: HaversineProximity(locate=...) goes here.
    raise RuntimeError(f"Unknown PCX_PROXIMITY={config.PROXIMITY!r}; only 'hardcoded' is implemented")


def distance_band(miles: float | None) -> str:
    if miles is None:
        return "unknown"
    if miles < 5:
        return "nearby"
    if miles <= 15:
        return "in_area"
    if miles <= 50:
        return "regional"
    return "far"
