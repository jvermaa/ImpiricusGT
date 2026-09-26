"""Distance lookup used by the referral directory."""
import math
import os
from collections.abc import Mapping
from functools import lru_cache
from typing import Protocol


class ProximityProvider(Protocol):
    name: str

    def distance_miles(
        self, origin_hcp_id: str | None, provider: object
    ) -> float | None:
        """Miles from the requesting HCP to this provider. None = unknown."""


class HardcodedProximity:
    """Demo-only: returns the distance stored on the provider record."""

    name = "hardcoded"

    def distance_miles(
        self, origin_hcp_id: str | None, provider: object
    ) -> float | None:
        if isinstance(provider, Mapping):
            distance = provider.get("distance_miles")
        else:
            distance = getattr(provider, "distance_miles", None)

        if distance is None or isinstance(distance, bool):
            return None
        if not isinstance(distance, (int, float)):
            return None

        distance = float(distance)
        return distance if math.isfinite(distance) and distance >= 0 else None


@lru_cache(maxsize=1)
def get_proximity() -> ProximityProvider:
    mode = os.getenv("PCX_PROXIMITY", "hardcoded")
    if mode == "hardcoded":
        return HardcodedProximity()

    raise RuntimeError(
        f"Unknown PCX_PROXIMITY={mode!r}; only 'hardcoded' is implemented"
    )


def distance_band(miles: float | None) -> str:
    if miles is None or not math.isfinite(miles) or miles < 0:
        return "unknown"
    if miles < 5:
        return "nearby"
    if miles <= 15:
        return "in_area"
    if miles <= 50:
        return "regional"
    return "far"


