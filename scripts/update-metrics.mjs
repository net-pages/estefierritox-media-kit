import { readFileSync, writeFileSync } from 'fs';
import { load } from 'cheerio';

const INDEX_PATH = new URL('../index.html', import.meta.url).pathname;
const USERNAME = 'estefierritox';

// ── Number formatting ──

function formatMetric(raw) {
  if (raw >= 1_000_000) {
    const val = raw / 1_000_000;
    const decimals = val < 10 ? 2 : 1;
    return { target: parseFloat(val.toFixed(decimals)), suffix: 'M', decimals };
  } else if (raw >= 1_000) {
    const val = raw / 1_000;
    const decimals = val < 10 ? 1 : 0;
    return { target: parseFloat(val.toFixed(decimals)), suffix: 'K', decimals };
  }
  return { target: raw, suffix: '', decimals: 0 };
}

function formatFollowerText(platform, raw) {
  const f = formatMetric(raw);
  return `${platform} \u2014 ${f.target}${f.suffix} seguidores`;
}

// ── Sanity check ──

function isSane(current, newVal) {
  if (current <= 0 || newVal <= 0) return newVal > 0;
  return newVal >= current * 0.5;
}

// ── Read current value from HTML using regex ──

function getCurrentRaw(html, metricId) {
  const regex = new RegExp(`data-metric-id="${metricId}"[^>]*data-target="([^"]*)"[^>]*data-suffix="([^"]*)"`);
  const match = html.match(regex);
  if (!match) return 0;
  const target = parseFloat(match[1]) || 0;
  const suffix = match[2];
  const multiplier = suffix === 'M' ? 1_000_000 : suffix === 'K' ? 1_000 : 1;
  return target * multiplier;
}

// ── Instagram scraping ──
// Instagram Graph API (requires INSTAGRAM_TOKEN env var)
// Set up via: repo Settings → Secrets → INSTAGRAM_TOKEN

async function scrapeInstagram() {
  const token = process.env.INSTAGRAM_TOKEN;
  if (!token) {
    console.log('[IG] No INSTAGRAM_TOKEN set — skipping (set up Graph API to enable)');
    return null;
  }

  try {
    console.log('[IG] Trying Graph API...');
    // First get the IG Business Account ID
    const pagesRes = await fetch(
      `https://graph.facebook.com/v21.0/me/accounts?fields=instagram_business_account&access_token=${token}`
    );
    const pagesData = await pagesRes.json();
    const igAccountId = pagesData.data?.[0]?.instagram_business_account?.id;
    if (!igAccountId) {
      console.warn('[IG] Could not find Instagram Business Account. Check token permissions.');
      return null;
    }

    // Fetch profile metrics
    const profileRes = await fetch(
      `https://graph.facebook.com/v21.0/${igAccountId}?fields=followers_count,media_count&access_token=${token}`
    );
    const profile = await profileRes.json();
    if (profile.error) {
      console.warn('[IG] Graph API error:', profile.error.message);
      return null;
    }

    const result = {
      followers: profile.followers_count,
      posts: profile.media_count,
    };
    console.log(`[IG] Graph API success: ${result.followers} followers, ${result.posts} posts`);
    return result;
  } catch (e) {
    console.warn('[IG] Graph API failed:', e.message);
  }

  return null;
}

// ── TikTok scraping ──

async function scrapeTikTok() {
  // Attempt 1: HTML fetch + JSON extraction
  try {
    console.log('[TT] Trying HTML fetch...');
    const res = await fetch(`https://www.tiktok.com/@${USERNAME}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const html = await res.text();
    const $tt = load(html);
    const scriptContent = $tt('script#__UNIVERSAL_DATA_FOR_REHYDRATION__').text();

    if (scriptContent) {
      const data = JSON.parse(scriptContent);
      const userDetail = data['__DEFAULT_SCOPE__']?.['webapp.user-detail'];
      const stats = userDetail?.userInfo?.stats;
      if (stats) {
        const result = {
          followers: stats.followerCount,
          likes: stats.heartCount,
        };
        console.log(`[TT] HTML success: ${result.followers} followers, ${result.likes} likes`);
        return result;
      }
    }
    console.warn('[TT] HTML fetch: no stats found in page data');
  } catch (e) {
    console.warn('[TT] HTML fetch failed:', e.message);
  }

  console.error('[TT] All methods failed');
  return null;
}

// ── Update HTML using regex (preserves original formatting) ──

function updateMetricInHtml(html, metricId, rawValue) {
  const currentRaw = getCurrentRaw(html, metricId);
  if (!isSane(currentRaw, rawValue)) {
    console.warn(`[SKIP] ${metricId}: new value ${rawValue} is suspicious vs current ${currentRaw}`);
    return { html, changed: false };
  }

  const formatted = formatMetric(rawValue);

  // Match the full tag with this data-metric-id and replace its data-target, data-suffix, data-decimals
  const regex = new RegExp(
    `(data-metric-id="${metricId}"\\s+)data-target="[^"]*"\\s+data-suffix="[^"]*"\\s+data-decimals="[^"]*"`
  );
  const replacement = `$1data-target="${formatted.target}" data-suffix="${formatted.suffix}" data-decimals="${formatted.decimals}"`;

  const newHtml = html.replace(regex, replacement);
  const changed = newHtml !== html;
  if (changed) console.log(`[UPDATE] ${metricId}: → ${formatted.target}${formatted.suffix}`);
  return { html: newHtml, changed };
}

function updateSocialTextInHtml(html, metricId, platform, rawFollowers) {
  const newText = formatFollowerText(platform, rawFollowers);

  // Match: data-metric-id="...">old text</div>
  const regex = new RegExp(`(data-metric-id="${metricId}">)[^<]*(</div>)`);
  const newHtml = html.replace(regex, `$1${newText}$2`);
  const changed = newHtml !== html;
  if (changed) console.log(`[UPDATE] ${metricId}: → "${newText}"`);
  return { html: newHtml, changed };
}

// ── Main ──

async function main() {
  console.log('=== Metrics Update Script ===\n');

  let html = readFileSync(INDEX_PATH, 'utf-8');

  const [ig, tt] = await Promise.all([scrapeInstagram(), scrapeTikTok()]);

  let changed = false;
  let result;

  // Instagram metrics
  if (ig) {
    if (ig.followers != null) {
      result = updateMetricInHtml(html, 'ig-followers', ig.followers);
      html = result.html; changed = result.changed || changed;
      result = updateSocialTextInHtml(html, 'ig-social-text', 'Instagram', ig.followers);
      html = result.html; changed = result.changed || changed;
    }
    if (ig.posts != null) {
      result = updateMetricInHtml(html, 'ig-posts', ig.posts);
      html = result.html; changed = result.changed || changed;
    }
  }

  // TikTok metrics
  if (tt) {
    if (tt.followers != null) {
      result = updateMetricInHtml(html, 'tt-followers', tt.followers);
      html = result.html; changed = result.changed || changed;
      result = updateSocialTextInHtml(html, 'tt-social-text', 'TikTok', tt.followers);
      html = result.html; changed = result.changed || changed;
    }
    if (tt.likes != null) {
      result = updateMetricInHtml(html, 'tt-likes', tt.likes);
      html = result.html; changed = result.changed || changed;
      result = updateMetricInHtml(html, 'tt-total-likes', tt.likes);
      html = result.html; changed = result.changed || changed;
    }
  }

  // Combined followers
  const igFollowers = ig?.followers ?? getCurrentRaw(html, 'ig-followers');
  const ttFollowers = tt?.followers ?? getCurrentRaw(html, 'tt-followers');
  if (igFollowers > 0 && ttFollowers > 0 && (ig?.followers != null || tt?.followers != null)) {
    result = updateMetricInHtml(html, 'combined-followers', igFollowers + ttFollowers);
    html = result.html; changed = result.changed || changed;
  }

  if (changed) {
    writeFileSync(INDEX_PATH, html);
    console.log('\n✓ index.html updated (formatting preserved)');
  } else {
    console.log('\n— No changes needed');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
