"""Reusable RSI, MACD and VWAP series for OHLCV charts."""

from __future__ import annotations

import math


def _finite(value, fallback: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if math.isfinite(number) else fallback


def _rounded(value: float | None) -> float | None:
    return None if value is None else round(value, 6)


def calculate_technical_indicators(
    rows: list[dict],
    *,
    rsi_period: int = 14,
    macd_fast: int = 12,
    macd_slow: int = 26,
    macd_signal: int = 9,
    vwap_mode: str = "range",
    vwap_start: str = "",
) -> list[dict]:
    """Attach indicator values to copies of ordered OHLCV rows.

    Periods are bar counts. ``session`` VWAP resets on each row date while
    ``range`` VWAP stays anchored to the first supplied row.
    """

    if rsi_period < 1 or macd_fast < 1 or macd_slow <= macd_fast or macd_signal < 1:
        raise ValueError("技术指标周期设置不正确")
    if vwap_mode not in {"range", "session"}:
        raise ValueError("VWAP模式必须是 range 或 session")

    clean = [dict(row) for row in rows if isinstance(row, dict)]
    if not clean:
        return []

    fast_alpha = 2 / (macd_fast + 1)
    slow_alpha = 2 / (macd_slow + 1)
    signal_alpha = 2 / (macd_signal + 1)
    fast_ema = slow_ema = signal_ema = None
    previous_close = None
    gains: list[float] = []
    losses: list[float] = []
    average_gain = average_loss = None
    cumulative_price_volume = 0.0
    cumulative_volume = 0.0
    active_session = None

    for index, row in enumerate(clean):
        close = _finite(row.get("close"))
        high = _finite(row.get("high"), close)
        low = _finite(row.get("low"), close)
        volume = max(0.0, _finite(row.get("volume")))

        if previous_close is not None:
            change = close - previous_close
            gain = max(change, 0.0)
            loss = max(-change, 0.0)
            if average_gain is None:
                gains.append(gain)
                losses.append(loss)
                if len(gains) == rsi_period:
                    average_gain = sum(gains) / rsi_period
                    average_loss = sum(losses) / rsi_period
            else:
                average_gain = (average_gain * (rsi_period - 1) + gain) / rsi_period
                average_loss = (average_loss * (rsi_period - 1) + loss) / rsi_period

        rsi = None
        if average_gain is not None and average_loss is not None:
            if average_loss == 0:
                rsi = 100.0 if average_gain > 0 else 50.0
            else:
                relative_strength = average_gain / average_loss
                rsi = 100 - 100 / (1 + relative_strength)

        fast_ema = close if fast_ema is None else close * fast_alpha + fast_ema * (1 - fast_alpha)
        slow_ema = close if slow_ema is None else close * slow_alpha + slow_ema * (1 - slow_alpha)
        macd = fast_ema - slow_ema
        signal_ema = macd if signal_ema is None else macd * signal_alpha + signal_ema * (1 - signal_alpha)

        time_text = str(row.get("time") or "")
        session = str(row.get("date") or time_text[:10])
        vwap_is_active = not vwap_start or time_text >= vwap_start
        vwap = None
        if vwap_is_active:
            if vwap_mode == "session" and active_session != session:
                cumulative_price_volume = 0.0
                cumulative_volume = 0.0
                active_session = session
            typical_price = (high + low + close) / 3
            cumulative_price_volume += typical_price * volume
            cumulative_volume += volume
            vwap = cumulative_price_volume / cumulative_volume if cumulative_volume > 0 else typical_price

        row.update(
            {
                "rsi14": _rounded(rsi),
                "macd": _rounded(macd),
                "macdSignal": _rounded(signal_ema),
                "macdHistogram": _rounded(macd - signal_ema),
                "vwap": _rounded(vwap),
            }
        )
        previous_close = close

    return clean
