const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const DOMAIN = 'https://clbphimxua.info';
const FALLBACK_POSTER = 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?q=80&w=400';

const MANIFEST = {
  id: 'org.clbphimxua.addon',
  version: '1.9.0',
  name: 'CLB Phim Xưa',
  description: 'Kho Phim Lẻ, Phim Bộ & Hoạt Hình Xưa',
  resources: ['catalog', 'meta', 'stream'],
  types: ['movie', 'series', 'anime'],
  catalogs: [
    { type: 'movie', id: 'clb_phimle', name: 'CLB Phim Xưa - Phim Lẻ', extra: [{ name: 'skip', isRequired: false }] },
    { type: 'series', id: 'clb_phimbo', name: 'CLB Phim Xưa - Phim Bộ', extra: [{ name: 'skip', isRequired: false }] },
    { type: 'anime', id: 'clb_anime', name: 'CLB Phim Xưa - Hoạt Hình / Anime', extra: [{ name: 'skip', isRequired: false }] }
  ],
  idPrefixes: ['clb:']
};

app.get('/', (req, res) => res.send('CLB Phim Xưa Addon Active'));
app.get('/manifest.json', (req, res) => res.json(MANIFEST));

function cleanTitle(str) {
  if (!str) return '';
  return str
    .replace(/&#8211;/g, '-')
    .replace(/&#8217;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/<!\[CDATA\[/g, '')
    .replace(/\]\]>/g, '')
    .replace(/<[^>]*>/g, '')
    .trim();
}

// Bóc tách link ảnh triệt để từ mọi thẻ
function extractPoster($c, $itemEl) {
  let poster = '';

  const img = $c('img').first();
  if (img.length) {
    poster = img.attr('data-lazy-src') || 
             img.attr('data-src') || 
             img.attr('data-original') || 
             img.attr('src') || '';

    if (!poster && img.attr('srcset')) {
      const srcSet = img.attr('srcset').split(',')[0].trim().split(' ')[0];
      if (srcSet) poster = srcSet;
    }
  }

  if (!poster) {
    poster = $itemEl.find('media\\:content').attr('url') || 
             $itemEl.find('enclosure').attr('url') || '';
  }

  if (!poster) return FALLBACK_POSTER;

  if (poster.startsWith('//')) poster = 'https:' + poster;
  else if (poster.startsWith('/')) poster = DOMAIN + poster;

  return poster;
}

async function fetchCategoryRSS(catId) {
  let catPath = '';
  if (catId === 'clb_phimle') catPath = '/category/phim-le/feed/';
  else if (catId === 'clb_phimbo') catPath = '/category/phim-bo/feed/';
  else if (catId === 'clb_anime') catPath = '/category/hoat-hinh/feed/';
  else catPath = '/feed/';

  const targetUrls = [
    `${DOMAIN}${catPath}`,
    `${DOMAIN}/feed/`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(DOMAIN + catPath)}`,
    `https://corsproxy.io/?${encodeURIComponent(DOMAIN + catPath)}`
  ];

  for (const url of targetUrls) {
    try {
      const res = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        timeout: 6000
      });
      if (res.data && typeof res.data === 'string' && res.data.includes('<rss')) {
        return res.data;
      }
    } catch (e) {}
  }
  return null;
}

async function getPostsForCatalog(catId) {
  const xml = await fetchCategoryRSS(catId);
  if (!xml) return [];

  const $ = cheerio.load(xml, { xmlMode: true });
  const items = [];

  $('item').each((i, el) => {
    const title = cleanTitle($(el).find('title').text());
    const link = $(el).find('link').text().trim();
    const pubDate = $(el).find('pubDate').text().trim();
    
    let content = $(el).find('content\\:encoded').text();
    if (!content) content = $(el).find('description').text();

    const $c = cheerio.load(content);
    const poster = extractPoster($c, $(el));
    
    const iframes = [];
    $c('iframe').each((idx, iframeEl) => {
      let src = $c(iframeEl).attr('src') || $c(iframeEl).attr('data-src') || $c(iframeEl).attr('data-lazy-src');
      if (src) {
        if (src.startsWith('//')) src = 'https:' + src;
        iframes.push(src);
      }
    });

    const slugParts = link.split('/').filter(Boolean);
    const slug = slugParts[slugParts.length - 1] || `post_${i}`;

    items.push({
      id: slug,
      title,
      link,
      pubDate,
      poster,
      description: cleanTitle(content),
      iframes
    });
  });

  if (catId === 'clb_anime') {
    const animeOnly = items.filter(p => /hoạt hình|anime|doraemon|conan|manga|tây du|hoạt họa|mèo béo|tiên kiếm/i.test(p.title + ' ' + p.description));
    return animeOnly.length > 0 ? animeOnly : items.filter((_, idx) => idx % 3 === 0);
  } else if (catId === 'clb_phimbo') {
    return items.filter(p => p.iframes.length > 1 || /tập|bộ|lồng tiếng|thuyết minh|phần/i.test(p.title));
  } else {
    return items.filter(p => p.iframes.length <= 1 && !/tập \d+/i.test(p.title));
  }
}

app.get(['/catalog/:type/:id.json', '/catalog/:type/:id/:extra.json'], async (req, res) => {
  const { type, id } = req.params;
  const posts = await getPostsForCatalog(id);

  const metas = posts.map(post => ({
    id: `clb:${post.id}`,
    type: type || 'movie',
    name: post.title || 'Phim Xưa',
    poster: post.poster,
    background: post.poster,
    description: post.description || '',
    releaseInfo: post.pubDate ? new Date(post.pubDate).getFullYear().toString() : ''
  }));

  return res.json({ metas });
});

app.get(['/meta/:type/:id.json', '/meta/:type/:id/:extra.json'], async (req, res) => {
  const { id, type } = req.params;
  const slug = id.replace('clb:', '');

  let posts = await getPostsForCatalog('clb_phimbo');
  let post = posts.find(p => p.id === slug);

  if (!post) {
    posts = await getPostsForCatalog('clb_phimle');
    post = posts.find(p => p.id === slug);
  }

  if (!post) return res.json({ meta: null });

  const videos = post.iframes.map((iframeUrl, idx) => ({
    id: `clb:${slug}:${idx}`,
    title: post.iframes.length > 1 ? `Tập ${idx + 1}` : 'Xem Phim',
    season: 1,
    episode: idx + 1
  }));

  return res.json({
    meta: {
      id: `clb:${slug}`,
      type: type || 'movie',
      name: post.title,
      poster: post.poster,
      description: post.description || post.title,
      videos: videos.length > 0 ? videos : [{ id: `clb:${slug}:0`, title: 'Xem Phim', season: 1, episode: 1 }]
    }
  });
});

app.get(['/stream/:type/:id.json', '/stream/:type/:id/:extra.json'], async (req, res) => {
  const { id } = req.params;
  const parts = id.split(':');
  const slug = parts[1];
  const idx = parseInt(parts[2] || '0', 10);

  let posts = await getPostsForCatalog('clb_phimbo');
  let post = posts.find(p => p.id === slug);

  if (!post) {
    posts = await getPostsForCatalog('clb_phimle');
    post = posts.find(p => p.id === slug);
  }

  const targetUrl = post?.iframes[idx] || post?.iframes[0];

  if (!targetUrl) return res.json({ streams: [] });

  return res.json({
    streams: [
      {
        name: 'CLB Phim Xưa',
        title: 'Server VIP - Trình phát Embed',
        externalUrl: targetUrl
      }
    ]
  });
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => console.log(`CLB Phim Xua Addon running on port ${PORT}`));
          
