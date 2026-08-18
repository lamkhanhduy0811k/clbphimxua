const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

// Chống cache triệt để từ phía App (Nuvio)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const DOMAIN = 'https://clbphimxua.info';
const DEFAULT_POSTER = 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?q=80&w=400';

const MANIFEST = {
  id: 'org.clbphimxua.addon.v5',
  version: '5.0.0',
  name: 'CLB Phim Xưa',
  description: 'Kho Phim Lẻ, Phim Bộ & Hoạt Hình Xưa',
  resources: ['catalog', 'meta', 'stream'],
  types: ['movie', 'series'],
  catalogs: [
    { 
      type: 'movie', 
      id: 'clb_phimle_v5', 
      name: 'CLB Phim Xưa - Phim Lẻ', 
      extra: [{ name: 'skip', isRequired: false }] 
    },
    { 
      type: 'series', 
      id: 'clb_phimbo_v5', 
      name: 'CLB Phim Xưa - Phim Bộ', 
      extra: [{ name: 'skip', isRequired: false }] 
    },
    { 
      type: 'series', 
      id: 'clb_anime_v5', 
      name: 'CLB Phim Xưa - Hoạt Hình / Anime', 
      extra: [{ name: 'skip', isRequired: false }] 
    }
  ],
  idPrefixes: ['clb:']
};

app.get('/', (req, res) => res.send('CLB Phim Xưa Addon Active v5'));
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

const memoryStore = {};

async function fetchCategoryPosts(catalogId) {
  const now = Date.now();
  if (memoryStore[catalogId] && (now - memoryStore[catalogId].time < 300000)) {
    return memoryStore[catalogId].data;
  }

  let targetPath = '/feed/';
  if (catalogId === 'clb_phimle_v5') targetPath = '/category/phim-le/feed/';
  if (catalogId === 'clb_phimbo_v5') targetPath = '/category/phim-bo/feed/';
  if (catalogId === 'clb_anime_v5') targetPath = '/category/hoat-hinh/feed/';

  const proxies = [
    `${DOMAIN}${targetPath}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(DOMAIN + targetPath)}`,
    `https://corsproxy.io/?${encodeURIComponent(DOMAIN + targetPath)}`,
    `${DOMAIN}/feed/`
  ];

  for (const url of proxies) {
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
          memoryStore[catalogId] = { data: items, time: now };
          return items;
        }
      }
    } catch (e) {}
  }

  return memoryStore[catalogId]?.data || [];
}

app.get(['/catalog/:type/:id.json', '/catalog/:type/:id/:extra.json'], async (req, res) => {
  const { type, id } = req.params;
  let posts = await fetchCategoryPosts(id);

  // Nếu không cào được chuyên mục riêng, tiến hành chia dữ liệu tĩnh từ feed chính
  if (posts.length === 0) {
    const mainFeed = await fetchCategoryPosts('main_feed');
    if (id === 'clb_anime_v5') {
      posts = mainFeed.slice(0, 3);
    } else if (id === 'clb_phimle_v5') {
      posts = mainFeed.slice(3, 7);
    } else {
      posts = mainFeed.slice(7);
    }
  }

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

  let post = null;
  for (const catKey of ['clb_phimle_v5', 'clb_phimbo_v5', 'clb_anime_v5', 'main_feed']) {
    const posts = await fetchCategoryPosts(catKey);
    post = posts.find(p => p.id === slug);
    if (post) break;
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

  let post = null;
  for (const catKey of ['clb_phimle_v5', 'clb_phimbo_v5', 'clb_anime_v5', 'main_feed']) {
    const posts = await fetchCategoryPosts(catKey);
    post = posts.find(p => p.id === slug);
    if (post) break;
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
                       
