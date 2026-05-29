const express = require('express');

const app = express();
const PORT = 32145;

function decodeHtml(str) {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&#44;/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTags(str) {
  return decodeHtml(str.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function findReviewLine(html, labelRegex) {
  const patterns = [
    new RegExp(`(${labelRegex.source}:[\\s\\S]{0,400})`, 'i'),
    new RegExp(`(${labelRegex.source}[\\s\\S]{0,400})`, 'i')
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      const cleaned = stripTags(match[1]);
      if (cleaned) return cleaned;
    }
  }

  return null;
}

function parseReviewLine(text, fallbackLabel) {
  if (!text) {
    return {
      label: fallbackLabel,
      review_score_desc: 'No rating',
      total_reviews: 0
    };
  }

  const labelMatch = text.match(/^(English Reviews|Overall Reviews|All Reviews|Recent Reviews)/i);
  const label = labelMatch ? labelMatch[1] : fallbackLabel;

  const countMatch =
    text.match(/\(([\d,]+)\s*reviews?\)/i) ||
    text.match(/\(([\d,]+)\)/i);

  const total_reviews = countMatch
    ? parseInt(countMatch[1].replace(/,/g, ''), 10)
    : 0;

  let review_score_desc = 'No rating';
  const knownScores = [
    'Overwhelmingly Positive',
    'Very Positive',
    'Mostly Positive',
    'Mixed',
    'Mostly Negative',
    'Very Negative',
    'Overwhelmingly Negative'
  ];

  for (const score of knownScores) {
    if (new RegExp(score, 'i').test(text)) {
      review_score_desc = score;
      break;
    }
  }

  return {
    label,
    review_score_desc,
    total_reviews
  };
}

async function getStoreReviewSummary(appid) {
  const url = `https://store.steampowered.com/app/${appid}/`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });

  if (!res.ok) {
    throw new Error(`Store page HTTP ${res.status}`);
  }

  const html = await res.text();

  const overallLine =
    findReviewLine(html, /(English Reviews|Overall Reviews|All Reviews)/) || '';
  const recentLine =
    findReviewLine(html, /Recent Reviews/) || '';

  return {
    overall: parseReviewLine(overallLine, 'Overall Reviews'),
    recent: parseReviewLine(recentLine, 'Recent Reviews'),
    debug: {
      overallLine,
      recentLine
    }
  };
}

app.get('/reviews', async (req, res) => {
  const appid = req.query.appid;

  if (!appid || !/^\d+$/.test(appid)) {
    return res.status(400).json({ error: 'Missing or invalid appid' });
  }

  try {
    const store = await getStoreReviewSummary(appid);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({
      appid,
      overall: store.overall,
      recent: store.recent,
      debug: store.debug
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Steam review proxy running at http://127.0.0.1:${PORT}`);
});