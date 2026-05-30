const express = require('express');

const app = express();
const PORT = 32145;

const CACHE_MS = 60 * 1000;
const reviewCache = new Map();

const SCORE_LABELS = [
  { min: 95, label: 'Overwhelmingly Positive' },
  { min: 80, label: 'Very Positive' },
  { min: 70, label: 'Mostly Positive' },
  { min: 40, label: 'Mixed' },
  { min: 20, label: 'Mostly Negative' },
  { min: 0, label: 'Very Negative' }
];

function reviewLabelFromPercent(percent, totalReviews) {
  if (!Number.isFinite(totalReviews) || totalReviews <= 0) {
    return 'Unavailable';
  }

  if (totalReviews < 10) {
    return 'No rating';
  }

  for (const band of SCORE_LABELS) {
    if (percent >= band.min) {
      return band.label;
    }
  }

  return 'No rating';
}

async function fetchSteamReviews(appid, params = {}) {
  const url = new URL(`https://store.steampowered.com/appreviews/${appid}`);
  url.searchParams.set('json', '1');
  url.searchParams.set('language', 'all');
  url.searchParams.set('purchase_type', 'all');
  url.searchParams.set('filter', params.filter || 'all');
  url.searchParams.set('num_per_page', String(params.num_per_page || 100));
  url.searchParams.set('cursor', params.cursor || '*');

  if (params.day_range != null) {
    url.searchParams.set('day_range', String(params.day_range));
  }

  const res = await fetch(url.toString(), {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache'
    }
  });

  if (!res.ok) {
    throw new Error(`Steam reviews HTTP ${res.status}`);
  }

  const data = await res.json();

  if (data?.success !== 1) {
    throw new Error(`Steam reviews API error for appid ${appid}`);
  }

  return data;
}

async function getOverallReviews(appid) {
  const data = await fetchSteamReviews(appid, {
    filter: 'all',
    num_per_page: 20,
    cursor: '*'
  });

  const qs = data?.query_summary || {};

  return {
    label: 'Overall Reviews',
    review_score_desc: qs.review_score_desc || 'Unavailable',
    total_reviews: Number.isFinite(qs.total_reviews) ? qs.total_reviews : null
  };
}

async function getRecentReviews(appid) {
  const cutoff = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);

  let cursor = '*';
  let pages = 0;
  let positives = 0;
  let negatives = 0;
  let scanned = 0;
  let oldestTimestampSeen = null;

  while (pages < 5) {
    const data = await fetchSteamReviews(appid, {
      filter: 'recent',
      num_per_page: 100,
      cursor
    });

    const reviews = Array.isArray(data?.reviews) ? data.reviews : [];
    if (!reviews.length) {
      break;
    }

    for (const review of reviews) {
      const ts = Number(review?.timestamp_created || 0);
      if (!ts) continue;

      scanned += 1;
      oldestTimestampSeen = ts;

      if (ts < cutoff) {
        continue;
      }

      if (review?.voted_up === true) positives += 1;
      else if (review?.voted_up === false) negatives += 1;
    }

    const lastTs = Number(reviews[reviews.length - 1]?.timestamp_created || 0);
    if (lastTs && lastTs < cutoff) {
      break;
    }

    if (!data.cursor || data.cursor === cursor) {
      break;
    }

    cursor = data.cursor;
    pages += 1;
  }

  const total = positives + negatives;

  if (total === 0) {
    return {
      label: 'Recent Reviews',
      review_score_desc: 'No rating',
      total_reviews: 0,
      debug_recent: {
        positives,
        negatives,
        percentPositive: null,
        scanned,
        oldestTimestampSeen,
        pagesScanned: pages + 1
      }
    };
  }

  const percentPositive = Math.round((positives / total) * 100);

  return {
    label: 'Recent Reviews',
    review_score_desc: reviewLabelFromPercent(percentPositive, total),
    total_reviews: total,
    debug_recent: {
      positives,
      negatives,
      percentPositive,
      scanned,
      oldestTimestampSeen,
      pagesScanned: pages + 1
    }
  };
}

async function getStoreReviewSummary(appid) {
  const [overall, recent] = await Promise.all([
    getOverallReviews(appid),
    getRecentReviews(appid)
  ]);

  return {
    overall,
    recent: {
      label: recent.label,
      review_score_desc: recent.review_score_desc,
      total_reviews: recent.total_reviews
    },
    debug: {
      source: 'steam appreviews + computed recent 30d + cache',
      recentDebug: recent.debug_recent || null
    }
  };
}

app.get('/reviews', async (req, res) => {
  const appid = req.query.appid;

  res.setHeader('Access-Control-Allow-Origin', '*');

  if (!appid || !/^\d+$/.test(appid)) {
    return res.status(400).json({ error: 'Missing or invalid appid' });
  }

  const cached = reviewCache.get(appid);
  if (cached && (Date.now() - cached.time) < CACHE_MS) {
    return res.json(cached.data);
  }

  try {
    const store = await getStoreReviewSummary(appid);

    const payload = {
      appid,
      overall: store.overall,
      recent: store.recent,
      debug: store.debug
    };

    reviewCache.set(appid, {
      time: Date.now(),
      data: payload
    });

    return res.json(payload);
  } catch (err) {
    return res.status(500).json({
      error: String(err),
      appid
    });
  }
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Steam review proxy running at http://127.0.0.1:${PORT}`);
});