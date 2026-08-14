"""Capital-flow dashboard adapter sharing sector-rotation histories and cache."""

from __future__ import annotations

from copy import deepcopy

from sector_rotation_sources import get_sector_rotation_dashboard


def _market_summary(sectors: list[dict]) -> dict | None:
    if not sectors:
        return None
    inflow = [sector for sector in sectors if sector["capitalFlow"]["score"] >= 60]
    outflow = [sector for sector in sectors if sector["capitalFlow"]["score"] <= 40]
    divergences = [
        sector
        for sector in sectors
        if sector["capitalFlow"].get("state", {}).get("id") in {"accumulation", "distribution"}
    ]
    average = sum(sector["capitalFlow"]["score"] for sector in sectors) / len(sectors)
    return {
        "averageScore": round(average, 1),
        "stance": "资金扩散" if average >= 60 else "资金收缩" if average <= 40 else "结构分化",
        "strongest": sectors[0]["title"],
        "weakest": sectors[-1]["title"],
        "inflowSectors": len(inflow),
        "outflowSectors": len(outflow),
        "divergenceSectors": len(divergences),
    }


def _capital_flow_market(market: dict) -> dict:
    result = {
        "id": market.get("id"),
        "title": market.get("title"),
        "status": market.get("status", "error"),
        "asOf": market.get("asOf"),
        "source": deepcopy(market.get("source") or {}),
        "dataQuality": deepcopy(market.get("dataQuality") or {}),
        "sectors": [],
    }
    for sector in market.get("sectors") or []:
        capital_flow = sector.get("capitalFlow")
        if not isinstance(capital_flow, dict):
            continue
        result["sectors"].append(
            {
                "id": sector.get("id"),
                "title": sector.get("title"),
                "english": sector.get("english", ""),
                "symbol": sector.get("symbol", ""),
                "instrument": sector.get("instrument", "指数/ETF代理"),
                "capitalFlow": deepcopy(capital_flow),
                "rotation": {
                    "score": sector.get("score"),
                    "rank": sector.get("rank"),
                    "phase": deepcopy(sector.get("phase")),
                    "action": deepcopy(sector.get("action")),
                },
            }
        )
    result["sectors"].sort(key=lambda sector: (-float(sector["capitalFlow"].get("score") or 0), sector["id"]))
    for rank, sector in enumerate(result["sectors"], 1):
        sector["flowRank"] = rank
    result["summary"] = _market_summary(result["sectors"])
    return result


def build_capital_flow_dashboard(rotation_dashboard: dict) -> dict:
    markets = [_capital_flow_market(market) for market in rotation_dashboard.get("markets", [])]
    live_count = sum(market["status"] == "live" for market in markets)
    return {
        "generatedAt": rotation_dashboard.get("generatedAt"),
        "refreshAfterSeconds": rotation_dashboard.get("refreshAfterSeconds", 1800),
        "autoRefresh": True,
        "methodologyVersion": "1.0.0",
        "sourceMethodologyVersion": rotation_dashboard.get("methodologyVersion"),
        "markets": markets,
        "methodology": {
            "indicatorWindows": ["1d", "5d", "20d"],
            "absoluteFlowField": "estimatedNetFlow",
            "absoluteFlowUse": "display-only",
            "rotationFusionField": "capitalFlow.score",
            "rotationFusionWeight": 15,
            "disclaimer": "资金流为价格位置与成交量推算值，不代表交易所披露的机构真实净买入。",
        },
        "dataQuality": {
            "status": "live" if live_count == 2 else "partial" if live_count else "stale-or-error",
            "liveMarkets": live_count,
            "totalMarkets": len(markets),
        },
    }


def get_capital_flow_dashboard(force: bool = False) -> dict:
    """Reuse the same source request and cache as sector rotation."""
    return build_capital_flow_dashboard(get_sector_rotation_dashboard(force=force))
