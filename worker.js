/**
 * TierFlow importer for Cloudflare Workers.
 * Deploy this as a Worker, then put its URL in config.js as API_BASE.
 */

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function normalizeTierMakerUrl(value) {
  let raw = String(value || '').trim().replace(/^<|>$/g, '').trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;

  try {
    const url = new URL(raw);
    if (!/(^|\.)tiermaker\.com$/i.test(url.hostname)) return null;
    if (!/^\/create\//i.test(url.pathname)) return null;
    url.protocol = 'https:';
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

function decodeHtml(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripTags(text) {
  return decodeHtml(String(text || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function extractTitle(html) {
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return stripTags(h1 || title || 'Imported Tier List')
    .replace(/\s*[-|]\s*TierMaker.*$/i, '')
    .replace(/\s+Tier List Maker\s*$/i, '')
    .trim();
}

function extractLabels(html) {
  const defaults = ['S','A','B','C','D','F'];
  const found = [];

  const classPattern = /<(?:div|span|p|td)[^>]+class=["'][^"']*(?:tier[^"']*label|label[^"']*tier|tierLabel|tier-label|label-holder|labelHolder)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|span|p|td)>/gi;
  for (const match of html.matchAll(classPattern)) {
    const text = stripTags(match[1]);
    if (text && text.length <= 50 && !/choose a label|edit label|delete row|clear row/i.test(text)) found.push(text);
  }

  // Common tier labels as a conservative fallback.
  if (found.length < 3) {
    const shortTextPattern = />(S\+|A\+|SS|S|A|B|C|D|F|Trash|Peak|Great|Good|Mid|Bad|Dropped)</gi;
    for (const match of html.matchAll(shortTextPattern)) found.push(match[1]);
  }

  const cleaned = unique(found).slice(0, 12);
  return cleaned.length >= 3 ? cleaned : defaults;
}

function absolutize(src, baseUrl) {
  try { return new URL(src, baseUrl).href; } catch { return null; }
}

function extractImages(html, pageUrl) {
  const candidates = [];

  const imgPattern = /<img\b[^>]*>/gi;
  for (const tag of html.match(imgPattern) || []) {
    const attrs = {};
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gi)) attrs[match[1].toLowerCase()] = match[3];
    const src = attrs['data-src'] || attrs['data-original'] || attrs['data-lazy-src'] || attrs.src;
    if (!src || /^data:/i.test(src)) continue;

    const absolute = absolutize(decodeHtml(src).replaceAll('\\/', '/'), pageUrl);
    if (!absolute) continue;

    const haystack = [absolute, attrs.class, attrs.id, attrs.alt].filter(Boolean).join(' ');
    if (/logo|avatar|profile|icon|banner|advert|google|app-store|play-store|social/i.test(haystack)) continue;

    const width = Number(attrs.width || 0);
    const height = Number(attrs.height || 0);
    if (width && height && (width < 40 || height < 40)) continue;

    candidates.push(absolute);
  }

  // TierMaker may place image URLs in scripts rather than img tags.
  const scriptUrls = [];
  const imageUrlPattern = /https?:\\?\/\\?\/[^"'<>\s]+?\.(?:png|jpe?g|webp)(?:\?[^"'<>\s]*)?/gi;
  for (const match of html.match(imageUrlPattern) || []) scriptUrls.push(match.replaceAll('\\/', '/'));

  return unique([...candidates, ...scriptUrls])
    .filter(url => /tiermaker|tierlists|amazonaws|cloudfront|usercontent|imgur/i.test(url))
    .slice(0, 400);
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/api/import') {
      return json({ error: 'Not found.' }, 404);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Request body must be JSON.' }, 400);
    }

    const tierMakerUrl = normalizeTierMakerUrl(body?.url);
    if (!tierMakerUrl) return json({ error: 'Paste a public tiermaker.com/create/... template URL.' }, 400);

    try {
      const upstream = await fetch(tierMakerUrl, {
        headers: {
          'user-agent': 'Mozilla/5.0 TierFlow/1.0',
          'accept-language': 'en-US,en;q=0.9'
        },
        redirect: 'follow'
      });

      if (!upstream.ok) return json({ error: `TierMaker returned HTTP ${upstream.status}.` }, 502);

      const html = await upstream.text();
      const source = upstream.url || tierMakerUrl;
      const title = extractTitle(html);
      const labels = extractLabels(html);
      const images = extractImages(html, source);

      if (!images.length) {
        return json({
          error: 'The page loaded, but no ranking images were detected. TierMaker may have changed this template markup.'
        }, 422);
      }

      return json({ title, labels, images, source });
    } catch (error) {
      return json({ error: `Could not import this TierMaker template: ${error?.message || String(error)}` }, 502);
    }
  }
};
