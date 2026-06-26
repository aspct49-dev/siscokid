// Vercel serverless function: caching proxy for the LuxDrop affiliates API.
// Mirrors /api/leaderboard (Shuffle): retries on the server, CDN-caches the result,
// and most importantly hides the LUXDROP_API_KEY from the browser.
//
// Env var required (set in Vercel Project Settings → Environment Variables):
//   LUXDROP_API_KEY = <key from LuxDrop>

const AFFILIATE_CODE = 'sisco';

module.exports = async (req, res) => {
  const apiKey = process.env.LUXDROP_API_KEY;
  if (!apiKey) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(500).json({
      error: 'missing_api_key',
      detail: 'Set LUXDROP_API_KEY in Vercel project env vars and redeploy.',
    });
    return;
  }

  // Current calendar month, UTC. LuxDrop wants YYYY-MM-DD.
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const startDate = `${yyyy}-${mm}-01`;
  const endDate = now.toISOString().slice(0, 10);

  const url = `https://api.luxdrop.com/external/affiliates?codes=${AFFILIATE_CODE}&startDate=${startDate}&endDate=${endDate}`;

  // Fingerprint of the key so we can verify Vercel is sending the value we expect
  // without leaking it. Logs the first 4 / last 4 chars + length.
  const keyFp = `${apiKey.slice(0, 4)}…${apiKey.slice(-4)} (len=${apiKey.length})`;

  let data;
  let lastErr;
  let lastStatus;
  let lastBody;
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(url, {
        headers: {
          'x-api-key': apiKey,
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      lastStatus = r.status;
      if (!r.ok) {
        // Capture the upstream response body so we can see WHY it rejected us.
        lastBody = await r.text().catch(() => '');
        throw new Error('HTTP ' + r.status);
      }
      data = await r.json();
      break;
    } catch (err) {
      lastErr = err;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  if (data === undefined) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({
      error: 'upstream_unavailable',
      detail: String(lastErr),
      upstreamStatus: lastStatus,
      upstreamBody: (lastBody || '').slice(0, 500),
      sentTo: url,
      keyFingerprint: keyFp,
    });
    return;
  }

  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=86400');
  res.status(200).json(data);
};
