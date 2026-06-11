import logging

logger = logging.getLogger(__name__)

class EscalationEngine:
    """Classifies risk and priority, mapping alerts to appropriate plant personnel and response windows."""

    def evaluate(
        self,
        risk_level: str,
        priority_band: str,
        rul_days: int,
        production_impact: float,
        procurement_risk: str
    ) -> dict:
        # Normalize inputs
        risk = risk_level.upper()
        prio = priority_band.upper()
        procu = procurement_risk.upper()

        # 1. Determine escalation level
        if risk == "CRITICAL" or prio == "CRITICAL" or (rul_days <= 5 and prio in ("CRITICAL", "HIGH")):
            level = "critical"
        elif risk == "HIGH" or prio == "HIGH" or production_impact >= 60.0 or procu in ("HIGH", "CRITICAL"):
            level = "high"
        elif risk == "MEDIUM" or prio == "MEDIUM" or production_impact >= 30.0:
            level = "medium"
        else:
            level = "low"

        # Override for ultra-low RUL
        if rul_days <= 3 and prio in ("CRITICAL", "HIGH", "MEDIUM"):
            level = "critical"

        # 2. Map notify roles based on escalation level
        roles = []
        if level == "critical":
            roles = ["plant_manager", "supervisor", "reliability_engineer"]
        elif level == "high":
            roles = ["supervisor", "reliability_engineer"]
        elif level == "medium":
            roles = ["maintenance_engineer"]
        else:
            roles = ["operator"]

        # Adjust roles for short RUL and critical priority
        if rul_days <= 3 and "plant_manager" not in roles:
            roles.append("plant_manager")

        # Adjust for procurement risk
        if procu in ("HIGH", "CRITICAL") and "reliability_engineer" not in roles:
            roles.append("reliability_engineer")

        # 3. Determine response window SLA
        if level == "critical":
            window = "4h"
        elif level == "high":
            window = "12h"
        elif level == "medium":
            window = "24h"
        else:
            window = "48h"

        # 4. Formulate escalation reason
        reason_parts = []
        if level == "critical":
            reason_parts.append("Immediate catastrophic failure threat detected.")
        if rul_days <= 5:
            reason_parts.append(f"Remaining Useful Life is extremely short ({rul_days} days).")
        if production_impact >= 50.0:
            reason_parts.append(f"Downstream blast radius is high (impact score: {production_impact:.1f}).")
        if procu in ("HIGH", "CRITICAL"):
            reason_parts.append("Low spare stock or long procurement lead times exist.")

        if not reason_parts:
            reason_parts.append(f"Standard {level} risk parameters met.")

        reason = " ".join(reason_parts)

        return {
            "escalation_level": level,
            "notify_roles": roles,
            "response_window": window,
            "escalation_reason": reason
        }
