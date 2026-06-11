from sqlalchemy.orm import Session

from app.models.spare_part import SparePart
from app.schemas.decision import ProcurementData
from app.services.spare_part_service import SparePartService


class ProcurementEngine:
    """Analyzes spare availability, shortages, lead times, and alternatives."""

    def __init__(self, db: Session) -> None:
        self.spare_service = SparePartService(db)

    def analyze(
        self,
        required_parts: list[str],
        equipment_type: str,
        asset_id: str,
        spares_by_equipment: dict[str, list[SparePart]] | None = None,
        all_spares: list[SparePart] | None = None,
    ) -> ProcurementData:
        required_parts = list(dict.fromkeys(required_parts))
        available = []
        missing = []
        lead_times = []
        recommendations = []
        alternatives = []

        for part_ref in required_parts:
            matched = self._match_part(part_ref, equipment_type, asset_id, spares_by_equipment, all_spares)
            if matched and matched.stock_quantity > 0:
                available.append(self._part_payload(matched))
                lead_times.append({"part_id": matched.part_id, "part_name": matched.part_name, "lead_time_days": matched.lead_time_days})
                if matched.is_low_stock:
                    recommendations.append(
                        f"Reorder {matched.part_name}: stock {matched.stock_quantity} is at or below reorder level {matched.reorder_level}."
                    )
            else:
                missing.append({"required_part": part_ref, "equipment_type": equipment_type})
                recommendations.append(f"Create purchase requisition for {part_ref}; no available matching stock was found.")
                alternatives.extend(self._alternatives(equipment_type, asset_id, exclude_part_id=matched.part_id if matched else None, spares_by_equipment=spares_by_equipment))

        if not required_parts:
            if spares_by_equipment is not None:
                candidates = spares_by_equipment.get(equipment_type, [])
            else:
                candidates = self.spare_service.get_by_equipment_type(equipment_type)
            for part in candidates[:5]:
                if part.stock_quantity > 0:
                    available.append(self._part_payload(part))
                if part.is_low_stock:
                    recommendations.append(
                        f"Reorder {part.part_name}: stock {part.stock_quantity} is at or below reorder level {part.reorder_level}."
                    )
                lead_times.append({"part_id": part.part_id, "part_name": part.part_name, "lead_time_days": part.lead_time_days})

        risk = self._risk(available, missing, lead_times)
        return ProcurementData(
            available_parts=available,
            missing_parts=missing,
            lead_times=lead_times,
            procurement_risk=risk,
            reorder_recommendations=list(dict.fromkeys(recommendations)),
            alternative_parts=alternatives[:8],
        )

    def risk_summary(self) -> list[dict]:
        summaries = []
        for part in self.spare_service.get_low_stock():
            if part.stock_quantity == 0:
                risk = "CRITICAL"
            elif part.lead_time_days >= 21:
                risk = "HIGH"
            else:
                risk = "MEDIUM"
            payload = self._part_payload(part)
            payload["procurement_risk"] = risk
            summaries.append(payload)
        return summaries

    def _match_part(
        self,
        part_ref: str,
        equipment_type: str,
        asset_id: str,
        spares_by_equipment: dict[str, list[SparePart]] | None = None,
        all_spares: list[SparePart] | None = None,
    ) -> SparePart | None:
        lowered = part_ref.lower()
        if spares_by_equipment is not None:
            candidates = spares_by_equipment.get(equipment_type, [])
        else:
            candidates = self.spare_service.get_by_equipment_type(equipment_type)

        if all_spares is not None:
            all_candidates = candidates or all_spares
        else:
            all_candidates = candidates or self.spare_service.get_all(limit=500)

        for part in all_candidates:
            fields = [part.part_id, part.part_name, part.part_number or "", part.description or "", part.compatible_assets or ""]
            if any(lowered in field.lower() or field.lower() in lowered for field in fields if field):
                return part
        for part in all_candidates:
            if asset_id in (part.compatible_assets or ""):
                return part
        return None

    def _alternatives(
        self,
        equipment_type: str,
        asset_id: str,
        exclude_part_id: str | None = None,
        spares_by_equipment: dict[str, list[SparePart]] | None = None,
    ) -> list[dict]:
        alternatives = []
        if spares_by_equipment is not None:
            candidates = spares_by_equipment.get(equipment_type, [])
        else:
            candidates = self.spare_service.get_by_equipment_type(equipment_type)

        for part in candidates:
            if part.part_id == exclude_part_id:
                continue
            if part.stock_quantity > 0 or asset_id in (part.compatible_assets or ""):
                alternatives.append(self._part_payload(part))
        return alternatives

    def _risk(self, available: list[dict], missing: list[dict], lead_times: list[dict]) -> str:
        max_lead = max((item["lead_time_days"] for item in lead_times), default=0)
        if missing and max_lead >= 21:
            return "CRITICAL"
        if missing:
            return "HIGH"
        if max_lead >= 30:
            return "HIGH"
        if any(item["stock_quantity"] <= item["reorder_level"] for item in available):
            return "MEDIUM"
        return "LOW"

    def _part_payload(self, part: SparePart) -> dict:
        return {
            "part_id": part.part_id,
            "part_name": part.part_name,
            "equipment_type": part.equipment_type,
            "stock_quantity": part.stock_quantity,
            "reorder_level": part.reorder_level,
            "lead_time_days": part.lead_time_days,
            "supplier": part.supplier,
            "unit_cost_usd": part.unit_cost_usd,
            "storage_location": part.storage_location,
            "compatible_assets": part.compatible_assets,
        }
