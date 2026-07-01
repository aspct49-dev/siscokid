// Vercel serverless function: caching proxy for the Shuffle weighted-wager API.
//
// Why this exists: Shuffle's endpoint intermittently returns HTTP 400 (often the
// majority of requests). Calling it directly from the browser on every page load
// means most visitors hit a failure and see fallback content. This function fetches
// it SERVER-SIDE with aggressive retries, then caches the good result at Vercel's
// CDN for ~10 minutes (serving stale up to a day while revalidating). The browser
// calls /api/leaderboard — same-origin, instant, and immune to Shuffle's flakiness.
//
// The competition window is the current Eastern-time (America/New_York) month.

const AFFILIATE_ID = '9ab3853d-dc5a-40f6-bad6-d7594ac9cff7';

// Offset (ms) such that Date.UTC(ET wall-clock parts) === actualUTC + offset.
function nyOffsetMs(date) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).reduce((a, x) => ((a[x.type] = x.value), a), {});
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - date.getTime();
}

// UTC ms of midnight America/New_York on the 1st of the given ET month (month0 = 0-11).
function etMonthStartUTC(year, month0) {
  const guess = Date.UTC(year, month0, 1, 0, 0, 0);
  return guess - nyOffsetMs(new Date(guess));
}

module.exports = async (req, res) => {
  // Current Eastern-time month: midnight ET on the 1st -> now, in seconds.
  const et = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric' })
    .formatToParts(new Date()).reduce((a, x) => ((a[x.type] = x.value), a), {});
  const startTime = Math.floor(etMonthStartUTC(+et.year, +et.month - 1) / 1000);
  const endTime = Math.floor(Date.now() / 1000);
  const url = `https://affiliate.shuffle.com/wager/${AFFILIATE_ID}?startTime=${startTime}&endTime=${endTime}`;

  let data;
  let lastErr;
  for (let i = 0; i < 15; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      data = await r.json();
      break;
    } catch (err) {
      lastErr = err;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  if (!Array.isArray(data)) {
    // Upstream failed every retry. Don't cache the error; let stale-while-revalidate
    // keep serving the last good response to visitors.
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: 'upstream_unavailable', detail: String(lastErr) });
    return;
  }

  // CDN-cache for 10 minutes; serve stale (up to a day) while revalidating in the background.
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=86400');
  res.status(200).json(data);
};
