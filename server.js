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
  version: '1.6.0',
  name: 'CLB Phim Xưa',
  description: 'Kho Phim Lẻ, Phim Bộ & Hoạt Hình Xưa chuẩn từ CLBPhimXua.info',
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
    .replace(/<[^>]*>/g, '')
    .trim();
}

// Lấy danh sách bài viết theo chuyên mục RSS riêng biệt
async function getClbPosts(catalogId) {
  let feedsToTry = [];

  if (catalogId === 'clb_phimle') {
    feedsToTry = [
      `${DOMAIN}/category/phim-le/feed/`,
      `${DOMAIN}/category/phim-dien-anh/feed/`,
      `${DOMAIN}/feed/`
    ];
  } else if (catalogId === 'clb_phimbo') {
    feedsToTry = [
      `${DOMAIN}/category/phim-bo/feed/`,
      `${DOMAIN}/category/phim-truyen-hinh/feed/`,
      `${DOMAIN}/feed/`
    ];
  } else if (catalogId === 'clb_anime') {
    feedsToTry = [
      `${DOMAIN}/category/hoat-hinh/feed/`,
      `${DOMAIN}/category/anime/feed/`,
      `${DOMAIN}/category/phim-hoat-hinh/feed/`,
      `${DOMAIN}/feed/`
    ];
  } else {
    feedsToTry = [`${DOMAIN}/feed/`];
  }

  let rawItems = [];

  for (const feedUrl of feedsToTry) {
    try {
      // Gọi qua rss2json nâng số lượng lấy tối đa lên 50 bài viết
      const rssApi = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feedUrl)}&count=50`;
      const res = await axios.get(rssApi, { timeout: 8000 });
      
      if (res.data && res.data.status === 'ok' && Array.isArray(res.data.items) && res.data.items.length > 0) {
        rawItems = res.data.items;
        // Nếu lấy đúng chuyên mục chuyên biệt thì ngưng, không cần fallback
        if (!feedUrl.endsWith('/feed/')) break;
      }
    } catch (e) {
      console.error(`Error fetching ${feedUrl}:`, e.message);
    }
  }

  const posts = rawItems.map(item => {
    const content = item.content || item.description || '';
    const $ = cheerio.load(content);
    const poster = $('img').first().attr('src') || item.thumbnail || '';
    
    const iframes = [];
    $('iframe').each((i, el) => {
      let src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src');
      if (src) {
        if (src.startsWith('//')) src = 'https:' + src;
        iframes.push(src);
      }
    });

    const slug = item.link.split('/').filter(Boolean).pop() || Math.random().toString(36).substring(7);

    return {
      id: slug,
      title: cleanTitle(item.title),
      poster: poster,
      description: cleanTitle(item.description),
      date: item.pubDate,
      contentHtml: content,
      iframes: iframes
    };
  });

  // Lọc thông minh để đảm bảo phim không bị trùng lặp giữa các mục
  if (catalogId === 'clb_phimbo') {
    return posts.filter(p => p.iframes.length > 1 || /tập|bộ|thuyết minh|lồng tiếng/i.test(p.title));
  } else if (catalogId === 'clb_phimle') {
    return posts.filter(p => p.iframes.length <= 1 && !/tập \d+/i.test(p.title));
  } else if (catalogId === 'clb_anime') {
    const animeFilter = posts.filter(p => /hoạt hình|anime|doraemon|conan|manga|tây du ký/i.test(p.title + ' ' + p.description));
    return animeFilter.length > 0 ? animeFilter : posts.slice(0, 15);
  }

  return posts;
}

app.get(['/catalog/:type/:id.json', '/catalog/:type/:id/:extra.json'], async (req, res) => {
  const { type, id } = req.params;
  const posts = await getClbPosts(id);

  if (posts.length === 0) {
    return res.json({ metas: [] });
  }

  const metas = posts.map(post => ({
    id: `clb:${post.id}`,
    type: type || 'movie',
    name: post.title || 'Phim Xưa',
    poster: post.poster || 'https://via.placeholder.com/300x450?text=CLB+Phim+Xua',
    background: post.poster,
    description: post.description || '',
    releaseInfo: post.date ? new Date(post.date).getFullYear().toString() : ''
  }));

  return res.json({ metas });
});

app.get(['/meta/:type/:id.json', '/meta/:type/:id/:extra.json'], async (req, res) => {
  const { id, type } = req.params;
  const slug = id.replace('clb:', '');
  
  // Tìm phim trong tất cả danh mục
  let posts = await getClbPosts('clb_phimle');
  let post = posts.find(p => p.id === slug);
  
  if (!post) {
    posts = await getClbPosts('clb_phimbo');
    post = posts.find(p => p.id === slug);
  }

  if (!post) return res.json({ meta: null });

  let iframes = post.iframes || [];
  if (iframes.length === 0 && post.contentHtml) {
    const $ = cheerio.load(post.contentHtml);
    $('iframe').each((i, el) => {
      let src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src');
      if (src) {
        if (src.startsWith('//')) src = 'https:' + src;
        iframes.push(src);
      }
    });
  }

  const videos = iframes.map((iframeUrl, idx) => ({
    id: `clb:${slug}:${idx}`,
    title: iframes.length > 1 ? `Tập ${idx + 1}` : 'Xem Phim',
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

  let posts = await getClbPosts('clb_phimle');
  let post = posts.find(p => p.id === slug);
  
  if (!post) {
    posts = await getClbPosts('clb_phimbo');
    post = posts.find(p => p.id === slug);
  }

  let iframes = post?.iframes || [];
  if (iframes.length === 0 && post?.contentHtml) {
    const $ = cheerio.load(post.contentHtml);
    $('iframe').each((i, el) => {
      let src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src');
      if (src) {
        if (src.startsWith('//')) src = 'https:' + src;
        iframes.push(src);
      }
    });
  }

  const targetUrl = iframes[idx] || iframes[0];

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
          
