from sqlalchemy.orm import Session

from app.models.asset import Asset
from app.schemas.decision import PlantImpactData
from app.services.asset_service import AssetService
from app.services.plant_graph_service import PlantGraphService


class PlantImpactEngine:
    """Uses the existing plant graph to quantify downstream production impact."""

    def __init__(self, db: Session, graph_service: PlantGraphService | None = None) -> None:
        self.asset_service = AssetService(db)
        self.graph_service = graph_service or PlantGraphService()

    def analyze_impact(self, asset_id: str, asset_map: dict[str, Asset] | None = None) -> PlantImpactData:
        if asset_map and asset_id in asset_map:
            asset = asset_map[asset_id]
        else:
            asset = self.asset_service.get_by_id(asset_id)
        if not asset:
            raise ValueError(f"Asset '{asset_id}' not found")

        chain_data = self.graph_service.get_impact_chain(asset_id)
        impact_chain = chain_data.get("impact_chain", [])
        affected_assets = []
        critical_assets = []
        for item in impact_chain:
            ds_id = item["asset_id"]
            if asset_map and ds_id in asset_map:
                downstream = asset_map[ds_id]
            else:
                downstream = self.asset_service.get_by_id(ds_id)
            if not downstream:
                continue
            serialized = self._asset_payload(downstream, item.get("depth", 0))
            affected_assets.append(serialized)
            if downstream.criticality.value == "critical":
                critical_assets.append(serialized)

        bottlenecks = self._bottlenecks(asset, affected_assets)
        impact_score = self._impact_score(asset, affected_assets, critical_assets, bottlenecks)
        downtime = self._estimated_downtime(asset, impact_score)
        return PlantImpactData(
            affected_assets=affected_assets,
            production_line=asset.production_line,
            critical_assets_impacted=critical_assets,
            estimated_downtime_hours=downtime,
            impact_score=impact_score,
            impact_category=self._category(impact_score),
            impact_chain=impact_chain,
            bottlenecks=bottlenecks,
        )

    def calculate_downstream_impact_score(self, downstream_assets: list) -> float:
        """Weighted blast-radius score: failure probability, criticality-weighted.

        Accepts ORM ``Asset`` objects or ``AssetSummary`` schemas (criticality may be an
        enum or a plain string). Shared by the asset-impact API route.
        """
        total = 0.0
        for a in downstream_assets:
            crit = a.criticality.value if hasattr(a.criticality, "value") else a.criticality
            total += a.failure_probability * (1.5 if crit == "critical" else 1.0)
        return round(total, 4)

    def _asset_payload(self, asset: Asset, depth: int) -> dict:
        return {
            "asset_id": asset.id,
            "asset_name": asset.name,
            "equipment_type": asset.equipment_type,
            "criticality": asset.criticality.value,
            "production_line": asset.production_line,
            "health_score": asset.health_score,
            "failure_probability": asset.failure_probability,
            "dependency_depth": depth,
        }

    def _bottlenecks(self, asset: Asset, affected_assets: list[dict]) -> list[dict]:
        candidates = [self._asset_payload(asset, 0)] + affected_assets
        bottlenecks = [
            item
            for item in candidates
            if item["criticality"] in {"critical", "high"} or item["failure_probability"] >= 0.55
        ]
        return sorted(bottlenecks, key=lambda item: (item["criticality"] != "critical", -item["failure_probability"]))[:5]

    def _impact_score(self, asset: Asset, affected_assets: list[dict], critical_assets: list[dict], bottlenecks: list[dict]) -> float:
        base = {"low": 12, "medium": 28, "high": 48, "critical": 68}.get(asset.criticality.value, 30)
        score = base + len(affected_assets) * 7 + len(critical_assets) * 12 + len(bottlenecks) * 5
        score += asset.failure_probability * 18
        return round(min(100.0, score), 2)

    def _estimated_downtime(self, asset: Asset, impact_score: float) -> float:
        criticality_multiplier = {"low": 0.8, "medium": 1.1, "high": 1.5, "critical": 2.0}.get(asset.criticality.value, 1.0)
        return round((2.0 + impact_score / 8.0) * criticality_multiplier, 2)

    def _category(self, score: float) -> str:
        if score >= 80:
            return "PLANT-WIDE"
        if score >= 60:
            return "LINE-CRITICAL"
        if score >= 35:
            return "LOCALIZED"
        return "LIMITED"
