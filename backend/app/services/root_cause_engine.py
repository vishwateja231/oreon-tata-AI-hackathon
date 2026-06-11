from typing import Callable, Optional

from app.schemas.investigation import RootCauseResult, SensorAnalysisResult

# A learned modifier: given (asset_type, root_cause) returns a confidence multiplier.
ConfidenceAdjuster = Callable[[str, str], float]


class RootCauseEngine:
    """Deterministic industrial root-cause engine. No LLM decisions are made here.

    An optional ``confidence_adjuster`` lets the feedback-learning loop re-calibrate
    the deterministic confidence based on operators' historical confirmations and
    rejections. The engine stays pure and testable — the adjuster is injected.
    """

    def analyze(
        self,
        asset_type: str,
        fault_description: str,
        sensor_analysis: SensorAnalysisResult,
        confidence_adjuster: Optional[ConfidenceAdjuster] = None,
    ) -> RootCauseResult:
        snapshot = sensor_analysis.normalized_snapshot
        text = fault_description.lower()
        rules = [
            self._bearing_wear,
            self._lubrication_failure,
            self._shaft_misalignment,
            self._motor_overload,
            self._cooling_failure,
            self._gearbox_wear,
            self._pump_cavitation,
            self._fan_imbalance,
        ]
        matches = [result for rule in rules if (result := rule(asset_type.lower(), text, snapshot))]
        if matches:
            matches.sort(key=lambda item: item.confidence, reverse=True)
            return self._apply_feedback(matches[0], asset_type, confidence_adjuster)
        result = RootCauseResult(
            root_cause="Undetermined industrial fault",
            confidence=0.35,
            diagnosis="Available evidence does not match a high-confidence deterministic rule.",
            evidence=sensor_analysis.anomalies + sensor_analysis.degradation_indicators,
            recommended_actions=[
                "Perform operator inspection and verify sensor calibration",
                "Collect vibration spectrum, thermal image, and oil or process sample if applicable",
            ],
        )
        return self._apply_feedback(result, asset_type, confidence_adjuster)

    @staticmethod
    def _apply_feedback(
        result: RootCauseResult,
        asset_type: str,
        adjuster: Optional[ConfidenceAdjuster],
    ) -> RootCauseResult:
        """Re-calibrate diagnostic confidence using the learned modifier, if supplied."""
        result.base_confidence = result.confidence
        if adjuster is None:
            return result
        modifier = adjuster(asset_type, result.root_cause)
        if modifier == 1.0:
            return result
        adjusted = min(0.97, max(0.05, round(result.confidence * modifier, 4)))
        result.confidence = adjusted
        result.feedback_adjusted = adjusted != result.base_confidence
        return result

    def _bearing_wear(self, asset_type: str, text: str, values: dict) -> RootCauseResult | None:
        vibration = values.get("vibration_mms") or 0
        temperature = values.get("temperature_c") or 0
        if vibration >= 4.5 and temperature >= 80 and any(word in text for word in ["bearing", "noise", "grinding", "vibration"]):
            return RootCauseResult(
                root_cause="Bearing wear",
                confidence=0.88 if vibration >= 7 else 0.76,
                diagnosis="Elevated vibration and temperature indicate bearing surface degradation or lubrication breakdown.",
                evidence=[f"vibration_mms={vibration}", f"temperature_c={temperature}", "Fault text references bearing/noise/vibration"],
                recommended_actions=[
                    "Inspect drive-end and non-drive-end bearings",
                    "Check lubricant condition and contamination",
                    "Plan bearing replacement if vibration spectrum confirms raceway defect",
                ],
            )
        return None

    def _lubrication_failure(self, asset_type: str, text: str, values: dict) -> RootCauseResult | None:
        temperature = values.get("temperature_c") or 0
        if temperature >= 85 and any(word in text for word in ["lubrication", "oil", "grease", "filter", "metallic"]):
            return RootCauseResult(
                root_cause="Lubrication failure",
                confidence=0.82,
                diagnosis="High thermal load with oil/grease symptoms suggests lubricant starvation, contamination, or filter blockage.",
                evidence=[f"temperature_c={temperature}", "Fault text references lubricant system"],
                recommended_actions=[
                    "Check lubricant level, viscosity, contamination, and filter differential pressure",
                    "Flush and replace lubricant if contamination is found",
                    "Inspect bearings and gears for heat discoloration or pitting",
                ],
            )
        return None

    def _shaft_misalignment(self, asset_type: str, text: str, values: dict) -> RootCauseResult | None:
        vibration = values.get("vibration_mms") or 0
        current = values.get("current_amps") or 0
        if vibration >= 5 and ("misalign" in text or "coupling" in text or current >= 55):
            return RootCauseResult(
                root_cause="Shaft misalignment",
                confidence=0.74,
                diagnosis="High vibration with coupling or elevated load evidence indicates shaft/coupling misalignment.",
                evidence=[f"vibration_mms={vibration}", f"current_amps={current}", "Misalignment/coupling evidence present"],
                recommended_actions=[
                    "Perform laser alignment across motor, gearbox, and driven equipment",
                    "Inspect coupling insert, keys, soft foot, and foundation bolts",
                ],
            )
        return None

    def _motor_overload(self, asset_type: str, text: str, values: dict) -> RootCauseResult | None:
        current = values.get("current_amps") or 0
        temperature = values.get("temperature_c") or 0
        if "motor" in asset_type and current >= 55 and temperature >= 80:
            return RootCauseResult(
                root_cause="Motor overload",
                confidence=0.86 if current >= 70 else 0.78,
                diagnosis="Current draw and motor temperature are above operating thresholds, indicating overload or electrical stress.",
                evidence=[f"current_amps={current}", f"temperature_c={temperature}", "Asset type is motor"],
                recommended_actions=[
                    "Check load demand, belt tension, driven equipment drag, and VFD parameters",
                    "Inspect terminals, insulation resistance, and cooling path",
                    "Reduce load or schedule controlled shutdown if current remains high",
                ],
            )
        return None

    def _cooling_failure(self, asset_type: str, text: str, values: dict) -> RootCauseResult | None:
        temperature = values.get("temperature_c") or 0
        pressure = values.get("pressure_bar")
        if ("cooling" in asset_type or "cool" in text or "temperature" in text) and temperature >= 90:
            evidence = [f"temperature_c={temperature}"]
            if pressure is not None:
                evidence.append(f"pressure_bar={pressure}")
            return RootCauseResult(
                root_cause="Cooling failure",
                confidence=0.84,
                diagnosis="Critical temperature indicates insufficient heat removal or cooling circuit degradation.",
                evidence=evidence,
                recommended_actions=[
                    "Inspect cooling flow, filters, strainers, fan operation, and heat exchanger fouling",
                    "Verify coolant pressure and isolate any leaking branch",
                ],
            )
        return None

    def _gearbox_wear(self, asset_type: str, text: str, values: dict) -> RootCauseResult | None:
        vibration = values.get("vibration_mms") or 0
        temperature = values.get("temperature_c") or 0
        if ("gearbox" in asset_type or "gear" in text) and vibration >= 4.5 and temperature >= 80:
            return RootCauseResult(
                root_cause="Gearbox wear",
                confidence=0.81,
                diagnosis="Gearbox heat and vibration suggest gear tooth pitting, bearing wear, or lubrication starvation.",
                evidence=[f"vibration_mms={vibration}", f"temperature_c={temperature}", "Gearbox/gear evidence present"],
                recommended_actions=[
                    "Inspect oil sample for ferrous particles",
                    "Perform borescope inspection of gear teeth and bearings",
                    "Check oil pump, filter, and breather condition",
                ],
            )
        return None

    def _pump_cavitation(self, asset_type: str, text: str, values: dict) -> RootCauseResult | None:
        pressure = values.get("pressure_bar")
        vibration = values.get("vibration_mms") or 0
        if ("pump" in asset_type or "cavitation" in text) and pressure is not None and pressure <= 2.5 and vibration >= 4.5:
            return RootCauseResult(
                root_cause="Pump cavitation",
                confidence=0.89,
                diagnosis="Low suction/process pressure with elevated vibration indicates cavitation and unstable hydraulic flow.",
                evidence=[f"pressure_bar={pressure}", f"vibration_mms={vibration}", "Pump/cavitation context present"],
                recommended_actions=[
                    "Inspect suction strainer, valves, and NPSH margin",
                    "Check for air ingress and blocked suction line",
                    "Reduce pump speed or load until stable suction pressure is restored",
                ],
            )
        return None

    def _fan_imbalance(self, asset_type: str, text: str, values: dict) -> RootCauseResult | None:
        vibration = values.get("vibration_mms") or 0
        noise = values.get("noise_db") or 0
        if ("fan" in asset_type or "fan" in text) and vibration >= 4.5 and (noise >= 88 or "imbalance" in text):
            return RootCauseResult(
                root_cause="Fan imbalance",
                confidence=0.79,
                diagnosis="Fan vibration with high noise suggests impeller imbalance, deposits, or blade damage.",
                evidence=[f"vibration_mms={vibration}", f"noise_db={noise}", "Fan context present"],
                recommended_actions=[
                    "Inspect impeller for deposits, erosion, missing weights, or blade cracking",
                    "Perform dynamic balancing after cleaning",
                ],
            )
        return None
