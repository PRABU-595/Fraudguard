"""
Feature 3: Time-Span Analysis
Detects temporal anomalies (unusual night hours vs account's typical hours,
weekend activity logging, rapid-succession transactions < 2 minutes apart,
dormant-account reactivation > 60 days, and transaction bursts).
Generates 24-hour activity distribution for UI heat-strip rendering.
"""

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

try:
    from src.traceback_analyzer import parse_iso_timestamp
except ImportError:
    from traceback_analyzer import parse_iso_timestamp

try:
    from zoneinfo import ZoneInfo
except ImportError:
    ZoneInfo = None

TZ_OFFSET_HOURS = {
    "UTC": 0.0,
    "Etc/UTC": 0.0,
    "Europe/London": 0.0,
    "Europe/Amsterdam": 1.0,
    "Europe/Berlin": 1.0,
    "Europe/Zurich": 1.0,
    "Europe/Bucharest": 2.0,
    "Asia/Kolkata": 5.5,
    "Asia/Singapore": 8.0,
    "America/New_York": -5.0,
    "America/Chicago": -6.0,
    "America/Los_Angeles": -8.0,
}

DEFAULT_TYPICAL_HOURS = list(range(8, 21))  # 08:00 to 20:00 local time
NIGHT_HOURS = {23, 0, 1, 2, 3, 4, 5}
RAPID_SUCCESSION_THRESHOLD_MINS = 2.0
UNUSUAL_HOUR_POINTS = 15
RAPID_SUCCESSION_POINTS = 20
DORMANT_DAYS_THRESHOLD = 60
DORMANT_REACTIVATION_POINTS = 15
BURST_WINDOW_MINS = 5.0
BURST_COUNT_THRESHOLD = 3
BURST_POINTS = 20


def to_local_datetime(utc_dt: datetime, tz_name: str = "UTC") -> datetime:
    if not tz_name:
        tz_name = "UTC"
    if ZoneInfo is not None:
        try:
            return utc_dt.astimezone(ZoneInfo(tz_name))
        except Exception:
            pass
    offset_hrs = TZ_OFFSET_HOURS.get(tz_name, 0.0)
    tz_obj = timezone(timedelta(hours=offset_hrs))
    return utc_dt.astimezone(tz_obj)


class TimeSpanAnalyzer:
    def evaluate(
        self,
        tx: Dict[str, Any],
        origin: Optional[Dict[str, Any]] = None,
        prior_records: Optional[List[Dict[str, Any]]] = None,
        previous_ts_str: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Computes `time_analysis` block and evaluates UNUSUAL_HOUR, RAPID_SUCCESSION,
        DORMANT_REACTIVATION, and BURST_ACTIVITY flags.
        """
        utc_dt = parse_iso_timestamp(tx.get("timestamp"))
        tz_name = (
            tx.get("timezone")
            or (origin or {}).get("timezone")
            or (tx.get("origin") or {}).get("timezone")
            or "UTC"
        )

        if tx.get("local_hour") is not None:
            tx_hour = int(tx["local_hour"]) % 24
            local_dt = to_local_datetime(utc_dt, tz_name)
            tx_dow = local_dt.weekday()
        else:
            local_dt = to_local_datetime(utc_dt, tz_name)
            tx_hour = local_dt.hour
            tx_dow = local_dt.weekday()

        is_night = tx_hour in NIGHT_HOURS
        is_weekend = tx_dow in (5, 6)

        # 24h heat strip computation
        hourly_counts = [0] * 24

        if tx.get("account_typical_hours") is not None:
            typical_hours = sorted(list(set(int(h) for h in tx["account_typical_hours"])))
            for h in typical_hours:
                hourly_counts[h] = 1
        elif prior_records:
            learned = set()
            for r in prior_records:
                r_ts = r.get("timestamp") or (r.get("original_payload") or {}).get("timestamp")
                if r_ts:
                    r_tz = (r.get("origin") or {}).get("timezone") or tz_name
                    r_local = to_local_datetime(parse_iso_timestamp(r_ts), r_tz)
                    learned.add(r_local.hour)
                    hourly_counts[r_local.hour] += 1
            typical_hours = sorted(list(learned)) if learned else list(DEFAULT_TYPICAL_HOURS)
        else:
            typical_hours = list(DEFAULT_TYPICAL_HOURS)
            for h in typical_hours:
                hourly_counts[h] = 1

        hour_anomaly = tx_hour not in typical_hours

        # Compute time_since_last_txn_mins
        last_ts_str = previous_ts_str
        if not last_ts_str and prior_records:
            chronological_priors = [
                r for r in prior_records
                if parse_iso_timestamp(r.get("timestamp") or (r.get("original_payload") or {}).get("timestamp")) <= utc_dt
            ]
            if chronological_priors:
                last_ts_str = (
                    chronological_priors[-1].get("timestamp")
                    or (chronological_priors[-1].get("original_payload") or {}).get("timestamp")
                )
            else:
                last_ts_str = (
                    prior_records[-1].get("timestamp")
                    or (prior_records[-1].get("original_payload") or {}).get("timestamp")
                )

        time_since_last_mins: Optional[float] = None
        if last_ts_str:
            prev_dt = parse_iso_timestamp(last_ts_str)
            raw_diff_seconds = (utc_dt - prev_dt).total_seconds()
            if raw_diff_seconds >= 0:
                time_since_last_mins = round(raw_diff_seconds / 60.0, 2)

        # Burst detection: count transactions in the last 5 minutes
        burst_count = 1
        if prior_records:
            five_mins_ago = utc_dt - timedelta(minutes=BURST_WINDOW_MINS)
            burst_count += sum(
                1 for r in prior_records
                if five_mins_ago <= parse_iso_timestamp(r.get("timestamp") or (r.get("original_payload") or {}).get("timestamp")) <= utc_dt
            )

        flags: List[str] = []
        risk_points = 0

        if hour_anomaly and is_night:
            flags.append("UNUSUAL_HOUR")
            risk_points += UNUSUAL_HOUR_POINTS

        if time_since_last_mins is not None and time_since_last_mins < RAPID_SUCCESSION_THRESHOLD_MINS:
            flags.append("RAPID_SUCCESSION")
            risk_points += RAPID_SUCCESSION_POINTS

        if time_since_last_mins is not None and time_since_last_mins > (DORMANT_DAYS_THRESHOLD * 24 * 60):
            flags.append("DORMANT_REACTIVATION")
            risk_points += DORMANT_REACTIVATION_POINTS

        if burst_count >= BURST_COUNT_THRESHOLD:
            flags.append("BURST_ACTIVITY")
            risk_points += BURST_POINTS

        sparkline_intervals = []
        if prior_records:
            sorted_priors = sorted(prior_records, key=lambda r: parse_iso_timestamp(r.get("timestamp") or (r.get("original_payload") or {}).get("timestamp")))
            for i in range(1, len(sorted_priors[-10:])):
                t1 = parse_iso_timestamp(sorted_priors[i-1].get("timestamp") or (sorted_priors[i-1].get("original_payload") or {}).get("timestamp"))
                t2 = parse_iso_timestamp(sorted_priors[i].get("timestamp") or (sorted_priors[i].get("original_payload") or {}).get("timestamp"))
                gap = max(0.0, round((t2 - t1).total_seconds() / 60.0, 1))
                sparkline_intervals.append(gap)

        time_analysis = {
            "transaction_hour": tx_hour,
            "transaction_day_of_week": tx_dow,
            "local_time_formatted": local_dt.strftime("%Y-%m-%d %H:%M:%S"),
            "timezone": tz_name,
            "is_night_transaction": is_night,
            "is_weekend": is_weekend,
            "account_typical_hours": typical_hours,
            "hour_anomaly": hour_anomaly,
            "time_since_last_txn_mins": time_since_last_mins,
            "burst_count_5m": burst_count,
            "hourly_distribution_24h": hourly_counts,
            "velocity_sparkline": sparkline_intervals
        }

        return {
            "time_analysis": time_analysis,
            "flags": flags,
            "risk_points": risk_points
        }
