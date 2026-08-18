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
const DEFAULT_POSTER = 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?q=80&w=400';

const MANIFEST = {
  id: 'org.clbphimxua.addon',
  version: '3.0.0',
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

function cleanText(str) {
  if (!str) return '';
  return str
    .replace(/<!\[CDATA\[/g, '')
    .replace(/\]\]>/g, '')
    .replace(/&#8211;/g, '-')
    .replace(/&#8217;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/<[^>]*>/g, '')
    .trim();
}

function findImageUrl(htmlContent) {
  if (!htmlContent) return DEFAULT_POSTER;
  const imgRegex = /(https?:\/\/[^\s"'<>]+?\.(?:jpg|jpeg|png|webp))/gi;
  const matches = htmlContent.match(imgRegex);

  if (matches && matches.length > 0) {
    const wpImg = matches.find(m => m.includes('wp-content') || m.includes('uploads'));
    return wpImg || matches[0];
  }
  return DEFAULT_POSTER;
}

// Bộ nhớ đệm riêng cho từng danh mục
const categoryCache = {};

async function fetchFeedByCategory(catId) {
  const now = Date.now();
  if (categoryCache[catId] && (now - categoryCache[catId].time < 300000)) {
    return categoryCache[catId].data;
  }

  // Đường dẫn RSS chính xác cho từng mục trên web gốc
  let paths = [];
  if (catId === 'clb_phimle') {
    paths = ['/category/phim-le/feed/', '/category/phim-dien-anh/feed/'];
  } else if (catId === 'clb_phimbo') {
    paths = ['/category/phim-bo/feed/', '/category/phim-truyen-hinh/feed/'];
  } else if (catId === 'clb_anime') {
    paths = ['/category/hoat-hinh/feed/', '/category/anime/feed/'];
  }
  paths.push('/feed/'); // Mức dự phòng cuối cùng

  for (const path of paths) {
    const urls = [
      `${DOMAIN}${path}`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(DOMAIN + path)}`,
      `https://corsproxy.io/?${encodeURIComponent(DOMAIN + path)}`
    ];

    for (const url of urls) {
      try {
        const res = await axios.get(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
          timeout: 6000
        });

        if (res.data && typeof res.data === 'string' && res.data.includes('<rss')) {
          const $ = cheerio.load(res.data, { xmlMode: true });
          const items = [];

          $('item').each((i, el) => {
            const title = cleanText($(el).find('title').text());
            const link = $(el).find('link').text().trim();
            const pubDate = $(el).find('pubDate').text().trim();
            
            let content = $(el).find('content\\:encoded').text();
            if (!content) content = $(el).find('description').text();

            const poster = findImageUrl(content);
            
            const $c = cheerio.load(content);
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
              description: cleanText(content),
              iframes
            });
          });

          if (items.length > 0) {
            categoryCache[catId] = { data: items, time: now };
            return items;
          }
        }
      } catch (e) {}
    }
  }

  return categoryCache[catId]?.data || [];
}

app.get(['/catalog/:type/:id.json', '/catalog/:type/:id/:extra.json'], async (req, res) => {
  const { type, id } = req.params;
  const posts = await fetchFeedByCategory(id);

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

  let posts = await fetchFeedByCategory('clb_phimbo');
  let post = posts.find(p => p.id === slug);

  if (!post) {
    posts = await fetchFeedByCategory('clb_phimle');
    post = posts.find(p => p.id === slug);
  }

  if (!post) {
    posts = await fetchFeedByCategory('clb_anime');
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

  let posts = await fetchFeedByCategory('clb_phimbo');
  let post = posts.find(p => p.id === slug);

  if (!post) {
    posts = await fetchFeedByCategory('clb_phimle');
    post = posts.find(p => p.id === slug);
  }

  if (!post) {
    posts = await fetchFeedByCategory('clb_anime');
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
