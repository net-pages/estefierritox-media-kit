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

async function scrapeInstagram() {
  // Attempt 1: REST API
  try {
    console.log('[IG] Trying REST API...');
    const res = await fetch(
      `https://i.instagram.com/api/v1/users/web_profile_info/?username=${USERNAME}`,
      {
        headers: {
          'x-ig-app-id': '936619743392459',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      }
    );
    if (res.ok) {
      const json = await res.json();
      const user = json.data.user;
      const result = {
        followers: user.edge_followed_by.count,
        posts: user.edge_owner_to_timeline_media.count,
      };
      console.log(`[IG] API success: ${result.followers} followers, ${result.posts} posts`);
      return result;
    }
    console.warn(`[IG] API returned ${res.status}`);
  } catch (e) {
    console.warn('[IG] API failed:', e.message);
  }

  // Attempt 2: Playwright fallback
  try {
    console.log('[IG] Trying Playwright fallback...');
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`https://www.instagram.com/${USERNAME}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    const metaContent = await page.$eval(
      'meta[property="og:description"]',
      (el) => el.content
    );
    const followersMatch = metaContent.match(/([\d,.]+[KMkm]?)\s*Followers/i);
    const postsMatch = metaContent.match(/([\d,.]+)\s*Posts/i);

    await browser.close();

    if (followersMatch) {
      const followers = parseMetaNumber(followersMatch[1]);
      const posts = postsMatch ? parseInt(postsMatch[1].replace(/,/g, '')) : null;
      console.log(`[IG] Playwright success: ${followers} followers, ${posts} posts`);
      return { followers, posts };
    }
  } catch (e) {
    console.warn('[IG] Playwright failed:', e.message);
  }

  console.error('[IG] All methods failed');
  return null;
}

function parseMetaNumber(str) {
  const clean = str.replace(/,/g, '').trim();
  const lower = clean.toLowerCase();
  if (lower.endsWith('k')) return parseFloat(lower) * 1000;
  if (lower.endsWith('m')) return parseFloat(lower) * 1000000;
  return parseInt(clean);
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

  // Attempt 2: Playwright fallback
  try {
    console.log('[TT] Trying Playwright fallback...');
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`https://www.tiktok.com/@${USERNAME}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    const scriptContent = await page.$eval(
      '#__UNIVERSAL_DATA_FOR_REHYDRATION__',
      (el) => el.textContent
    );
    await browser.close();

    if (scriptContent) {
      const data = JSON.parse(scriptContent);
      const userDetail = data['__DEFAULT_SCOPE__']?.['webapp.user-detail'];
      const stats = userDetail?.userInfo?.stats;
      if (stats) {
        const result = {
          followers: stats.followerCount,
          likes: stats.heartCount,
        };
        console.log(`[TT] Playwright success: ${result.followers} followers, ${result.likes} likes`);
        return result;
      }
    }
  } catch (e) {
    console.warn('[TT] Playwright failed:', e.message);
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
