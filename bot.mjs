// SPY Alert Bot — ek hi file. GitHub Actions ise har 5 min chalata hai.
// Strategy settings neeche 'spy-15m-liquidity-grab' section mein hain.
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
function fmtET(sec) {
  const n = nyPartsFromSec(sec);
  const hh = String(n.hour).padStart(2, "0");
  const mm = String(n.minute).padStart(2, "0");
  return `${hh}:${mm} ET`;
}

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
var REQUIRE_GRAB = false;
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
    target: entry + RR * (entry - stop),
    confidence: score === 6 ? "High" : "Medium",
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
    target: entry - RR * (stop - entry),
    confidence: score === 6 ? "High" : "Medium",
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
    const call = checkCall(bars, r);
    const put = checkPut(bars, r);
    if (call && put) {
      if (call.score === put.score) return null;
      return call.score > put.score ? call : put;
    }
    return call || put;
  }
};

// src/strategies/index.js
var strategies_default = [
  spy_15m_liquidity_grab_default
];

// src/data.js
var TF = {
  "5m": { sec: 300, yahoo: "5m", range: "5d", alpaca: "5Min", days: 7 },
  "15m": { sec: 900, yahoo: "15m", range: "10d", alpaca: "15Min", days: 14 },
  "1h": { sec: 3600, yahoo: "60m", range: "1mo", alpaca: "1Hour", days: 40 }
};
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
  const bars = env2.DATA_PROVIDER === "alpaca" ? await fetchAlpaca(env2, symbol, tf) : await fetchYahoo(symbol, tf);
  if (!bars.length) return bars;
  const nowSec = Math.floor(Date.now() / 1e3);
  const marketStillOpen = nyParts().minOfDay < CLOSE_MIN;
  const last = bars[bars.length - 1];
  if (marketStillOpen && last.t + TF[tf].sec > nowSec) bars.pop();
  return bars;
}

// src/telegram.js
async function sendTelegram(env2, text) {
  const res = await fetch(`https://api.telegram.org/bot${env2.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env2.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true })
  });
  if (!res.ok) throw new Error(`Telegram HTTP ${res.status}: ${await res.text()}`);
}
var $ = (x) => `$${Number(x).toFixed(2)}`;
function formatAlert(symbol, tf, strategy, sig, candleT) {
  const tag = sig.direction === "CALL" ? "\u{1F7E2} CALL \u2014 ENTRY" : "\u{1F534} PUT \u2014 ENTRY";
  const strike = `${Math.round(sig.entry)}${sig.direction === "CALL" ? "C" : "P"}`;
  const lines = [
    tag,
    "",
    `\u2022 Ticker: ${symbol}`,
    `\u2022 Strategy: ${strategy.name} (${tf})`,
    `\u2022 Entry: ${$(sig.entry)}`,
    `\u2022 Stop-loss: ${$(sig.stop)}`,
    `\u2022 Target: ${$(sig.target)}`,
    `\u2022 Strike (approx ATM): ${strike}`,
    `\u2022 Confidence: ${sig.confidence}`,
    `\u2022 Candle: ${fmtET(candleT)}`
  ];
  if (sig.notes) lines.push(`\u2022 Info: ${sig.notes}`);
  lines.push("", "\u26A0\uFE0F Not financial advice \u2014 chart khud check karke trade lena.");
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
  const symbol = env.SYMBOL || "SPY";
  const nowSec = Math.floor(Date.now() / 1e3);
  const tfs = [...new Set(strategies_default.flatMap((s) => s.timeframes))];
  for (const tf of tfs) {
    let bars;
    try {
      bars = await getClosedBars(env, symbol, tf);
    } catch (e) {
      console.error(tf, e);
      if (st.errDay[tf] !== now.date) {
        st.errDay[tf] = now.date;
        try {
          await sendTelegram(env, `\u26A0\uFE0F Data error (${tf}): ${String(e).slice(0, 200)}`);
        } catch {
        }
      }
      continue;
    }
    if (!bars.length) continue;
    for (const s of strategies_default.filter((s2) => s2.timeframes.includes(tf))) {
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
        let text = formatAlert(symbol, tf, s, sig, bars[i].t);
        if (!force && ageMin > 10) text = `\u23F1 Late alert: candle ${ageMin} min pehle close hui (GitHub delay)

` + text;
        await sendTelegram(env, text);
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
