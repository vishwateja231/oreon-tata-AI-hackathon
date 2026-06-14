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
            # Steel-plant-specific failure modes (gated by equipment type; the final
            # diagnosis is still chosen by highest confidence across all matches).
            self._tuyere_burnthrough,
            self._hearth_refractory_erosion,
            self._work_roll_spalling,
            self._cooling_tower_fouling,
            self._conveyor_belt_slip,
            # Generic rotating-equipment failure modes.
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

    # ------------------------------------------------------------------ #
    # Steel-plant-specific failure modes                                  #
    # ------------------------------------------------------------------ #
    def _tuyere_burnthrough(self, asset_type: str, text: str, values: dict) -> RootCauseResult | None:
        """Blast-furnace tuyere cooling failure / coolant ingress into the hearth.

        A copper tuyere losing cooling-water pressure (or a confirmed leak) lets
        water reach molten iron — a hydrogen-explosion hazard and one of the most
        severe blast-furnace failure modes.
        """
        if "blast furnace" not in asset_type and "furnace" not in asset_type and "tuyere" not in text:
            return None
        pressure = values.get("pressure_bar")
        pressure_drop = pressure is not None and pressure <= 2.5
        leak_text = any(word in text for word in ["tuyere", "burn-through", "burnthrough", "coolant", "water ingress", "leak"])
        if not (pressure_drop or leak_text):
            return None
        evidence = ["Asset is a blast furnace hearth"]
        if pressure is not None:
            evidence.append(f"cooling_water_pressure_bar={pressure}")
        if leak_text:
            evidence.append("Fault text references tuyere / coolant / water ingress")
        return RootCauseResult(
            root_cause="Tuyere burn-through / coolant ingress",
            confidence=0.92 if (pressure_drop and leak_text) else 0.88,
            diagnosis=(
                "Loss of tuyere cooling-water pressure indicates a burning or cracked copper "
                "tuyere allowing coolant ingress toward the hearth. This carries an acute "
                "hydrogen-generation and explosion risk and requires immediate blast reduction."
            ),
            evidence=evidence,
            recommended_actions=[
                "Reduce hot blast / wind volume and notify the furnace control room immediately",
                "Isolate and pressure-test the affected tuyere cooling circuit to locate the leak",
                "Inspect the tuyere with the peep-sight camera; plan tuyere replacement (spare SP-006)",
                "Check hearth thermocouples and cooling-water return for steam or pressure loss",
            ],
        )

    def _hearth_refractory_erosion(self, asset_type: str, text: str, values: dict) -> RootCauseResult | None:
        """Blast-furnace hearth lining wear shown by rising stave/shell temperatures."""
        if "blast furnace" not in asset_type and "furnace" not in asset_type:
            return None
        temperature = values.get("temperature_c") or 0
        refractory_text = any(word in text for word in ["hearth", "refractory", "stave", "lining", "erosion", "shell"])
        if not (temperature >= 110 or refractory_text):
            return None
        return RootCauseResult(
            root_cause="Hearth refractory erosion",
            confidence=0.86,
            diagnosis=(
                "Elevated hearth stave/shell temperatures indicate carbon-brick refractory "
                "erosion thinning the protective skull. Continued wear risks hearth breakout "
                "and constrains the remaining furnace campaign life."
            ),
            evidence=[f"stave_temperature_c={temperature}", "Hearth/refractory wear signature present"],
            recommended_actions=[
                "Increase hearth stave cooling-water flow and verify even circumferential cooling",
                "Add titanium-bearing burden (e.g. ilmenite) to rebuild the protective hearth skull",
                "Map stave thermocouples for hot-spot localisation and trend wear rate",
                "Schedule a hearth reline (refractory brick SP-007) at the next campaign window",
            ],
        )

    def _work_roll_spalling(self, asset_type: str, text: str, values: dict) -> RootCauseResult | None:
        """Hot-strip mill work-roll surface spalling from thermal fatigue / cooling loss."""
        if "rolling mill" not in asset_type and "mill" not in asset_type and "roll" not in text:
            return None
        vibration = values.get("vibration_mms") or 0
        temperature = values.get("temperature_c") or 0
        roll_text = any(word in text for word in ["roll", "spall", "strip", "thermal", "crack", "scale", "spray"])
        if not (vibration >= 4.5 and (roll_text or temperature >= 80)):
            return None
        return RootCauseResult(
            root_cause="Work-roll spalling (thermal fatigue)",
            confidence=0.85,
            diagnosis=(
                "High mill vibration with thermal/roll-surface evidence indicates subsurface "
                "fatigue cracking of the work roll — typically initiated by roll-cooling spray "
                "loss and thermal cycling — progressing to surface spalling during high-load passes."
            ),
            evidence=[f"vibration_mms={vibration}", f"temperature_c={temperature}", "Work-roll / thermal-shock evidence present"],
            recommended_actions=[
                "Inspect the work-roll surface by eddy-current / ultrasonic for subsurface cracks",
                "Verify the roll-cooling header: check for blocked or misaligned spray nozzles",
                "Change out and regrind the affected work roll; confirm descaling sprays are functional",
                "Review the rolling schedule load distribution to limit thermal shock",
            ],
        )

    def _cooling_tower_fouling(self, asset_type: str, text: str, values: dict) -> RootCauseResult | None:
        """Closed-loop cooling-tower fill fouling / scaling reducing heat-transfer efficiency."""
        if "cooling" not in asset_type and "tower" not in text:
            return None
        temperature = values.get("temperature_c") or 0
        fouling_text = any(word in text for word in ["scal", "foul", "fill", "biological", "legionella", "approach", "efficiency", "algae"])
        if not (fouling_text or (85 <= temperature < 90)):
            return None
        return RootCauseResult(
            root_cause="Cooling-tower fill fouling / scaling",
            confidence=0.80,
            diagnosis=(
                "Rising approach temperature with fouling evidence indicates calcium-carbonate "
                "scaling and biological growth on the fill media, reducing heat-transfer "
                "efficiency and undermining downstream furnace and mill cooling duty."
            ),
            evidence=[f"temperature_c={temperature}", "Fill scaling / fouling evidence present"],
            recommended_actions=[
                "Inspect and clean or replace fouled fill media; clear the basin and strainers",
                "Verify anti-scalant and biocide dosing; conduct a Legionella risk assessment",
                "Check water-treatment conductivity, pH, and blowdown control set-points",
                "Re-baseline tower approach temperature after cleaning to confirm recovery",
            ],
        )

    def _conveyor_belt_slip(self, asset_type: str, text: str, values: dict) -> RootCauseResult | None:
        """Raw-material belt conveyor slip from pulley-lagging wear / idler misalignment."""
        if "conveyor" not in asset_type and "belt" not in text:
            return None
        current = values.get("current_amps") or 0
        vibration = values.get("vibration_mms") or 0
        belt_text = any(word in text for word in ["belt", "slip", "idler", "track", "pulley", "lagging", "spillage"])
        if not (belt_text or current >= 55 or vibration >= 4.5):
            return None
        return RootCauseResult(
            root_cause="Belt slip / idler misalignment",
            confidence=0.78,
            diagnosis=(
                "Drive-pulley lagging wear combined with return-idler misalignment is causing "
                "belt slip and progressive tracking failure on the raw-material conveyor, "
                "starving the downstream furnace/mill feed."
            ),
            evidence=[f"current_amps={current}", f"vibration_mms={vibration}", "Belt slip / tracking evidence present"],
            recommended_actions=[
                "Inspect drive-pulley lagging for wear or polishing; re-lag if glazed",
                "Re-tension the gravity take-up and verify counterweight travel",
                "Align return and carrying idlers; correct belt tracking and clear spillage",
                "Check the belt splice and skirting for damage at transfer points",
            ],
        )

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
