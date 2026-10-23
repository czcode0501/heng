// 常规交易时段（不含交易所节假日）；节假日以交易所公告为准。
const MARKET_SESSIONS = Object.freeze({
  china: {
    label: "A股",
    timeZone: "Asia/Shanghai",
    sessions: [["09:30", "11:30"], ["13:00", "15:00"]],
    preOpen: "09:15",
    middayBreak: ["11:30", "13:00"],
  },
  "united-states": {
    label: "美股",
    timeZone: "America/New_York",
    sessions: [["09:30", "16:00"]],
    preOpen: "04:00",
    afterHoursEnd: "20:00",
  },
});

function minutesOf(hhmm) {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return hours * 60 + minutes;
}

function localClock(now, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map(({ type, value }) => [type, value]),
  );
  return { weekday: parts.weekday, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

export function getMarketSession(marketId, now = new Date()) {
  const market = MARKET_SESSIONS[marketId];
  if (!market) throw new Error(`未知市场：${marketId}`);
  const { weekday, minutes } = localClock(now, market.timeZone);
  if (weekday === "Sat" || weekday === "Sun") return { marketId, state: "closed", label: `${market.label}休市` };
  if (market.sessions.some(([open, close]) => minutes >= minutesOf(open) && minutes < minutesOf(close))) {
    return { marketId, state: "open", label: `${market.label}交易中` };
  }
  if (market.middayBreak && minutes >= minutesOf(market.middayBreak[0]) && minutes < minutesOf(market.middayBreak[1])) {
    return { marketId, state: "break", label: `${market.label}午间休市` };
  }
  const firstOpen = minutesOf(market.sessions[0][0]);
  if (minutes >= minutesOf(market.preOpen) && minutes < firstOpen) {
    return { marketId, state: "pre-open", label: `${market.label}盘前` };
  }
  const lastClose = minutesOf(market.sessions.at(-1)[1]);
  if (market.afterHoursEnd && minutes >= lastClose && minutes < minutesOf(market.afterHoursEnd)) {
    return { marketId, state: "after-hours", label: `${market.label}盘后` };
  }
  return { marketId, state: "closed", label: minutes >= lastClose ? `${market.label}已收盘` : `${market.label}未开盘` };
}

export function describeMarketSessions(now = new Date()) {
  return ["china", "united-states"].map((marketId) => getMarketSession(marketId, now).label).join(" / ");
}
