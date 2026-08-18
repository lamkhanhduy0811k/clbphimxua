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
  version: '4.0.0',
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

// Bóc tách link ảnh chuyên sâu bằng cách giải mã HTML mã hóa
function findImageUrl(htmlContent) {
  if (!htmlContent) return DEFAULT_POSTER;
  
  const unescaped = htmlContent
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&');

  const $ = cheerio.load(unescaped);
  let img = $('img').first().attr('src') || $('img').first().attr('data-src') || $('img').first().attr('data-lazy-src');
  
  if (!img) {
    const imgRegex = /(https?:\/\/[^\s"'<>]+?\.(?:jpg|jpeg|png|webp))/gi;
    const matches = unescaped.match(imgRegex);
    if (matches && matches.length > 0) {
      const wpImg = matches.find(m => m.includes('wp-content') || m.includes('uploads'));
      img = wpImg || matches[0];
    }
  }

  if (img) {
    if (img.startsWith('//')) img = 'https:' + img;
    return img;
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

  const allItems = [];
  const seenSlugs = new Set();
  const pages = ['/feed/', '/feed/?paged=2', '/feed/?paged=3'];

  for (const pagePath of pages) {
    const feedUrls = [
      `${DOMAIN}${pagePath}`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(DOMAIN + pagePath)}`,
      `https://corsproxy.io/?${encodeURIComponent(DOMAIN + pagePath)}`
    ];

    for (const url of feedUrls) {
      try {
        const res = await axios.get(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
          timeout: 6000
        });

        if (res.data && typeof res.data === 'string' && res.data.includes('<rss')) {
          const $ = cheerio.load(res.data, { xmlMode: true });

          $('item').each((i, el) => {
            const title = cleanText($(el).find('title').text());
            const link = $(el).find('link').text().trim();
            const pubDate = $(el).find('pubDate').text().trim();
            
            let content = $(el).find('content\\:encoded').text();
            if (!content) content = $(el).find('description').text();

            const poster = findImageUrl(content);

            const slugParts = link.split('/').filter(Boolean);
            const slug = slugParts[slugParts.length - 1] || `post_${i}`;

            if (!seenSlugs.has(slug) && title) {
              seenSlugs.add(slug);

              const $c = cheerio.load(content);
              const iframes = [];
              $c('iframe').each((idx, iframeEl) => {
                let src = $c(iframeEl).attr('src') || $c(iframeEl).attr('data-src');
                if (src) {
                  if (src.startsWith('//')) src = 'https:' + src;
                  iframes.push(src);
                }
              });

              allItems.push({
                id: slug,
                title,
                link,
                pubDate,
                poster,
                description: cleanText(content),
                iframes
              });
            }
          });
          break;
        }
      } catch (e) {}
    }
  }

  if (allItems.length > 0) {
    cachedPosts = allItems;
    lastFetchTime = now;
  }

  return cachedPosts;
}

app.get(['/catalog/:type/:id.json', '/catalog/:type/:id/:extra.json'], async (req, res) => {
  const { type, id } = req.params;
  const allPosts = await fetchAllPosts();

  if (allPosts.length === 0) {
    return res.json({ metas: [] });
  }

  // 1. Phim Hoạt Hình / Anime
  const animePosts = allPosts.filter(p => 
    /hoạt hình|anime|doraemon|conan|manga|mèo béo|hoạt họa|tiên kiếm/i.test(p.title + ' ' + p.description)
  );

  // Tập hợp còn lại sau khi trừ Hoạt hình
  const nonAnimePosts = allPosts.filter(p => !animePosts.includes(p));

  // 2. Phim Bộ
  const phimBoPosts = nonAnimePosts.filter(p => 
    p.iframes.length > 1 || /tập|bộ|lồng tiếng|thuyết minh|phần|trọn bộ|tvb|atv/i.test(p.title)
  );

  // 3. Phim Lẻ (Tập hợp còn lại trừ Phim Bộ)
  const phimLePosts = nonAnimePosts.filter(p => !phimBoPosts.includes(p));

  let selected = [];
  const chunkSize = Math.max(1, Math.floor(allPosts.length / 3));

  if (id === 'clb_anime') {
    selected = animePosts.length > 0 ? animePosts : allPosts.slice(0, chunkSize);
  } else if (id === 'clb_phimbo') {
    selected = phimBoPosts.length > 0 ? phimBoPosts : allPosts.slice(chunkSize, chunkSize * 2);
  } else {
    selected = phimLePosts.length > 0 ? phimLePosts : allPosts.slice(chunkSize * 2);
  }

  const metas = selected.map(post => ({
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
        title: 'Server VIP - Trình phát Embed',
        externalUrl: targetUrl
      }
    ]
  });
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => console.log(`CLB Phim Xua Addon running on port ${PORT}`));
              
