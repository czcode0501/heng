"""Curated sector constituent pools and zero-config price-volume evidence.

The US pools preserve the original sector-flow repository order. China uses a
transparent research pool of liquid representatives because free official
live index holdings are not consistently available without credentials.
"""

from __future__ import annotations

from datetime import datetime, timezone

from capital_flow import build_capital_flow_snapshot
from market_data_hub import get_baostock_series, get_yfinance_series
from time_ranges import select_signal_rows, validate_signal_range


SECTOR_TITLES = {
    "energy": "能源", "materials": "原材料", "industrials": "工业",
    "consumer-discretionary": "可选消费", "consumer-staples": "主要消费",
    "health-care": "医药卫生", "financials": "金融",
    "information-technology": "信息技术", "communication-services": "通信服务",
    "utilities": "公用事业", "real-estate": "房地产",
}

US_POOLS = {
    "information-technology": "NVDA MSFT AAPL AVGO ORCL CRM CSCO IBM AMD ACN ADBE TXN INTU QCOM PLTR NOW ANET AMAT ADI MU LRCX KLAC INTC PANW SNPS CDNS WDAY FTNT GLW ROP",
    "financials": "BRK.B JPM V MA BAC WFC GS MS AXP C BLK SPGI PGR SCHW CB MMC KKR ICE BX CME USB PNC AON TFC COF AIG MET TRV ALL AFL",
    "health-care": "LLY JNJ ABBV MRK UNH TMO ABT ISRG PFE DHR AMGN BSX SYK GILD VRTX MDT ELV CVS REGN CI ZTS HCA BMY MCK EW BDX IDXX IQV HUM DXCM",
    "consumer-discretionary": "AMZN TSLA HD MCD LOW BKNG TJX SBUX NKE ORLY CMG MAR HLT ROST AZO DHI LEN GM F YUM RCL CCL GRMN EBAY LULU TSCO POOL DRI LKQ APTV",
    "consumer-staples": "COST WMT PG KO PM PEP MO MDLZ CL TGT KMB KDP KVUE GIS KR SYY STZ CHD HSY MKC ADM K TSN CLX CAG HRL SJM MNST DG DLTR",
    "energy": "XOM CVX COP EOG MPC WMB PSX SLB OKE VLO KMI TRGP FANG HES BKR OXY DVN HAL EQT APA TPL MRO",
    "industrials": "GE RTX HON UBER CAT BA UNP DE ETN LMT ADP WM EMR TT PH ITW GD NSC MMM CSX FDX CTAS NOC LHX PCAR JCI ODFL PAYX GWW URI",
    "materials": "LIN SHW ECL FCX APD NEM NUE DOW DD CTVA VMC MLM IFF PPG LYB STLD PKG BALL CF IP EMN MOS ALB AMCR AVY CE",
    "utilities": "NEE SO DUK CEG VST AEP D EXC XEL SRE PCG PEG ED WEC EIX AWK DTE ETR ES PPL FE CMS AEE ATO CNP LNT NRG EVRG PNW",
    "real-estate": "PLD AMT WELL EQIX SPG DLR PSA O CCI CBRE EXR VICI AVB EQR VTR IRM WY MAA ESS INVH ARE KIM HST DOC UDR BXP REG FRT",
    "communication-services": "META GOOGL GOOG NFLX DIS T VZ TMUS CMCSA CHTR EA TTWO WBD LYV OMC IPG MTCH PARA NWS NWSA PINS FOX FOXA",
}

CN_POOLS = {
    "energy": "601857 600028 601088 600938 600256 601225 600188 601898 000723 600348",
    "materials": "601899 600309 600019 600585 603993 002460 002466 600111 601600 603799",
    "industrials": "600031 601766 300124 000157 600893 600150 000425 000338 601012 600406",
    "consumer-discretionary": "002594 000333 000651 601633 600104 600690 601127 000725 603486 002920",
    "consumer-staples": "600519 000858 600887 603288 002714 000895 000568 600809 300498 605499",
    "health-care": "600276 603259 300760 600436 300015 000538 600196 300122 002422 300347",
    "financials": "601398 601939 600036 601318 600030 300059 601166 601628 601328 601211",
    "information-technology": "688981 688041 688256 002371 300308 601138 002230 002475 603986 000938",
    "communication-services": "600941 600050 601728 000063 600745 688036 002281 600487 600498 002555",
    "utilities": "600900 600025 600886 600674 601985 600905 600795 600011 601991 000027",
    "real-estate": "600048 000002 001979 600383 002244 601155 600895 600663 001914 600606",
}


def _baostock_symbol(symbol: str) -> str:
    return f"{'sh' if symbol.startswith(('5', '6')) else 'bj' if symbol.startswith(('4', '8', '9')) else 'sz'}.{symbol}"


def _catalog(pool: dict[str, str], market: str) -> dict[str, list[dict]]:
    return {
        sector: [
            {
                "symbol": symbol,
                "providerSymbol": (_baostock_symbol(symbol) if market == "china" else symbol.replace("BRK.B", "BRK-B")),
                "name": symbol,
            }
            for symbol in symbols.split()
        ]
        for sector, symbols in pool.items()
    }


SECTOR_CONSTITUENTS = {
    "china": _catalog(CN_POOLS, "china"),
    "united-states": _catalog(US_POOLS, "united-states"),
}


def _stock_evidence(item: dict, rows: list[dict], range_id: str, custom_start: str | None) -> dict:
    snapshot = build_capital_flow_snapshot(rows, include_history=False)
    selected = select_signal_rows(rows, range_id, custom_start)
    start, end = selected[0], selected[-1]
    start_close, end_close = float(start["close"]), float(end["close"])
    change = (end_close / start_close - 1) * 100 if start_close else 0.0
    return {
        **item,
        "asOf": str(end["date"])[:10],
        "close": round(end_close, 4),
        "priceChange": round(change, 2),
        "flowScore": snapshot["score"],
        "flowRatio": snapshot["metrics"]["flowRatio"]["20d"],
        "state": snapshot["state"],
        "confidence": snapshot["confidence"],
    }


def _available_bundle(market_id: str, symbols: list[str], force: bool) -> dict[str, list[dict]]:
    """Return partial data when a curated pool contains a temporarily unavailable ticker."""
    getter = get_baostock_series if market_id == "china" else get_yfinance_series
    try:
        return getter(symbols, force=force, minimum=21)
    except RuntimeError:
        available = {}
        for symbol in symbols:
            try:
                available.update(getter([symbol], force=force, minimum=21))
            except RuntimeError:
                continue
        return available


def build_sector_constituents(
    market_id: str, sector_id: str, *, range_id: str = "1m", custom_start: str | None = None,
    force: bool = False,
) -> dict:
    range_id, custom_start = validate_signal_range(range_id, custom_start or "")
    if market_id not in SECTOR_CONSTITUENTS:
        raise ValueError("市场不受支持")
    if sector_id not in SECTOR_CONSTITUENTS[market_id]:
        raise ValueError("板块不受支持")
    catalog = SECTOR_CONSTITUENTS[market_id][sector_id]
    provider_symbols = [item["providerSymbol"] for item in catalog]
    bundle = _available_bundle(market_id, provider_symbols, force)
    stocks = [
        _stock_evidence(item, bundle[item["providerSymbol"]], range_id, custom_start)
        for item in catalog if bundle.get(item["providerSymbol"])
    ]
    by_symbol = {stock["symbol"]: stock for stock in stocks}
    symbols = lambda items: [item["symbol"] for item in items]
    core = [by_symbol[item["symbol"]] for item in catalog[:10] if item["symbol"] in by_symbol]
    inflow = sorted(stocks, key=lambda item: (-item["flowScore"], -float(item["flowRatio"] or 0)))[:10]
    outflow = sorted(stocks, key=lambda item: (item["flowScore"], float(item["flowRatio"] or 0)))[:10]
    movers = sorted(stocks, key=lambda item: -abs(item["priceChange"]))[:10]
    return {
        "marketId": market_id,
        "sectorId": sector_id,
        "title": SECTOR_TITLES[sector_id],
        "asOf": max((stock["asOf"] for stock in stocks), default=None),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": {
            "name": "BaoStock" if market_id == "china" else "Yahoo Finance via yfinance",
            "access": "无需 API Key",
            "constituentMode": "公开研究成分池",
            "upstream": "czcode0501/sector-flow" if market_id == "united-states" else "流动性代表股研究池",
        },
        "range": {"id": range_id, "start": custom_start, "end": max((stock["asOf"] for stock in stocks), default=None)},
        "stocks": stocks,
        "groups": {
            "core": symbols(core), "strongestInflow": symbols(inflow),
            "strongestOutflow": symbols(outflow), "movers": symbols(movers),
        },
    }
