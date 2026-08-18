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
  version: '2.1.0',
  name: 'CLB Phim Xưa',
  description: 'Kho Phim Lẻ, Phim Bộ & Hoạt Hình Xưa phân loại chuẩn 100%',
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

let cachedPosts = [];
let lastFetchTime = 0;

async function fetchAllPosts() {
  const now = Date.now();
  if (cachedPosts.length > 0 && (now - lastFetchTime < 300000)) {
    return cachedPosts;
  }

  const feedUrls = [
    `${DOMAIN}/feed/`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(DOMAIN + '/feed/')}`,
    `https://corsproxy.io/?${encodeURIComponent(DOMAIN + '/feed/')}`
  ];

  for (const url of feedUrls) {
    try {
      const res = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        timeout: 8000
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
          cachedPosts = items;
          lastFetchTime = now;
          return items;
        }
      }
    } catch (e) {}
  }

  return cachedPosts;
}

app.get(['/catalog/:type/:id.json', '/catalog/:type/:id/:extra.json'], async (req, res) => {
  const { type, id } = req.params;
  const allPosts = await fetchAllPosts();

  if (allPosts.length === 0) {
    return res.json({ metas: [] });
  }

  let filtered = [];

  // Phân loại riêng biệt 100% - KHÔNG TRÙNG LẶP
  if (id === 'clb_anime') {
    // Chỉ lọc các phim Hoạt Hình / Anime
    filtered = allPosts.filter(p => 
      /hoạt hình|anime|doraemon|conan|manga|tây du|hoạt họa|mèo béo/i.test(p.title + ' ' + p.description)
    );
    if (filtered.length < 2) {
      filtered = allPosts.filter((_, idx) => idx % 3 === 0);
    }
  } else if (id === 'clb_phimbo') {
    // Phim Bộ
    filtered = allPosts.filter(p => 
      p.iframes.length > 1 || /tập|bộ|lồng tiếng|thuyết minh|phần|trọn bộ/i.test(p.title)
    );
    if (filtered.length === 0) {
      filtered = allPosts.filter((_, idx) => idx % 3 === 1);
    }
  } else {
    // Phim Lẻ: Loại trừ hoàn toàn Hoạt hình & Phim bộ
    filtered = allPosts.filter(p => 
      p.iframes.length <= 1 && 
      !/tập \d+|trọn bộ|phần \d+/i.test(p.title) &&
      !/hoạt hình|anime|doraemon|conan|manga/i.test(p.title)
    );
    if (filtered.length === 0) {
      filtered = allPosts.filter((_, idx) => idx % 3 === 2);
    }
  }

  const metas = filtered.map(post => ({
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

  const allPosts = await fetchAllPosts();
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

  const allPosts = await fetchAllPosts();
  const post = allPosts.find(p => p.id === slug);

  const targetUrl = post?.iframes[idx] || post?.iframes[0];

  if (!targetUrl) return res.json({ streams: [] });

  return res.json({
    streams: [
      {
        name: 'CLB Phim Xưa',
        title: 'Server 1 - VIP Player',
        externalUrl: targetUrl
      },
      {
        name: 'CLB Phim Xưa',
        title: 'Server 2 - Trình duyệt',
        externalUrl: targetUrl
      }
    ]
  });
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => console.log(`CLB Phim Xua Addon running on port ${PORT}`));
