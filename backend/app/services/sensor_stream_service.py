import random
import logging
from datetime import datetime, timezone
from typing import Dict, Any, List
from sqlalchemy.orm import Session
from sqlalchemy import select
from app.models.asset import Asset
from app.services.notification_engine import NotificationEngine
from app.services.demo_simulation_service import DemoSimulationService

logger = logging.getLogger(__name__)

class SensorStreamService:
    # Class-level state to persist sensor values between SSE ticks across connections
    _asset_states: Dict[str, Dict[str, Any]] = {}
    
    # Track when we last created an alert for a given asset to avoid flooding the DB
    _last_alert_time: Dict[str, float] = {}

    def __init__(self, db: Session) -> None:
        self._db = db
        self.notification_engine = NotificationEngine(db)

    def _initialize_asset_state(self, asset: Asset) -> Dict[str, Any]:
        """Set up starting values for an asset based on its type and database state."""
        # Defaults
        temp_base = 65.0
        vib_base = 2.2
        press_base = 3.5
        curr_base = 35.0
        
        eq_lower = asset.equipment_type.lower()
        if "motor" in eq_lower:
            temp_base = 72.0
            vib_base = 4.5
            press_base = 1.0 # motors don't have high pressure
            curr_base = 45.0
        elif "pump" in eq_lower:
            temp_base = 60.0
            vib_base = 2.8
            press_base = 4.5
            curr_base = 28.0
        elif "fan" in eq_lower or "blower" in eq_lower:
            temp_base = 55.0
            vib_base = 5.2
            press_base = 1.2
            curr_base = 18.0
        elif "compressor" in eq_lower:
            temp_base = 80.0
            vib_base = 3.8
            press_base = 8.5
            curr_base = 65.0

        # Start health score at the database's actual value
        db_health = float(asset.health_score) if asset.health_score is not None else 95.0

        # Adjust starting sensor values based on degraded database health
        if db_health < 90:
            severity_factor = (100.0 - db_health) / 10.0
            temp_base += severity_factor * 2.0
            vib_base += severity_factor * 0.5
            curr_base += severity_factor * 1.5

        return {
            "asset_id": asset.id,
            "temperature": temp_base,
            "vibration": vib_base,
            "pressure": press_base,
            "current": curr_base,
            "health_score": db_health,
            "baseline_health": db_health,
            "anomaly_type": None,       # "bearing_wear", "temp_spike", "pressure_loss", etc.
            "anomaly_ticks_left": 0,
            "anomaly_direction": 1
        }

    def get_next_readings_for_all(self) -> List[Dict[str, Any]]:
        """Generate the next tick of sensor readings for all assets in the database."""
        # Query active assets
        stmt = select(Asset)
        assets = self._db.scalars(stmt).all()
        
        readings = []
        now_str = datetime.now(timezone.utc).isoformat()
        
        for asset in assets:
            asset_id = asset.id
            if asset_id not in self._asset_states:
                self._asset_states[asset_id] = self._initialize_asset_state(asset)
                
            state = self._asset_states[asset_id]

            # Scripted demo scenario takes precedence over random behaviour for its
            # target asset, giving a deterministic, repeatable degradation story.
            scripted = DemoSimulationService.apply(asset_id, state)

            # Anomaly injection check (skipped while this asset is scenario-driven)
            # Reduced from 3% to 0.1% to make the plant healthy by default
            if not scripted and not state["anomaly_type"] and random.random() < 0.001:
                anomalies = ["bearing_wear", "temp_spike", "pressure_loss", "current_surge"]
                state["anomaly_type"] = random.choice(anomalies)
                state["anomaly_ticks_left"] = random.randint(8, 15)
                state["anomaly_direction"] = 1 if state["anomaly_type"] != "pressure_loss" else -1
                logger.info(f"Injecting anomaly '{state['anomaly_type']}' on asset {asset_id}")

            # Drift & random walk with mean reversion
            if state["anomaly_type"] == "bearing_wear":
                # Vibration ramps up
                state["vibration"] += 0.35 * state["anomaly_direction"]
                state["temperature"] += 0.4  # bearing wear causes friction heat
                state["health_score"] -= 2.5
            elif state["anomaly_type"] == "temp_spike":
                # Temperature spikes
                state["temperature"] += 2.2 * state["anomaly_direction"]
                state["vibration"] += 0.1
                state["health_score"] -= 2.0
            elif state["anomaly_type"] == "pressure_loss":
                # Pressure drops
                state["pressure"] += 0.35 * state["anomaly_direction"]
                state["health_score"] -= 1.8
            elif state["anomaly_type"] == "current_surge":
                # Current spikes
                state["current"] += 3.5 * state["anomaly_direction"]
                state["temperature"] += 0.6
                state["health_score"] -= 2.2
            elif not scripted:
                # Normal operational drift (random walk with mean reversion)
                base_health = state.get("baseline_health", 95.0)
                eq_lower = asset.equipment_type.lower()

                # Temperature — capped so even degraded assets never cross the 82°C alarm threshold
                target_temp = 72.0 if "motor" in eq_lower else 60.0
                if base_health < 90:
                    target_temp = min(target_temp + (100.0 - base_health) * 0.08, 79.0)
                state["temperature"] += (random.uniform(-0.6, 0.6) + (target_temp - state["temperature"]) * 0.05)

                # Vibration — capped so even degraded assets never cross the 6.0 mm/s alarm threshold
                target_vib = 4.5 if "motor" in eq_lower else 2.8
                if base_health < 90:
                    target_vib = min(target_vib + (100.0 - base_health) * 0.01, 5.4)
                state["vibration"] += (random.uniform(-0.25, 0.25) + (target_vib - state["vibration"]) * 0.05)

                # Pressure
                target_press = 4.5 if "pump" in eq_lower else 1.0
                state["pressure"] += (random.uniform(-0.15, 0.15) + (target_press - state["pressure"]) * 0.05)

                # Current
                target_curr = 45.0 if "motor" in eq_lower else 28.0
                if base_health < 90:
                    target_curr += (100.0 - base_health) * 0.2
                state["current"] += (random.uniform(-0.8, 0.8) + (target_curr - state["current"]) * 0.05)

                # Health — strong mean-reversion toward seeded baseline so demo values hold
                state["health_score"] += (random.uniform(-0.15, 0.15) + (base_health - state["health_score"]) * 0.08)
                    
            # Bound check values
            state["temperature"] = max(20.0, min(140.0, state["temperature"]))
            state["vibration"] = max(0.1, min(25.0, state["vibration"]))
            state["pressure"] = max(0.0, min(20.0, state["pressure"]))
            state["current"] = max(0.0, min(150.0, state["current"]))
            
            # Recalculate health based on sensor levels (skipped when scripted —
            # the scenario controls health directly).
            if not scripted and state.get("anomaly_type"):
                # Threshold breaches during anomaly
                if state["vibration"] > 8.5 or state["temperature"] > 92.0:
                    state["health_score"] = max(15.0, state["health_score"] - 1.5)
                elif state["vibration"] > 6.0 or state["temperature"] > 82.0:
                    state["health_score"] = max(45.0, state["health_score"] - 0.5)

            state["health_score"] = max(10.0, min(100.0, state["health_score"]))

            # Handle anomaly ticks
            if state["anomaly_type"]:
                state["anomaly_ticks_left"] -= 1
                if state["anomaly_ticks_left"] <= 0:
                    # Let it start cooling down/restoring
                    state["anomaly_type"] = None
                    logger.info(f"Anomaly sequence resolved/stopped for asset {asset_id}")

            # Check if alert needs to be generated (vibration > 9.0 or temp > 95.0 or health < 50)
            self._check_and_trigger_alerts(asset, state)

            readings.append({
                "asset_id": asset_id,
                "timestamp": now_str,
                "temperature": round(state["temperature"], 2),
                "vibration": round(state["vibration"], 2),
                "pressure": round(state["pressure"], 2),
                "current": round(state["current"], 2),
                "health_score": round(state["health_score"], 1),
                "is_anomaly": state["anomaly_ticks_left"] > 0
            })

        # Progress the scripted scenario (if any) and fire one-shot milestones.
        DemoSimulationService.advance(self._db, self.notification_engine)

        return readings

    def _check_and_trigger_alerts(self, asset: Asset, state: Dict[str, Any]) -> None:
        """Create a notification alert if sensor readings cross critical thresholds."""
        asset_id = asset.id
        vibration = state["vibration"]
        temperature = state["temperature"]
        health = state["health_score"]
        
        # Debounce alerts (minimum 45 seconds between alerts for the same asset)
        current_time = datetime.now().timestamp()
        last_alert = self._last_alert_time.get(asset_id, 0)
        if current_time - last_alert < 45:
            return

        triggered = False
        severity = None
        title = ""
        message = ""
        target_roles = []

        if vibration > 9.0:
            triggered = True
            severity = "critical"
            title = f"Vibration Breach: {asset_id}"
            message = f"Vibration reached {vibration:.2f} mm/s, exceeding safety limit of 9.0 mm/s on {asset.name}."
            target_roles = ["reliability_engineer", "maintenance_engineer", "operator", "supervisor"]
        elif temperature > 95.0:
            triggered = True
            severity = "critical"
            title = f"Thermal Overheat: {asset_id}"
            message = f"Temperature surged to {temperature:.1f}°C, exceeding critical threshold of 95.0°C."
            target_roles = ["operator", "maintenance_engineer", "supervisor", "plant_manager"]
        elif health < 45.0:
            triggered = True
            severity = "high"
            title = f"Asset Health Drop: {asset_id}"
            message = f"Calculated asset health index has deteriorated to {health:.1f}%."
            target_roles = ["plant_manager", "reliability_engineer", "supervisor", "maintenance_engineer", "procurement_officer"]

        # NOTE: the live telemetry stream is an ephemeral, in-memory overlay — it must
        # NOT persist its drifting health back to the database. Writing every tick made
        # each asset ratchet toward failure (each slightly-lower value became the next
        # boot's baseline) and let multiple backends sharing one Supabase drag each other
        # down, so the curated health spread never held. The DB health_score is the
        # canonical baseline (re-applied from assets.json at startup); the alerts below
        # are still raised from the live values, but they no longer mutate the DB.
        # (Scripted demo escalations still write the DB directly in DemoSimulationService.)

        if triggered and severity:
            self._last_alert_time[asset_id] = current_time
            try:
                # Trigger escalation or notification
                self.notification_engine.create_notification(
                    severity=severity,
                    title=title,
                    message=message,
                    asset_id=asset_id,
                    target_roles=target_roles
                )
                logger.info(f"Live telemetry alert triggered for {asset_id}: {title}")
            except Exception as e:
                logger.error(f"Failed to create telemetry alert for {asset_id}: {e}")
