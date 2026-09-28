// SPY + QQQ Alert Bot — ek hi file. GitHub Actions ise har 5 min chalata hai.
// SPY: 15M Liquidity Grab + Sweep Reversal (15m/1h), sirf volume >= 2x. QQQ: 5M Liquidity Grab (6/6) + 15M Sweep Reversal (Strong volume).
// src/run.js
import fs from "node:fs";

// src/time.js
var fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});
function nyParts(date = /* @__PURE__ */ new Date()) {
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  let hour = parseInt(p.hour, 10);
  if (hour === 24) hour = 0;
  return {
    weekday: p.weekday,
    date: `${p.year}-${p.month}-${p.day}`,
    hour,
    minute: parseInt(p.minute, 10),
    minOfDay: hour * 60 + parseInt(p.minute, 10)
  };
}
var nyPartsFromSec = (sec) => nyParts(new Date(sec * 1e3));
var OPEN_MIN = 9 * 60 + 30;
var CLOSE_MIN = 16 * 60;

// src/indicators.js
function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}
function atr(bars, period = 14) {
  const out = new Array(bars.length).fill(null);
  const tr = bars.map((b, i) => i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c)));
  if (bars.length < period) return out;
  let prev = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < bars.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}
function avgVolumeBefore(bars, i, n = 20) {
  const s = bars.slice(Math.max(0, i - n), i);
  if (!s.length) return 0;
  return s.reduce((a, b) => a + b.v, 0) / s.length;
}

// src/strategies/spy-15m-liquidity-grab.js
var LOOKBACK = 20;
var RSI_PERIOD = 14;
var TOL_PCT = 5e-4;
var MIN_SCORE = 5;
var REQUIRE_GRAB = true;
var STOP_BUFFER = 0.1;
var RR = 2;
var mark = (ok) => ok ? "\u2705" : "\u274C";
function checkCall(bars, r) {
  const i = bars.length - 1;
  const s = i - 1;
  if (s - LOOKBACK < 0 || r[i] == null || r[i - 1] == null) return null;
  const sweep = bars[s], next = bars[i];
  const prior = bars.slice(s - LOOKBACK, s);
  const liqLow = Math.min(...prior.map((b) => b.l));
  const tol = sweep.c * TOL_PCT;
  const c = {
    liq: Number.isFinite(liqLow),
    grab: sweep.l <= liqLow + tol,
    red: sweep.c < sweep.o && sweep.c > liqLow,
    green: next.c > next.o,
    rsi: r[i] > r[i - 1],
    vol: sweep.v > avgVolumeBefore(bars, s, LOOKBACK)
  };
  const score = Object.values(c).filter(Boolean).length;
  if (score < MIN_SCORE || REQUIRE_GRAB && !c.grab) return null;
  const entry = next.c;
  const stop = Math.min(sweep.l, next.l) - STOP_BUFFER;
  return {
    direction: "CALL",
    score,
    entry,
    stop,
    relVol: sweep.v / (avgVolumeBefore(bars, s, LOOKBACK) || 1),
    target: entry + RR * (entry - stop),
    confidence: score === 6 ? "High" : "Medium",
    pct: score / 6 * 100,
    notes: `${score}/6 | ${mark(c.liq)} LiqLow ${liqLow.toFixed(2)} ${mark(c.grab)} Grab ${mark(c.red)} Red rejection ${mark(c.green)} Next green ${mark(c.rsi)} RSI up (${r[i].toFixed(1)}) ${mark(c.vol)} Volume`
  };
}
function checkPut(bars, r) {
  const i = bars.length - 1;
  if (i - LOOKBACK < 0 || r[i] == null || r[i - 1] == null) return null;
  const sweep = bars[i];
  const prior = bars.slice(i - LOOKBACK, i);
  const liqHigh = Math.max(...prior.map((b) => b.h));
  const tol = sweep.c * TOL_PCT;
  const c = {
    liq: Number.isFinite(liqHigh),
    grab: sweep.h >= liqHigh - tol,
    red: sweep.c < sweep.o && sweep.c < liqHigh,
    next: true,
    rsi: r[i] < r[i - 1],
    vol: sweep.v > avgVolumeBefore(bars, i, LOOKBACK)
  };
  const score = Object.values(c).filter(Boolean).length;
  if (score < MIN_SCORE || REQUIRE_GRAB && !c.grab) return null;
  const entry = sweep.c;
  const stop = sweep.h + STOP_BUFFER;
  return {
    direction: "PUT",
    score,
    entry,
    stop,
    relVol: sweep.v / (avgVolumeBefore(bars, i, LOOKBACK) || 1),
    target: entry - RR * (stop - entry),
    confidence: score === 6 ? "High" : "Medium",
    pct: score / 6 * 100,
    notes: `${score}/6 | ${mark(c.liq)} LiqHigh ${liqHigh.toFixed(2)} ${mark(c.grab)} Grab ${mark(c.red)} Red rejection \u2705 Next (auto) ${mark(c.rsi)} RSI down (${r[i].toFixed(1)}) ${mark(c.vol)} Volume`
  };
}
var spy_15m_liquidity_grab_default = {
  id: "spy_15m_liq_grab",
  name: "SPY 15M Liquidity Grab",
  timeframes: ["15m"],
  maxPerDay: 5,
  minConfidence: "Medium",
  evaluate(bars) {
    if (bars.length < LOOKBACK + 3) return null;
    const r = rsi(bars.map((b) => b.c), RSI_PERIOD);
    const a = atr(bars, 14).at(-1);
    const call = checkCall(bars, r);
    const put = checkPut(bars, r);
    for (const x of [call, put]) if (x) x.atr = a;
    if (call && put) {
      if (call.score === put.score) return null;
      return call.score > put.score ? call : put;
    }
    return call || put;
  }
};

// src/strategies/liq-sweep-reversal.js
var LOOKBACK2 = 40;
var PIVOT = 2;
var SWEEP_WINDOW = 5;
var MIN_BOUNCE_ATR = 0.3;
var MIN_BODY = 0.5;
var MIN_CLOSE_LOC = 0.6;
var REQUIRE_RECLAIM = false;
var BUF = 0.01;
var isPivotLow = (b, k) => {
  for (let j = 1; j <= PIVOT; j++) if (!(b[k].l < b[k - j].l && b[k].l <= b[k + j].l)) return false;
  return true;
};
var isPivotHigh = (b, k) => {
  for (let j = 1; j <= PIVOT; j++) if (!(b[k].h > b[k - j].h && b[k].h >= b[k + j].h)) return false;
  return true;
};
var strongGreen = (x) => {
  const r = x.h - x.l;
  if (r <= 0 || x.c <= x.o) return false;
  return (x.c - x.o) / r >= MIN_BODY && (x.c - x.l) / r >= MIN_CLOSE_LOC;
};
function core(bars) {
  const i = bars.length - 1, g = bars[i];
  if (!strongGreen(g)) return null;
  let s = i;
  for (let k = i; k >= i - SWEEP_WINDOW; k--) if (bars[k].l < bars[s].l) s = k;
  for (let k = s + 1; k < i; k++) if (strongGreen(bars[k])) return null;
  const a = atr(bars, 14)[i];
  if (!a) return null;
  let L = null;
  for (let k = s - PIVOT - 1; k >= Math.max(PIVOT, i - LOOKBACK2); k--) {
    if (!isPivotLow(bars, k)) continue;
    const lvl = bars[k].l;
    if (bars[s].l >= lvl) continue;
    let untouched = true, hi = -Infinity;
    for (let m = k + 1; m < s; m++) {
      if (bars[m].l < lvl) {
        untouched = false;
        break;
      }
      hi = Math.max(hi, bars[m].h);
    }
    if (!untouched || hi - lvl < MIN_BOUNCE_ATR * a) continue;
    L = lvl;
    break;
  }
  if (L == null) return null;
  const reclaim = g.c > L;
  if (REQUIRE_RECLAIM && !reclaim) return null;
  const entry = g.h + BUF, stop = g.l - BUF, R = entry - stop;
  let target = null;
  for (let k = i - PIVOT; k >= Math.max(PIVOT, i - LOOKBACK2 * 2); k--) {
    if (isPivotHigh(bars, k) && bars[k].h > entry + 0.3 * R && (target == null || bars[k].h < target)) target = bars[k].h;
  }
  const fromPivot = target != null;
  if (!fromPivot) target = entry + 2 * R;
  return {
    entry,
    stop,
    target,
    L,
    sweep: bars[s].l,
    reclaim,
    fromPivot,
    volOK: g.v > avgVolumeBefore(bars, i, 20),
    rr: (target - entry) / R,
    relVol: g.v / (avgVolumeBefore(bars, i, 20) || 1),
    atr: a
  };
}
var mirror = (bars) => bars.map((b) => ({ ...b, o: -b.o, h: -b.l, l: -b.h, c: -b.c }));
var liq_sweep_reversal_default = {
  id: "liq_sweep_reversal",
  name: "Liquidity Sweep Reversal",
  timeframes: ["15m", "1h", "4h"],
  maxPerDay: 3,
  minConfidence: "Medium",
  evaluate(bars) {
    if (bars.length < 30) return null;
    let r = core(bars), direction = "CALL";
    if (!r) {
      const m = core(mirror(bars));
      if (!m) return null;
      direction = "PUT";
      r = { ...m, entry: -m.entry, stop: -m.stop, target: -m.target, L: -m.L, sweep: -m.sweep };
    }
    const call = direction === "CALL";
    const f = (x) => x.toFixed(2);
    return {
      direction,
      entry: r.entry,
      stop: r.stop,
      target: r.target,
      relVol: r.relVol,
      atr: r.atr,
      confidence: r.reclaim && r.volOK ? "High" : "Medium",
      // % = kitne checks pass hue (jeetne ki probability NAHI)
      pct: 50 + (r.reclaim ? 15 : 0) + (r.volOK ? 15 : 0) + (r.rr >= 1.5 ? 10 : 0) + (r.fromPivot ? 10 : 0),
      notes: `Liquidity ${f(r.L)} \u2192 sweep ${call ? "low" : "high"} ${f(r.sweep)} \u2192 ${call ? "green" : "red"} candle. Entry sirf ${f(r.entry)} ${call ? "upar" : "neeche"} tootne pe! | Reclaim ${r.reclaim ? "\u2705" : "\u274C"} | Volume ${r.volOK ? "\u2705" : "\u274C"} | TP = ${r.fromPivot ? `next liquidity (swing ${call ? "high" : "low"})` : "2R"} | R:R 1:${r.rr.toFixed(1)}`
    };
  }
};

// src/strategies/qqq-liq-sweep.js
var MIN_REL_VOL = 1.5;
var qqq_liq_sweep_default = {
  id: "qqq_liq_sweep",
  name: "QQQ Liquidity Sweep Reversal",
  symbol: "QQQ",
  timeframes: ["15m"],
  // 5m pe ab QQQ 5M Liquidity Grab chalti hai
  maxPerDay: 3,
  minConfidence: "Medium",
  evaluate(bars, ctx) {
    const sig = liq_sweep_reversal_default.evaluate(bars, ctx);
    if (!sig || !(sig.relVol >= MIN_REL_VOL)) return null;
    return sig;
  },
  // QQQ CALL 🟢 (bold) / Price (entry trigger) / Volume
  format(sig) {
    const call = sig.direction === "CALL";
    const vol = `\u{1F4AA} Strong (${sig.relVol.toFixed(1)}x)`;
    return [
      `<b>QQQ ${call ? "CALL \u{1F7E2}" : "PUT \u{1F534}"}</b>`,
      `Price: ${sig.entry.toFixed(2)}`,
      `Volume: ${vol}`
    ].join("\n");
  }
};

// src/strategies/qqq-5m-liquidity-grab.js
var LOOKBACK3 = 20;
var RSI_PERIOD2 = 14;
var TOL_PCT2 = 5e-4;
var MIN_SCORE2 = 6;
var REQUIRE_GRAB2 = true;
var VOL_MULT = 1;
var STOP_BUFFER2 = 0.1;
var RR2 = 2;
function qqqGrab(bars, opts = {}) {
  const o = { REQUIRE_GRAB: REQUIRE_GRAB2, VOL_MULT, MIN_SCORE: MIN_SCORE2, ...opts };
  if (bars.length < LOOKBACK3 + 3) return null;
  const r = rsi(bars.map((b) => b.c), RSI_PERIOD2);
  const i = bars.length - 1, s = i - 1;
  const sweep = bars[s], next = bars[i];
  if (r[i] == null || r[i - 1] == null) return null;
  const prior = bars.slice(s - LOOKBACK3, s);
  const tol = sweep.c * TOL_PCT2;
  const avgV = avgVolumeBefore(bars, s, LOOKBACK3) || 1;
  const relVol = sweep.v / avgV;
  const volOK = sweep.v > avgV * o.VOL_MULT;
  const a = atr(bars, 14)[i];
  const liqLow = Math.min(...prior.map((b) => b.l));
  const cc = {
    liq: true,
    grab: sweep.l <= liqLow + tol,
    red: sweep.c < sweep.o && sweep.c > liqLow,
    green: next.c > next.o,
    rsi: r[i] > r[i - 1],
    vol: volOK
  };
  const cScore = Object.values(cc).filter(Boolean).length;
  if (cScore >= o.MIN_SCORE && (!o.REQUIRE_GRAB || cc.grab)) {
    const entry = next.c, stop = Math.min(sweep.l, next.l) - STOP_BUFFER2;
    return {
      direction: "CALL",
      entry,
      stop,
      target: entry + RR2 * (entry - stop),
      confidence: cScore === 6 ? "High" : "Medium",
      pct: cScore / 6 * 100,
      relVol,
      atr: a
    };
  }
  const liqHigh = Math.max(...prior.map((b) => b.h));
  const nextOK = next.c < next.o && next.c <= sweep.c;
  if (!nextOK) return null;
  const pc = {
    liq: true,
    grab: sweep.h >= liqHigh - tol,
    red: sweep.c < sweep.o && sweep.c < liqHigh,
    next: true,
    rsi: r[i] < r[i - 1],
    vol: volOK
  };
  const pScore = Object.values(pc).filter(Boolean).length;
  if (pScore >= o.MIN_SCORE && (!o.REQUIRE_GRAB || pc.grab)) {
    const entry = next.c, stop = Math.max(sweep.h, next.h) + STOP_BUFFER2;
    return {
      direction: "PUT",
      entry,
      stop,
      target: entry - RR2 * (stop - entry),
      confidence: pScore === 6 ? "High" : "Medium",
      pct: pScore / 6 * 100,
      relVol,
      atr: a
    };
  }
  return null;
}
var qqq_5m_liquidity_grab_default = {
  id: "qqq_5m_liq_grab",
  name: "QQQ 5M Liquidity Grab",
  symbol: "QQQ",
  timeframes: ["5m"],
  maxPerDay: 3,
  minConfidence: "Medium",
  evaluate: (bars) => qqqGrab(bars),
  format(sig) {
    const call = sig.direction === "CALL";
    const vol = sig.relVol >= 1.5 ? "\u{1F4AA} Strong" : sig.relVol >= 0.8 ? "Normal" : "\u26A0\uFE0F Weak";
    return [
      `<b>QQQ ${call ? "CALL \u{1F7E2}" : "PUT \u{1F534}"}</b>`,
      `Price: ${sig.entry.toFixed(2)}`,
      `Volume: ${vol} (${sig.relVol.toFixed(1)}x)`
    ].join("\n");
  }
};

// src/strategies/index.js
// SPY: sirf HIGH volume pe alert (signal candle volume >= average x SPY_MIN_REL_VOL)
var SPY_MIN_REL_VOL = 2;
var spyVolFilter = (st, extra = {}) => ({
  ...st,
  ...extra,
  evaluate(bars, ctx) {
    const sig = st.evaluate(bars, ctx);
    if (!sig || !(sig.relVol >= SPY_MIN_REL_VOL)) return null;
    return sig;
  }
});
var strategies_default = [
  spyVolFilter(spy_15m_liquidity_grab_default),
  // SPY 15m  — Liquidity Grab (volume >= 2x)
  spyVolFilter(liq_sweep_reversal_default, { timeframes: ["15m", "1h"] }),
  // SPY 15m / 1h — Sweep Reversal (volume >= 2x), 4h band
  qqq_liq_sweep_default,
  // QQQ 15m — Sweep Reversal (sirf Strong volume)
  qqq_5m_liquidity_grab_default
  // QQQ 5m  — Liquidity Grab (6/6)
];

// src/data.js
var TF = {
  "5m": { sec: 300, yahoo: "5m", range: "5d", alpaca: "5Min", days: 7 },
  "15m": { sec: 900, yahoo: "15m", range: "10d", alpaca: "15Min", days: 14 },
  "1h": { sec: 3600, yahoo: "60m", range: "1mo", alpaca: "1Hour", days: 40 },
  // 4h: Yahoo mein nahi hota — 1h candles jod ke banate hain (9:30-13:30, 13:30-16:00 ET)
  "4h": { sec: 14400, yahoo: "60m", range: "3mo", alpaca: "1Hour", days: 90, from1h: true }
};
function to4h(bars) {
  const out = [];
  let cur = null, key = null;
  for (const b of bars) {
    const n = nyPartsFromSec(b.t);
    const k = n.date + ":" + Math.floor((n.minOfDay - OPEN_MIN) / 240);
    if (k !== key) {
      if (cur) out.push(cur);
      key = k;
      cur = { ...b };
    } else {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v;
    }
  }
  if (cur) out.push(cur);
  return out;
}
async function fetchYahoo(symbol, tf) {
  const c = TF[tf];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${c.yahoo}&range=${c.range}&includePrePost=false`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  const j = await res.json();
  const r = j?.chart?.result?.[0];
  if (!r || !r.timestamp) throw new Error("Yahoo: no data");
  const q = r.indicators.quote[0];
  const bars = [];
  r.timestamp.forEach((t, i) => {
    if (q.open[i] == null || q.close[i] == null) return;
    bars.push({ t, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] || 0 });
  });
  return bars;
}
async function fetchAlpaca(env2, symbol, tf) {
  if (!env2.ALPACA_KEY_ID || !env2.ALPACA_SECRET) throw new Error("Alpaca keys missing");
  const c = TF[tf];
  const start = new Date(Date.now() - c.days * 864e5).toISOString();
  let url = `https://data.alpaca.markets/v2/stocks/${symbol}/bars?timeframe=${c.alpaca}&start=${start}&limit=10000&feed=iex&adjustment=raw`;
  const bars = [];
  for (let page = 0; page < 5 && url; page++) {
    const res = await fetch(url, {
      headers: { "APCA-API-KEY-ID": env2.ALPACA_KEY_ID, "APCA-API-SECRET-KEY": env2.ALPACA_SECRET }
    });
    if (!res.ok) throw new Error(`Alpaca HTTP ${res.status}`);
    const j = await res.json();
    for (const b of j.bars || []) {
      bars.push({ t: Math.floor(Date.parse(b.t) / 1e3), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
    }
    url = j.next_page_token ? url.replace(/&page_token=[^&]*/, "") + `&page_token=${j.next_page_token}` : null;
  }
  return bars.filter((b) => {
    const n = nyPartsFromSec(b.t);
    return n.minOfDay >= (tf === "1h" ? 9 * 60 : OPEN_MIN) && n.minOfDay < CLOSE_MIN;
  });
}
async function getClosedBars(env2, symbol, tf) {
  let bars = env2.DATA_PROVIDER === "alpaca" ? await fetchAlpaca(env2, symbol, tf) : await fetchYahoo(symbol, tf);
  bars = bars.filter((b) => {
    const m = nyPartsFromSec(b.t).minOfDay;
    return m >= OPEN_MIN - 30 && m < CLOSE_MIN;
  });
  if (TF[tf].from1h) bars = to4h(bars);
  if (!bars.length) return bars;
  const nowSec = Math.floor(Date.now() / 1e3);
  const marketStillOpen = nyParts().minOfDay < CLOSE_MIN;
  const last = bars[bars.length - 1];
  if (marketStillOpen && last.t + TF[tf].sec > nowSec) bars.pop();
  return bars;
}

// src/telegram.js
async function sendTelegram(env2, text, parseMode) {
  const res = await fetch(`https://api.telegram.org/bot${env2.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: env2.TELEGRAM_CHAT_ID,
      text,
      disable_web_page_preview: true,
      ...parseMode ? { parse_mode: parseMode } : {}
    })
  });
  if (!res.ok) throw new Error(`Telegram HTTP ${res.status}: ${await res.text()}`);
}
var SHOW_LEVELS = true;
var TF_LABEL = { "5m": "5 MIN", "15m": "15 MIN", "1h": "1 HOUR", "4h": "4 HOUR" };
function volLabel(rv) {
  if (rv == null || !isFinite(rv)) return null;
  const tag = rv >= 1.5 ? "\u{1F4AA} Strong" : rv >= 0.8 ? "Normal" : "\u26A0\uFE0F Weak";
  return `\u{1F50A} Volume: ${tag} (${rv.toFixed(1)}x)`;
}
function formatAlert(symbol, tf, strategy, sig) {
  const call = sig.direction === "CALL";
  const pct = sig.pct ?? (sig.confidence === "High" ? 80 : sig.confidence === "Medium" ? 60 : 40);
  const lines = [
    symbol,
    call ? "\u{1F7E2} BUY CALL" : "\u{1F534} BUY PUT",
    `\u23F1 ${TF_LABEL[tf] || tf}`,
    `\u{1F4CA} ${Math.round(pct)}%`
  ];
  const v = volLabel(sig.relVol);
  if (v) lines.push(v);
  if (SHOW_LEVELS) {
    lines.push("", `Entry ${sig.entry.toFixed(2)} | SL ${sig.stop.toFixed(2)} | TP ${sig.target.toFixed(2)}`);
  }
  return lines.join("\n");
}

// src/run.js
var env = process.env;
var MODE = (env.RUN_MODE || "normal").toLowerCase();
var MAX_AGE_MIN = parseInt(env.MAX_ALERT_AGE_MIN || "30", 10);
var STATE_FILE = ".state/state.json";
var RANK = { Low: 0, Medium: 1, High: 2 };
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { processed: {}, counts: {}, errDay: {} };
  }
}
function saveState(st) {
  fs.mkdirSync(".state", { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(st));
}
async function main() {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) throw new Error("Telegram secrets missing");
  if (MODE === "test") {
    await sendTelegram(env, "\u2705 Test \u2014 GitHub SPY alert bot connected hai!");
    console.log("test message sent");
    return;
  }
  const now = nyParts();
  const force = MODE === "force";
  const weekend = now.weekday === "Sat" || now.weekday === "Sun";
  if (!force && (weekend || now.minOfDay < OPEN_MIN + 5 || now.minOfDay > CLOSE_MIN + 30)) {
    console.log("market window ke bahar \u2014 skip", now);
    return;
  }
  const st = loadState();
  const defSym = env.SYMBOL || "SPY";
  const symOf = (s) => s.symbol || defSym;
  const nowSec = Math.floor(Date.now() / 1e3);
  const pairs = [...new Set(strategies_default.flatMap((s) => s.timeframes.map((tf) => `${symOf(s)}|${tf}`)))];
  for (const pair of pairs) {
    const [symbol, tf] = pair.split("|");
    let bars;
    try {
      bars = await getClosedBars(env, symbol, tf);
    } catch (e) {
      console.error(tf, e);
      if (st.errDay[pair] !== now.date) {
        st.errDay[pair] = now.date;
        try {
          await sendTelegram(env, `\u26A0\uFE0F Data error (${symbol} ${tf}): ${String(e).slice(0, 200)}`);
        } catch {
        }
      }
      continue;
    }
    if (!bars.length) continue;
    for (const s of strategies_default.filter((s2) => s2.timeframes.includes(tf) && symOf(s2) === symbol)) {
      const pkey = `${s.id}:${tf}`;
      const lastDone = st.processed[pkey] || 0;
      let idxs = [];
      if (force) {
        idxs = [bars.length - 1];
      } else {
        for (let i = Math.max(0, bars.length - 12); i < bars.length; i++) {
          const b = bars[i];
          if (b.t > lastDone && nyPartsFromSec(b.t).date === now.date) idxs.push(i);
        }
        if (!lastDone && idxs.length > 1) idxs = idxs.slice(-1);
      }
      for (const i of idxs) {
        const sub = bars.slice(0, i + 1);
        const closeT = bars[i].t + TF[tf].sec;
        const ageMin = Math.max(0, Math.round((nowSec - closeT) / 60));
        let sig = null;
        try {
          sig = s.evaluate(sub, { symbol, tf });
        } catch (e) {
          console.error(s.id, e);
          continue;
        }
        if (!sig || RANK[sig.confidence] < RANK[s.minConfidence || "Low"]) {
          console.log(`${s.id} ${tf} ${bars[i].t}: WAIT`);
          continue;
        }
        if (!force && ageMin > MAX_AGE_MIN) {
          console.log(`${s.id} ${tf}: signal tha par ${ageMin} min purana \u2014 skip`);
          continue;
        }
        const ckey = `${pkey}:${now.date}`;
        const count = st.counts[ckey] || 0;
        if (!force && s.maxPerDay && count >= s.maxPerDay) {
          console.log(`${s.id} ${tf}: daily limit`);
          continue;
        }
        let text = s.format ? s.format(sig, tf) : formatAlert(symbol, tf, s, sig, bars[i].t);
        if (!force && ageMin > 10) text = `\u23F0 ${ageMin} min late
` + text;
        await sendTelegram(env, text, s.format ? "HTML" : void 0);
        if (!force) st.counts[ckey] = count + 1;
        console.log(`${s.id} ${tf}: ${sig.direction} ENTRY sent`);
      }
      if (!force) st.processed[pkey] = Math.max(lastDone, bars[bars.length - 1].t);
    }
  }
  for (const k of Object.keys(st.counts)) if (!k.endsWith(now.date)) delete st.counts[k];
  saveState(st);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
