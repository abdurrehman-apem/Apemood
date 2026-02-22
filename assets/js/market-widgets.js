const COINGECKO_TRENDING = "https://api.coingecko.com/api/v3/search/trending";
const BINANCE_24H = "https://api.binance.com/api/v3/ticker/24hr";
const BINANCE_KLINES = "https://api.binance.com/api/v3/klines";
const CACHE_TTL_MS = 5 * 60 * 1000;

function fmt(num, d = 2) {
  const n = Number(num);
  if (!isFinite(n)) return "-";
  return n.toLocaleString(undefined, { maximumFractionDigits: d });
}
function pct(a, b) {
  if (!a) return 0;
  return ((b - a) / a) * 100;
}
function now() {
  return Date.now();
}
function getCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (now() - obj.t > CACHE_TTL_MS) return null;
    return obj.v;
  } catch {
    return null;
  }
}
function setCache(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify({ t: now(), v: val }));
  } catch {}
}
function setHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}
function coinCard({ title, subtitle, right, link }) {
  return `
    <a class="item" href="${link || "#"}" target="_blank" rel="noreferrer">
      <div class="left">
        <div class="title">${title}</div>
        <div class="sub">${subtitle || ""}</div>
      </div>
      <div class="right">${right || ""}</div>
    </a>
  `;
}
function injectMiniStyles() {
  const css = `
    .card{padding:16px;border:1px solid rgba(255,255,255,.08);border-radius:14px;margin:18px 0;}
    .grid{display:grid;gap:10px;margin-top:10px}
    .item{display:flex;justify-content:space-between;gap:14px;
      padding:12px 12px;border-radius:12px;
      border:1px solid rgba(255,255,255,.08);
      text-decoration:none;color:inherit;
    }
    .item:hover{border-color:rgba(255,255,255,.18)}
    .title{font-weight:700}
    .sub{opacity:.75;font-size:.92rem}
    .muted{opacity:.7}
    .right{text-align:right;white-space:nowrap}
    .controls{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-top:10px}
    select,button{padding:8px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:transparent;color:inherit}
    button{cursor:pointer}
  `;
  const style = document.createElement("style");
  style.innerHTML = css;
  document.head.appendChild(style);
}

async function loadTrending() {
  const cacheKey = "apemood_trending_v1";
  const cached = getCache(cacheKey);
  if (cached) return renderTrending(cached);
  const res = await fetch(COINGECKO_TRENDING);
  const data = await res.json();
  setCache(cacheKey, data);
  renderTrending(data);
}
function renderTrending(data) {
  const items = (data?.coins || [])
    .slice(0, 12)
    .map((x) => x?.item)
    .filter(Boolean);

  const html = items
    .map((c) =>
      coinCard({
        title: `${c.name} (${(c.symbol || "").toUpperCase()})`,
        subtitle: `Market Cap Rank: #${c.market_cap_rank ?? "-"} • Score: ${c.score ?? "-"}`,
        right: "🔥",
        link: `https://www.coingecko.com/en/coins/${c.id}`,
      })
    )
    .join("");

  setHTML("trendingList", html || `<div class="muted">No data</div>`);
}

function toCandle(k) {
  return { t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] };
}
function isBullishEngulfing(prev, last) {
  const prevRed = prev.c < prev.o;
  const lastGreen = last.c > last.o;
  return prevRed && lastGreen && last.o <= prev.c && last.c >= prev.o;
}
function analyzeCandles(candles, tf) {
  if (candles.length < 40) return null;

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const prev2 = candles[candles.length - 3];

  const lookback = 24;
  const slice = candles.slice(-lookback - 1, -1);

  const swingHigh = Math.max(...slice.map((x) => x.h));
  const swingLow = Math.min(...slice.map((x) => x.l));

  const dropAbs = Math.abs(pct(swingHigh, swingLow));
  const dropMin = tf === "15m" ? 6 : tf === "1h" ? 8 : 10;
  if (dropAbs < dropMin) return null;

  const green = last.c > last.o;
  if (!green) return null;

  const body = Math.abs(last.c - last.o);
  const range = last.h - last.l || 1;
  const bodyRatio = body / range;

  const engulf = isBullishEngulfing(prev, last);

  const turningUp = (prev2.c <= prev.c && prev.c <= last.c) || last.c > prev.h;
  if (!turningUp) return null;

  const reversalOK = engulf || bodyRatio >= 0.45;
  if (!reversalOK) return null;

  const bouncePct = pct(swingLow, last.c);

  const score =
    dropAbs * 1.2 +
    bodyRatio * 12 +
    (engulf ? 8 : 0) +
    Math.max(0, bouncePct) * 0.6;

  return { dropAbs, bouncePct, engulf, bodyRatio, score, lastClose: last.c };
}
async function loadBullishSignals() {
  const tf = document.getElementById("tf")?.value || "15m";
  const scanCount = Number(document.getElementById("scanCount")?.value || 60);

  setHTML("bullishList", `<div class="muted">Scanning USDT + USDC pairs…</div>`);

  const cacheKey = `apemood_universe_${scanCount}`;
  let universe = getCache(cacheKey);

  if (!universe) {
    const res = await fetch(BINANCE_24H);
    const tickers = await res.json();

    universe = tickers
      .filter((t) => {
        const s = t.symbol;
        const isQuote = s.endsWith("USDT") || s.endsWith("USDC");
        const isLeveraged =
          s.includes("UPUSDT") ||
          s.includes("DOWNUSDT") ||
          s.includes("BULL") ||
          s.includes("BEAR");
        return isQuote && !isLeveraged;
      })
      .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
      .slice(0, scanCount)
      .map((t) => ({ symbol: t.symbol }));

    setCache(cacheKey, universe);
  }

  const limit = 80;
  const results = [];

  for (let i = 0; i < universe.length; i++) {
    const sym = universe[i].symbol;
    try {
      const url = `${BINANCE_KLINES}?symbol=${sym}&interval=${tf}&limit=${limit}`;
      const r = await fetch(url);
      const k = await r.json();
      if (!Array.isArray(k)) continue;

      const candles = k.map(toCandle);
      const a = analyzeCandles(candles, tf);
      if (a) results.push({ symbol: sym, ...a });
    } catch {}

    if ((i + 1) % 8 === 0) await new Promise((res) => setTimeout(res, 250));
  }

  results.sort((x, y) => y.score - x.score);
  renderBullish(results.slice(0, 12), tf);
}
function renderBullish(list, tf) {
  if (!list.length) {
    setHTML(
      "bullishList",
      `<div class="muted">No dip→reversal signals right now. Try another timeframe.</div>`
    );
    return;
  }

  const html = list
    .map((x, idx) => {
      const sym = x.symbol.endsWith("USDT")
        ? x.symbol.replace("USDT", "/USDT")
        : x.symbol.replace("USDC", "/USDC");

      const tags = [
        `Drop: -${fmt(x.dropAbs, 1)}%`,
        `Bounce: +${fmt(x.bouncePct, 1)}%`,
        x.engulf ? "Engulfing" : `Body: ${fmt(x.bodyRatio * 100, 0)}%`,
        `TF: ${tf}`,
      ].join(" • ");

      return coinCard({
        title: `${idx + 1}. ${sym}`,
        subtitle: tags,
        right: `<div><b>${fmt(x.lastClose, 6)}</b></div><div class="muted">Score ${fmt(
          x.score,
          1
        )}</div>`,
        link: `https://www.binance.com/en/trade/${x.symbol}?type=spot`,
      });
    })
    .join("");

  setHTML("bullishList", html);
}

(function init() {
  injectMiniStyles();

  loadBullishSignals();
  loadTrending();

  document.getElementById("refreshBullishBtn")?.addEventListener("click", async () => {
    try {
      Object.keys(localStorage).forEach((k) => {
        if (k.startsWith("apemood_")) localStorage.removeItem(k);
      });
    } catch {}
    await loadBullishSignals();
  });

  document.getElementById("tf")?.addEventListener("change", loadBullishSignals);
  document.getElementById("scanCount")?.addEventListener("change", loadBullishSignals);

  document.getElementById("refreshTrendingBtn")?.addEventListener("click", async () => {
    try {
      localStorage.removeItem("apemood_trending_v1");
    } catch {}
    await loadTrending();
  });
})();
