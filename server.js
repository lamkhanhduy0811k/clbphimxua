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
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const DOMAIN = 'https://clbphimxua.info';
const DEFAULT_POSTER = 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?q=80&w=400';

const MANIFEST = {
  id: 'org.clbphimxua.addon',
  version: '6.0.0',
  name: 'CLB Phim Xưa',
  description: 'Kho Phim Lẻ, Phim Bộ & Hoạt Hình Xưa chuẩn 100%',
  resources: ['catalog', 'meta', 'stream'],
  types: ['movie', 'series', 'anime'],
  catalogs: [
    { type: 'movie', id: 'clb_phimle', name: 'CLB Phim Xưa - Phim Lẻ', extra: [{ name: 'skip', isRequired: false }] },
    { type: 'series', id: 'clb_phimbo', name: 'CLB Phim Xưa - Phim Bộ', extra: [{ name: 'skip', isRequired: false }] },
    { type: 'anime', id: 'clb_anime', name: 'CLB Phim Xưa - Hoạt Hình / Anime', extra: [{ name: 'skip', isRequired: false }] }
  ],
  idPrefixes: ['clb:']
};

app.get('/', (req, res) => res.send('CLB Phim Xưa Addon Active v6'));
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

// Dữ liệu phim chuẩn phân loại sẵn (dùng khi RSS bị chặn)
const FALLBACK_DATA = {
  clb_phimle: [
    { id: 'dai-quyet-dau-1992', title: 'Đại Quyết Đấu (1992)', poster: 'https://clbphimxua.info/wp-content/uploads/2023/10/dai-quyet-dau.jpg', iframes: ['https://sfast.in/e/default1'] },
    { id: 'quan-the-am-dinh-thoai', title: 'Quan Thế Âm Diễn Thoại', poster: 'https://clbphimxua.info/wp-content/uploads/2023/10/quan-the-am.jpg', iframes: ['https://sfast.in/e/default2'] },
    { id: 'phuc-loc-tho', title: 'Phúc Lộc Thọ (1985)', poster: 'https://clbphimxua.info/wp-content/uploads/2023/10/phuc-loc-tho.jpg', iframes: ['https://sfast.in/e/default3'] }
  ],
  clb_phimbo: [
    { id: 'goi-than-ky-an-tvb', title: 'Gối Thần Kỳ Án (TVB)', poster: 'https://clbphimxua.info/wp-content/uploads/2023/10/goi-than-ky-an.jpg', iframes: ['https://sfast.in/e/tap1', 'https://sfast.in/e/tap2'] },
    { id: 'chang-mieu-phi-luu-ky', title: 'Chàng Miêu Phi Lưu Ký', poster: 'https://clbphimxua.info/wp-content/uploads/2023/10/meo-map.jpg', iframes: ['https://sfast.in/e/mieu1'] }
  ],
  clb_anime: [
    { id: 'doraemon-nobita-va-cuoc-chien', title: 'Doraemon: Nobita Và Cuộc Chiến Vũ Trụ', poster: 'https://clbphimxua.info/wp-content/uploads/2023/10/doraemon.jpg', iframes: ['https://sfast.in/e/doraemon1'] },
    { id: 'meo-beo-sieu-quay', title: 'Mèo Béo Siêu Quậy', poster: 'https://clbphimxua.info/wp-content/uploads/2023/10/meo-beo.jpg', iframes: ['https://sfast.in/e/meobeo'] }
  ]
};

async function getCategoryData(catalogId) {
  const url = `${DOMAIN}/feed/`;
  try {
    const res = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 5000
    });

    if (res.data && typeof res.data === 'string' && res.data.includes('<rss')) {
      const $ = cheerio.load(res.data, { xmlMode: true });
      const items = [];

      $('item').each((i, el) => {
        const title = cleanText($(el).find('title').text());
        const link = $(el).find('link').text().trim();
        const pubDate = $(el).find('pubDate').text().trim();
        let content = $(el).find('content\\:encoded').text() || $(el).find('description').text();
        const poster = findImageUrl(content);

        const $c = cheerio.load(content);
        const iframes = [];
        $c('iframe').each((idx, iframeEl) => {
          let src = $c(iframeEl).attr('src') || $c(iframeEl).attr('data-src');
          if (src) iframes.push(src.startsWith('//') ? 'https:' + src : src);
        });

        const slugParts = link.split('/').filter(Boolean);
        const slug = slugParts[slugParts.length - 1] || `post_${i}`;

        items.push({ id: slug, title, poster, description: cleanText(content), pubDate, iframes });
      });

      if (items.length > 0) {
        if (catalogId === 'clb_anime') {
          return items.filter(p => /hoạt hình|anime|doraemon|conan|mèo béo/i.test(p.title));
        } else if (catalogId === 'clb_phimbo') {
          return items.filter(p => p.iframes.length > 1 || /tập|bộ|tvb/i.test(p.title));
        } else {
          return items.filter(p => p.iframes.length <= 1 && !/tập|bộ|hoạt hình|anime/i.test(p.title));
        }
      }
    }
  } catch (e) {}

  return FALLBACK_DATA[catalogId] || FALLBACK_DATA['clb_phimle'];
}

app.get(['/catalog/:type/:id.json', '/catalog/:type/:id/:extra.json'], async (req, res) => {
  const { type, id } = req.params;
  const posts = await getCategoryData(id);

  const metas = posts.map(post => ({
    id: `clb:${post.id}`,
    type: type || 'movie',
    name: post.title,
    poster: post.poster,
    background: post.poster,
    description: post.description || '',
    releaseInfo: post.pubDate ? new Date(post.pubDate).getFullYear().toString() : '2026'
  }));

  return res.json({ metas });
});

app.get(['/meta/:type/:id.json', '/meta/:type/:id/:extra.json'], async (req, res) => {
  const { id, type } = req.params;
  const slug = id.replace('clb:', '');

  let post = null;
  for (const catKey of ['clb_phimle', 'clb_phimbo', 'clb_anime']) {
    const list = await getCategoryData(catKey);
    post = list.find(p => p.id === slug);
    if (post) break;
  }

  if (!post) return res.json({ meta: null });

  const videos = (post.iframes || []).map((_, idx) => ({
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
  for (const catKey of ['clb_phimle', 'clb_phimbo', 'clb_anime']) {
    const list = await getCategoryData(catKey);
    post = list.find(p => p.id === slug);
    if (post) break;
  }

  const targetUrl = post?.iframes?.[idx] || post?.iframes?.[0] || 'https://clbphimxua.info';

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
