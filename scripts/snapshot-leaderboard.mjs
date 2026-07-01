// Saves the PREVIOUS Eastern-time (America/New_York) calendar month's final Shuffle
// weighted-wager standings to archive/YYYY-MM.json, and — if DISCORD_WEBHOOK_URL is
// set — posts the final standings to Discord. Designed to run just after midnight ET
// on the 1st of each month (via GitHub Actions).
//
// The Shuffle endpoint is flaky (intermittent HTTP 400), so requests are retried.
// It retains history for past date ranges, so a completed month can be queried after
// it ends.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AFFILIATE_ID = '9ab3853d-dc5a-40f6-bad6-d7594ac9cff7';
const PRIZES = [1000, 700, 500, 250, 175, 125, 100, 75, 50, 25];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const archiveDir = path.resolve(__dirname, '..', 'archive');

const pad = (n) => String(n).padStart(2, '0');
const fmtMoney = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

function etNow() {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric' })
    .formatToParts(new Date()).reduce((a, x) => ((a[x.type] = x.value), a), {});
  return { year: +p.year, month: +p.month }; // month 1-12
}

async function fetchWithRetry(url, attempts = 15) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (i < attempts) await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw lastErr;
}

async function postToDiscord(displayMonth, leaderboard) {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) {
    console.log('DISCORD_WEBHOOK_URL not set — skipping Discord post.');
    return;
  }
  if (!leaderboard.length) return;

  const medals = ['\u{1F947}', '\u{1F948}', '\u{1F949}']; // 🥇🥈🥉
  const lines = leaderboard.slice(0, 10).map((u, i) => {
    const rank = medals[i] || `**${i + 1}.**`;
    const prize = PRIZES[i] ? ` — \u{1F3C6} $${PRIZES[i]}` : '';
    return `${rank} **${u.username}** — $${fmtMoney(u.weightedWagerAmount)}${prize}`;
  });

  const payload = {
    username: 'Sisco Rewards',
    embeds: [{
      title: `\u{1F3C6} Shuffle Leaderboard — ${displayMonth} Final Standings`,
      description: lines.join('\n'),
      color: 0xa259ff,
      footer: { text: 'Sisco Rewards • ranked by weighted wager' },
      timestamp: new Date().toISOString(),
    }],
  };

  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Discord webhook failed: HTTP ' + res.status);
  console.log('Posted final standings to Discord.');
}

async function main() {
  const { year, month } = etNow(); // current ET month (1-12)
  let py = year;
  let pm = month - 1; // previous ET month (1-12)
  if (pm === 0) { pm = 12; py -= 1; }

  const startTime = Math.floor(etMonthStartUTC(py, pm - 1) / 1000);
  const endTime = Math.floor(etMonthStartUTC(year, month - 1) / 1000);
  const label = `${py}-${pad(pm)}`;
  const displayMonth = `${MONTH_NAMES[pm - 1]} ${py}`;

  const url = `https://affiliate.shuffle.com/wager/${AFFILIATE_ID}?startTime=${startTime}&endTime=${endTime}`;
  console.log(`Snapshotting ${label} (${displayMonth}, ET) -> ${url}`);

  const data = await fetchWithRetry(url);
  if (!Array.isArray(data)) throw new Error('Unexpected response (not an array)');

  const leaderboard = data
    .filter((u) => Number(u.weightedWagerAmount) > 0)
    .sort((a, b) => Number(b.weightedWagerAmount) - Number(a.weightedWagerAmount));

  const snapshot = {
    month: label,
    displayMonth,
    timezone: 'America/New_York',
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

  try {
    await postToDiscord(displayMonth, leaderboard);
  } catch (err) {
    // Don't fail the whole job just because Discord failed — the archive is saved.
    console.error('Discord post failed:', err.message);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
