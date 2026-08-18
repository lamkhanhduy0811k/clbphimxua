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

const MANIFEST = {
  id: 'org.clbphimxua.addon',
  version: '1.7.0',
  name: 'CLB Phim Xưa',
  description: 'Kho Phim Lẻ, Phim Bộ & Hoạt Hình Xưa từ CLBPhimXua.info',
  resources: ['catalog', 'meta', 'stream'],
  types: ['movie', 'series', 'anime'],
  catalogs: [
    { type: 'movie', id: 'clb_phimle', name: 'CLB Phim Xưa - Phim Lẻ', extra: [{ name: 'skip', isRequired: false }] },
    { type: 'series', id: 'clb_phimbo', name: 'CLB Phim Xưa - Phim Bộ', extra: [{ name: 'skip', isRequired: false }] },
    { type: 'anime', id: 'clb_anime', name: 'CLB Phim Xưa - Hoạt Hình', extra: [{ name: 'skip', isRequired: false }] }
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

// Tự động tải RSS XML nguyên bản từ nguồn clbphimxua.info
async function fetchRSS() {
  const urls = [
    `${DOMAIN}/feed/`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(DOMAIN + '/feed/')}`,
    `https://corsproxy.io/?${encodeURIComponent(DOMAIN + '/feed/')}`
  ];

  for (const url of urls) {
    try {
      const res = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/xml, text/xml, */*'
        },
        timeout: 7000
      });
      if (res.data && (typeof res.data === 'string') && res.data.includes('<rss')) {
        return res.data;
      }
    } catch (e) {
      // Tự chuyển sang link/proxy dự phòng nếu thất bại
    }
  }
  return null;
}

async function parsePosts() {
  const xml = await fetchRSS();
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
    const poster = $c('img').first().attr('src') || '';
    
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
      iframes,
      contentHtml: content
    });
  });

  return items;
}

app.get(['/catalog/:type/:id.json', '/catalog/:type/:id/:extra.json'], async (req, res) => {
  const { type, id } = req.params;
  const allPosts = await parsePosts();

  if (allPosts.length === 0) {
    return res.json({ metas: [] });
  }

  let filtered = allPosts;

  // Lọc thông minh theo từng danh mục
  if (id === 'clb_anime' || type === 'anime') {
    filtered = allPosts.filter(p => /hoạt hình|anime|doraemon|conan|manga|tây du|hoạt họa/i.test(p.title + ' ' + p.description));
    if (filtered.length === 0) filtered = allPosts.slice(0, 10);
  } else if (id === 'clb_phimbo' || type === 'series') {
    filtered = allPosts.filter(p => p.iframes.length > 1 || /tập|bộ|lồng tiếng|thuyết minh|phần/i.test(p.title));
    if (filtered.length === 0) filtered = allPosts.slice(0, 15);
  } else {
    filtered = allPosts.filter(p => p.iframes.length <= 1 && !/tập \d+/i.test(p.title));
    if (filtered.length === 0) filtered = allPosts;
  }

  const metas = filtered.map(post => ({
    id: `clb:${post.id}`,
    type: type || 'movie',
    name: post.title || 'Phim Xưa',
    poster: post.poster || 'https://via.placeholder.com/300x450?text=CLB+Phim+Xua',
    background: post.poster,
    description: post.description || '',
    releaseInfo: post.pubDate ? new Date(post.pubDate).getFullYear().toString() : ''
  }));

  return res.json({ metas });
});

app.get(['/meta/:type/:id.json', '/meta/:type/:id/:extra.json'], async (req, res) => {
  const { id, type } = req.params;
  const slug = id.replace('clb:', '');

  const allPosts = await parsePosts();
  const post = allPosts.find(p => p.id === slug) || allPosts[0];

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

  const allPosts = await parsePosts();
  const post = allPosts.find(p => p.id === slug);

  const targetUrl = post?.iframes[idx] || post?.iframes[0];

  if (!targetUrl) return res.json({ streams: [] });

  return res.json({
    streams: [
      {
        name: '[CLB Phim Xưa]',
        title: 'Trình phát VIP (Ok.ru / Embed)',
        externalUrl: targetUrl
      }
    ]
  });
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => console.log(`CLB Phim Xua Addon running on port ${PORT}`));
    
