# SPY Alert Bot (Cloudflare Worker + Telegram)

Har 5 min market hours (9:30 AM–4:00 PM ET, Mon–Fri) mein chalta hai.
5m / 15m / 1h — jis timeframe ki candle close hoti hai, us pe teri strategies check hoti hain.
Setup bane to seedha Telegram pe alert. Claude ya computer on rakhne ki zarurat nahi.

## 1. Telegram bot banao
1. Telegram mein **@BotFather** kholo → `/newbot` → naam do → **token** copy karo.
2. Apne naye bot ko koi bhi message bhejo (jaise "hi").
3. Browser mein kholo: `https://api.telegram.org/bot<TOKEN>/getUpdates`
   → `"chat":{"id": 123456789 ...}` wala number = **chat ID**.

## 2. Cloudflare setup (free account kaafi hai)
```bash
npm install
npx wrangler login
npx wrangler kv namespace create STATE
```
Jo `id` mile use `wrangler.toml` mein `PASTE_YOUR_KV_ID_HERE` ki jagah daalo.

## 3. Secrets daalo (code mein kabhi mat likhna)
```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler secret put ADMIN_KEY        # koi bhi lamba random password
```

## 4. Deploy
```bash
npx wrangler deploy
```

## 5. Test
- Telegram test: `https://spy-alert-bot.<tera-subdomain>.workers.dev/test?key=ADMIN_KEY`
- Strategy abhi chalao (market band ho tab bhi): `.../run?key=ADMIN_KEY&force=1`
- Live logs: `npx wrangler tail`

## Nayi strategy add karna
1. `src/strategies/_template.js` copy karo → naya naam do.
2. `evaluate()` mein conditions likho, `timeframes` set karo (`'5m'`, `'15m'`, `'1h'`).
3. `src/strategies/index.js` mein import karke list mein add karo.
4. `npx wrangler deploy`

Example strategy (`example-ema-vwap-rsi.js`) sirf demo hai — use hata ke apni daalo.

## Data source
- Default **Yahoo** (free, no key). Agar `Data error` alert aaye (Yahoo kabhi kabhi block karta hai):
  free Alpaca account banao → `wrangler.toml` mein `DATA_PROVIDER = "alpaca"` →
  `npx wrangler secret put ALPACA_KEY_ID` aur `ALPACA_SECRET`.
  Note: Alpaca free = IEX feed, volume poore market ka nahi hota, aur 1h candles clock-hour pe align hoti hain.

## Limits / notes
- Har strategy har candle pe sirf ek baar check hoti hai (duplicate alert nahi).
- `maxPerDay` se din ke alerts limit karo.
- Market holidays pe nayi candle nahi aati → alert nahi aata.
- Cloudflare free KV: ~1000 writes/day. Ek strategy teeno timeframes pe ≈ 115 writes/day, to ~8 strategies tak aaram se.
- Strike sirf approx ATM hai (option chain check nahi hoti). Spread/premium khud dekhna.
- Ye sirf alert tool hai, financial advice nahi.
