// Saves the PREVIOUS calendar month's final Shuffle weighted-wager standings
// to archive/YYYY-MM.json. Designed to run on the 1st of each month (GitHub Actions),
// but can be run any time to snapshot the most recently completed month.
//
// The Shuffle endpoint is occasionally flaky (intermittent HTTP 400), so requests
// are retried. The endpoint retains historical data for past date ranges, so the
// completed month can be queried reliably after it ends.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AFFILIATE_ID = '9ab3853d-dc5a-40f6-bad6-d7594ac9cff7';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const archiveDir = path.resolve(__dirname, '..', 'archive');

const pad = (n) => String(n).padStart(2, '0');

async function fetchWithRetry(url, attempts = 6) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (err) {
      lastErr = err;
      console.warn(`Attempt ${i}/${attempts} failed: ${err.message}`);
      if (i < attempts) await new Promise((r) => setTimeout(r, 3000 * i));
    }
  }
  throw lastErr;
}

async function main() {
  const now = new Date();
  // Boundaries (UTC). Date.UTC normalizes a -1 month index across year rollover.
  const currentMonthStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0);
  const prevMonthStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0);
  const prevDate = new Date(prevMonthStartMs);
  const label = `${prevDate.getUTCFullYear()}-${pad(prevDate.getUTCMonth() + 1)}`;

  const startTime = Math.floor(prevMonthStartMs / 1000);
  const endTime = Math.floor(currentMonthStartMs / 1000);

  const url = `https://affiliate.shuffle.com/wager/${AFFILIATE_ID}?startTime=${startTime}&endTime=${endTime}`;
  console.log(`Snapshotting ${label} -> ${url}`);

  const data = await fetchWithRetry(url);
  if (!Array.isArray(data)) throw new Error('Unexpected response (not an array)');

  const leaderboard = data
    .filter((u) => Number(u.weightedWagerAmount) > 0)
    .sort((a, b) => Number(b.weightedWagerAmount) - Number(a.weightedWagerAmount));

  const snapshot = {
    month: label,
    affiliateId: AFFILIATE_ID,
    startTime,
    endTime,
    fetchedAt: new Date().toISOString(),
    totalEntries: data.length,
    rankedCount: leaderboard.length,
    leaderboard, // filtered to weighted > 0, sorted by weightedWagerAmount desc
    raw: data,   // full untouched API response
  };

  await mkdir(archiveDir, { recursive: true });
  const file = path.join(archiveDir, `${label}.json`);
  await writeFile(file, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`Saved ${file} (${leaderboard.length} ranked of ${data.length} total)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
