from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.instrument import Instrument
from app.models.nav_history import NavHistory
from app.models.policy_trigger import PolicyTriggerEvent, PolicyTriggerState
from app.models.price_history import PriceHistory
from app.services.manual_assets import get_manual_assets_summary
from app.services.mf_breakdown import get_allocation_comparison, get_asset_class_comparison
from app.time_util import now_ist

THRESHOLDS = {
    "mon100_premium_low": 3.0,
    "mon100_premium_high": 8.0,
    "toplevel_drift_breach": 5.0,
    "mcap_anchor_tolerance": 5.0,
    "ltcg_exemption": 125_000,
    "emergency_fund_min": 1_000_000,
    "nifty_drawdown_rungs": [
        (15, 300_000, "₹3L"),
        (20, 500_000, "₹5L"),
        (25, 700_000, "₹7L"),
    ],
}

MON100_ISIN = "INF247L01AP3"

SECTIONS = [
    "A — Foreign Sleeve",
    "B — Allocation Drift",
    "C — Tax",
    "D — Annual Fund Audit",
    "E — Cleanup / Housekeeping",
    "F — Drawdown Ladder",
    "G — House Protocol",
]

_STATUS_ORDER = {"action": 0, "breach": 0, "watch": 1, "manual": 1, "ok": 2}


def _current_fy_start() -> date:
    today = date.today()
    return date(today.year, 4, 1) if today.month >= 4 else date(today.year - 1, 4, 1)


def _fy_label() -> str:
    fy_start = _current_fy_start()
    return f"FY{str(fy_start.year + 1)[-2:]}"


def _ack_in_current_fy(state: PolicyTriggerState | None) -> bool:
    if state is None or state.acknowledged_at is None:
        return False
    return state.acknowledged_at.date() >= _current_fy_start()


def _t(key, label, section, mode, status, summary, detail=None, cta=None, threshold=None) -> dict:
    return {
        "key": key, "label": label, "section": section, "mode": mode,
        "status": status, "summary": summary,
        "detail": detail or {}, "cta": cta, "threshold": threshold,
    }


# ── Evaluators ────────────────────────────────────────────────────────────────

def _eval_mon100_premium(ltp, nav, nav_date, states) -> dict:
    key, label, section = "mon100_premium", "MON100 Premium", "A — Foreign Sleeve"
    if ltp is None or nav is None:
        return _t(key, label, section, "auto", "watch",
                  "MON100 price or NAV not found — sync price and NAV history")
    ltp_f = float(ltp)
    nav_f = float(nav)
    premium = (ltp_f - nav_f) / nav_f * 100 if nav_f else 0
    today = date.today()
    # Flag stale data on Tue–Sat (trading days where yesterday's NAV should be available).
    stale = (nav_date is not None
             and today.isoweekday() in range(2, 7)  # Tue=2 … Sat=6
             and (today - nav_date).days > 1)
    stale_suffix = f" (data as of {nav_date}, may be stale)" if stale else f" (as of {nav_date})"
    detail = {"exchange_close": ltp_f, "nav": nav_f, "premium_pct": round(premium, 2),
              "nav_date": str(nav_date), "stale": stale}
    thresh = {"low": THRESHOLDS["mon100_premium_low"], "high": THRESHOLDS["mon100_premium_high"]}
    if premium <= THRESHOLDS["mon100_premium_low"]:
        return _t(key, label, section, "auto", "ok",
                  f"Premium {premium:.1f}%{stale_suffix} — foreign route viable via MON100",
                  detail, "Foreign route viable via MON100", thresh)
    if premium <= THRESHOLDS["mon100_premium_high"]:
        return _t(key, label, section, "auto", "watch",
                  f"Premium {premium:.1f}%{stale_suffix} — elevated, monitor", detail, threshold=thresh)
    return _t(key, label, section, "auto", "watch",
              f"Premium {premium:.1f}%{stale_suffix} — high, avoid buying", detail, threshold=thresh)


def _eval_sp500_inflows(states) -> dict:
    key, label, section = "sp500_inflows_open", "S&P 500 Inflows", "A — Foreign Sleeve"
    state = states.get(key)
    if state and state.value_bool:
        return _t(key, label, section, "manual_input", "action",
                  "S&P 500 fund open to inflows",
                  cta="Deploy foreign tranche into MO S&P 500")
    return _t(key, label, section, "manual_input", "manual",
              "S&P 500 fund closed to inflows — update manually")


def _eval_foreign_sleeve_funded(alloc, states) -> dict:
    key, label, section = "foreign_sleeve_funded", "Foreign Sleeve Funded", "A — Foreign Sleeve"
    if alloc is None:
        return _t(key, label, section, "auto", "watch", "Allocation data unavailable")
    foreign = alloc["foreign"]
    diff = foreign["current_diff"]
    detail = {"current_pct": foreign["current_pct"], "target_pct": foreign["target_pct"], "diff": diff}
    if diff < -3:
        gap = abs(foreign.get("current_value_diff", 0))
        return _t(key, label, section, "auto", "watch",
                  f"Foreign {foreign['current_pct']:.1f}% vs {foreign['target_pct']:.1f}% target — ₹{gap:,.0f} gap",
                  detail)
    return _t(key, label, section, "auto", "ok",
              f"Foreign sleeve {foreign['current_pct']:.1f}% — within tolerance", detail)


def _eval_toplevel_drift(ac, states) -> dict:
    key, label, section = "toplevel_drift", "Top-level Drift", "B — Allocation Drift"
    if ac is None:
        return _t(key, label, section, "auto", "watch", "Asset class data unavailable")
    rows = ac["rows"]
    breached = [r for r in rows if abs(r["current_diff"]) > THRESHOLDS["toplevel_drift_breach"]]
    detail = {r["asset_class"]: {"current_pct": r["current_pct"], "target_pct": r["target_pct"], "diff": r["current_diff"]} for r in rows}
    thresh = {"breach": THRESHOLDS["toplevel_drift_breach"]}
    if breached:
        names = ", ".join(r["asset_class"] for r in breached)
        return _t(key, label, section, "auto", "breach",
                  f"{names} off target by >{THRESHOLDS['toplevel_drift_breach']}%",
                  detail, "Rebalance via fresh flows", thresh)
    return _t(key, label, section, "auto", "ok",
              "All asset class buckets within tolerance", detail, threshold=thresh)


def _eval_mcap_anchor_drift(alloc, states) -> dict:
    key, label, section = "mcap_anchor_drift", "Market-cap Anchor Drift", "B — Allocation Drift"
    if alloc is None:
        return _t(key, label, section, "auto", "watch", "Allocation data unavailable")
    rows = alloc["rows"]
    drifted = [r for r in rows if abs(r["current_diff"]) > THRESHOLDS["mcap_anchor_tolerance"]]
    detail = {r["category"]: {"current_pct": r["current_pct"], "target_pct": r["target_pct"], "diff": r["current_diff"]} for r in rows}
    thresh = {"tolerance": THRESHOLDS["mcap_anchor_tolerance"]}
    if drifted:
        names = ", ".join(r["category"] for r in drifted)
        return _t(key, label, section, "auto", "watch",
                  f"{names} drifted >{THRESHOLDS['mcap_anchor_tolerance']}% — correct via fresh flows",
                  detail, threshold=thresh)
    return _t(key, label, section, "auto", "ok",
              "Market-cap split within tolerance", detail, threshold=thresh)


def _eval_ltcg_harvest(states) -> dict:
    key, label, section = "ltcg_harvest_fy", "LTCG Harvest", "C — Tax"
    state = states.get(key)
    fy = _fy_label()
    if _ack_in_current_fy(state):
        return _t(key, label, section, "manual_ack", "ok",
                  f"Harvested for {fy}",
                  {"fy": fy, "acknowledged_at": state.acknowledged_at.isoformat()})
    return _t(key, label, section, "manual_ack", "action",
              f"Harvest LTCG exemption for {fy} (₹1.25L/FY)",
              {"fy": fy}, "Harvest LTCG exemption (₹1.25L/FY)")


def _eval_advance_tax(states) -> dict:
    key, label, section = "advance_tax_due", "Advance Tax", "C — Tax"
    today = date.today()
    fy_start = _current_fy_start()
    due_dates = [
        date(fy_start.year, 6, 15),
        date(fy_start.year, 9, 15),
        date(fy_start.year, 12, 15),
        date(fy_start.year + 1, 3, 15),
    ]
    upcoming = next((d for d in due_dates if d >= today), None)
    if upcoming is None:
        return _t(key, label, section, "auto", "ok",
                  "All advance tax instalments paid for this FY")
    days_until = (upcoming - today).days
    detail = {"next_due": upcoming.isoformat(), "days_until": days_until}
    thresh = {"action_days": 7, "watch_days": 30}
    if days_until <= 7:
        return _t(key, label, section, "auto", "action",
                  f"Advance tax due {upcoming.isoformat()} ({days_until}d)",
                  detail, f"Pay advance tax by {upcoming.isoformat()}", thresh)
    if days_until <= 30:
        return _t(key, label, section, "auto", "watch",
                  f"Advance tax due {upcoming.isoformat()} ({days_until}d)",
                  detail, threshold=thresh)
    return _t(key, label, section, "auto", "ok",
              f"Next advance tax: {upcoming.isoformat()} ({days_until}d)",
              detail, threshold=thresh)


def _eval_regime_review(states) -> dict:
    key, label, section = "regime_review", "Tax Regime Review", "C — Tax"
    state = states.get(key)
    fy = _fy_label()
    if _ack_in_current_fy(state):
        return _t(key, label, section, "manual_ack", "ok",
                  f"Regime reviewed for {fy}",
                  {"fy": fy, "acknowledged_at": state.acknowledged_at.isoformat()})
    return _t(key, label, section, "manual_ack", "manual",
              f"Review old vs new regime for {fy}", {"fy": fy})


def _eval_fund_audit(key, label, benchmark, states) -> dict:
    section = "D — Annual Fund Audit"
    state = states.get(key)
    fy = _fy_label()
    note = state.value_text if state else None
    if _ack_in_current_fy(state):
        return _t(key, label, section, "manual_ack", "ok",
                  f"{fy} audit recorded" + (f": {note}" if note else ""),
                  {"fy": fy, "result": note})
    return _t(key, label, section, "manual_ack", "action",
              f"Audit vs {benchmark} for {fy} not recorded",
              {"fy": fy, "benchmark": benchmark},
              f"Record audit result vs {benchmark}")


def _eval_one_time_ack(key, label, section, done_summary, pending_summary, states) -> dict:
    state = states.get(key)
    if state and state.value_bool:
        return _t(key, label, section, "manual_ack", "ok", done_summary)
    return _t(key, label, section, "manual_ack", "manual", pending_summary)


def _eval_emergency_fund(manual, states) -> dict:
    key, label, section = "emergency_fund_intact", "Emergency Fund", "E — Cleanup / Housekeeping"
    total = manual.get("emergency_total", 0)
    minimum = THRESHOLDS["emergency_fund_min"]
    detail = {"current": total, "minimum": minimum}
    thresh = {"minimum": minimum}
    if total < minimum:
        return _t(key, label, section, "auto", "action",
                  f"Emergency fund ₹{total:,.0f} below ₹{minimum:,.0f} target",
                  detail, "Replenish emergency fund", thresh)
    return _t(key, label, section, "auto", "ok",
              f"Emergency fund intact (₹{total:,.0f})", detail, threshold=thresh)


def _eval_nifty_drawdown(peak, current, states) -> dict:
    key, label, section = "nifty_drawdown_ladder", "Nifty Drawdown Ladder", "F — Drawdown Ladder"
    if peak is None or current is None:
        return _t(key, label, section, "auto", "manual",
                  "Sync price history to enable Nifty drawdown tracking")
    peak_f, current_f = float(peak), float(current)
    drawdown_pct = (current_f - peak_f) / peak_f * 100
    rungs = THRESHOLDS["nifty_drawdown_rungs"]
    rung_levels = [round(peak_f * (1 - r[0] / 100), 2) for r in rungs]
    detail = {
        "peak": peak_f,
        "current": current_f,
        "drawdown_pct": round(drawdown_pct, 2),
        "rung_levels": rung_levels,
        "rung_pcts": [r[0] for r in rungs],
    }
    active = None
    for threshold, amount, label_text in reversed(rungs):
        if drawdown_pct <= -threshold:
            active = (threshold, amount, label_text)
            break
    thresh = {"rungs": [[r[0], r[1]] for r in rungs]}
    if active:
        _, _, label_text = active
        return _t(key, label, section, "auto", "action",
                  f"Nifty down {abs(drawdown_pct):.1f}% from peak — deploy {label_text}",
                  detail, f"Deploy extra {label_text}", thresh)
    return _t(key, label, section, "auto", "ok",
              f"Nifty {drawdown_pct:.1f}% from peak — no rung active",
              detail, threshold=thresh)


def _eval_house_trigger(states) -> dict:
    key, label, section = "house_trigger", "House Purchase Protocol", "G — House Protocol"
    state = states.get(key)
    if state and state.value_bool:
        return _t(key, label, section, "manual_input", "action",
                  "Purchase intent active — de-risking protocol in effect",
                  {"checklist": ["Set up STP for high-beta funds", "Sell high-beta first", "Maintain 60–70% floor"]},
                  "Follow de-risking checklist")
    return _t(key, label, section, "manual_input", "ok",
              "Dormant — no purchase intent within 24 months")


# ── Main evaluation ───────────────────────────────────────────────────────────

async def evaluate_all(db: AsyncSession) -> dict:
    # Load PolicyTriggerState rows
    states: dict[str, PolicyTriggerState] = {
        s.key: s for s in (await db.execute(select(PolicyTriggerState))).scalars().all()
    }

    # MON100: find instrument by ISIN, get NAV and the exchange close for the same date.
    # Don't go through Holding — the ETF may have been sold out (no active holding row).
    mon100_instr = (await db.execute(
        select(Instrument).where(Instrument.isin == MON100_ISIN)
    )).scalar_one_or_none()
    mon100_ltp = mon100_nav = mon100_nav_date = None
    if mon100_instr:
        nav_row = (await db.execute(
            select(NavHistory.nav, NavHistory.nav_date)
            .where(NavHistory.instrument_id == mon100_instr.id)
            .order_by(NavHistory.nav_date.desc())
            .limit(1)
        )).first()
        if nav_row:
            mon100_nav, mon100_nav_date = nav_row
            # Use the exchange close for the same date as the NAV for a fair comparison.
            mon100_ltp = (await db.execute(
                select(PriceHistory.close)
                .where(
                    PriceHistory.instrument_id == mon100_instr.id,
                    PriceHistory.price_date == mon100_nav_date,
                )
            )).scalar_one_or_none()

    # Allocation comparisons
    alloc = await get_allocation_comparison(db)
    ac = await get_asset_class_comparison(db)

    # Manual assets
    manual = await get_manual_assets_summary(db)

    # Nifty 50 peak + current close
    nifty_instr = (await db.execute(
        select(Instrument).where(
            Instrument.tradingsymbol == "NIFTY 50",
            Instrument.instrument_type == "INDEX",
        )
    )).scalar_one_or_none()
    nifty_peak = nifty_current = None
    if nifty_instr:
        nifty_peak = (await db.execute(
            select(func.max(PriceHistory.close))
            .where(PriceHistory.instrument_id == nifty_instr.id)
        )).scalar_one_or_none()
        nifty_current = (await db.execute(
            select(PriceHistory.close)
            .where(PriceHistory.instrument_id == nifty_instr.id)
            .order_by(PriceHistory.price_date.desc())
            .limit(1)
        )).scalar_one_or_none()

    # Evaluate all triggers
    triggers = [
        _eval_mon100_premium(mon100_ltp, mon100_nav, mon100_nav_date, states),
        _eval_sp500_inflows(states),
        _eval_foreign_sleeve_funded(alloc, states),
        _eval_toplevel_drift(ac, states),
        _eval_mcap_anchor_drift(alloc, states),
        _eval_ltcg_harvest(states),
        _eval_advance_tax(states),
        _eval_regime_review(states),
        _eval_fund_audit("kotak_midcap_audit", "Kotak Midcap Audit", "Midcap 150 TRI", states),
        _eval_fund_audit("bandhan_smallcap_audit", "Bandhan Smallcap Audit", "Smallcap 250 TRI", states),
        _eval_one_time_ack("nippon_sc_consolidation", "Nippon SC Consolidation",
                           "E — Cleanup / Housekeeping",
                           "Consolidation done", "Consolidate Nippon Small Cap position", states),
        _eval_one_time_ack("goi2064_exit", "GOI 2064 Exit",
                           "E — Cleanup / Housekeeping",
                           "GOI 2064 exited + loss harvested", "Exit GOI 2064 and harvest loss", states),
        _eval_emergency_fund(manual, states),
        _eval_nifty_drawdown(nifty_peak, nifty_current, states),
        _eval_house_trigger(states),
    ]

    # Group into sections, action/breach sorts first within each
    section_map: dict[str, list[dict]] = {s: [] for s in SECTIONS}
    for t in triggers:
        section_map[t["section"]].append(t)
    for group in section_map.values():
        group.sort(key=lambda t: _STATUS_ORDER.get(t["status"], 99))

    sections = [
        {"section": s, "triggers": section_map[s]}
        for s in SECTIONS
        if section_map[s]
    ]

    return {
        "generated_at": now_ist().isoformat(),
        "sections": sections,
        "action_count": sum(1 for t in triggers if t["status"] in ("action", "breach")),
    }


async def evaluate_one(db: AsyncSession, key: str) -> dict | None:
    data = await evaluate_all(db)
    for section in data["sections"]:
        for t in section["triggers"]:
            if t["key"] == key:
                return t
    return None


async def upsert_state(db: AsyncSession, key: str, value_bool=None, value_text=None, value_num=None):
    existing = (await db.execute(
        select(PolicyTriggerState).where(PolicyTriggerState.key == key)
    )).scalar_one_or_none()
    ts = now_ist()
    if existing:
        if value_bool is not None:
            existing.value_bool = value_bool
        if value_text is not None:
            existing.value_text = value_text
        if value_num is not None:
            existing.value_num = value_num
        existing.acknowledged_at = ts
    else:
        db.add(PolicyTriggerState(
            key=key,
            value_bool=value_bool,
            value_text=value_text,
            value_num=value_num,
            acknowledged_at=ts,
            updated_at=ts,
        ))
    await db.commit()
