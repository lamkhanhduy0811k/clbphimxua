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
  version: '1.0.0',
  name: 'CLB Phim Xưa',
  description: 'Addon tổng hợp phim xưa, phim lồng tiếng kinh điển từ CLBPhimXua.info',
  resources: ['catalog', 'meta', 'stream'],
  types: ['movie', 'series'],
  catalogs: [
    { type: 'movie', id: 'clb_phimle', name: 'CLB Phim Xưa - Phim Lẻ', extra: [{ name: 'skip', isRequired: false }] },
    { type: 'series', id: 'clb_phimbo', name: 'CLB Phim Xưa - Phim Bộ', extra: [{ name: 'skip', isRequired: false }] }
  ],
  idPrefixes: ['clb:']
};

app.get('/', (req, res) => res.send('CLB Phim Xưa Addon Active'));
app.get('/manifest.json', (req, res) => res.json(MANIFEST));

const AXIOS_OPT = {
  timeout: 10000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Referer': `${DOMAIN}/`
  }
};

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

app.get(['/catalog/:type/:id.json', '/catalog/:type/:id/:extra.json'], async (req, res) => {
  const { type } = req.params;

  try {
    const url = `${DOMAIN}/wp-json/wp/v2/posts?per_page=20&page=1&_embed=1`;
    const { data } = await axios.get(url, AXIOS_OPT);

    const metas = (data || []).map(post => {
      let poster = '';
      if (post._embedded && post._embedded['wp:featuredmedia'] && post._embedded['wp:featuredmedia'][0]) {
        poster = post._embedded['wp:featuredmedia'][0].source_url || '';
      }
      if (!poster && post.content && post.content.rendered) {
        const $ = cheerio.load(post.content.rendered);
        poster = $('img').first().attr('src') || '';
      }

      return {
        id: `clb:${post.id}`,
        type: type || 'movie',
        name: cleanTitle(post.title?.rendered) || 'Phim Xưa',
        poster: poster,
        background: poster,
        description: cleanTitle(post.excerpt?.rendered) || '',
        releaseInfo: new Date(post.date).getFullYear().toString()
      };
    });

    return res.json({ metas });
  } catch (e) {
    return res.json({ metas: [] });
  }
});

app.get(['/meta/:type/:id.json', '/meta/:type/:id/:extra.json'], async (req, res) => {
  const { id, type } = req.params;
  const postId = id.replace('clb:', '');

  try {
    const url = `${DOMAIN}/wp-json/wp/v2/posts/${postId}?_embed=1`;
    const { data } = await axios.get(url, AXIOS_OPT);

    if (!data) return res.json({ meta: null });

    const contentHtml = data.content?.rendered || '';
    const $ = cheerio.load(contentHtml);

    const iframes = [];
    $('iframe').each((i, el) => {
      let src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src');
      if (src) {
        if (src.startswith && src.startsWith('//')) src = 'https:' + src;
        iframes.push(src);
      }
    });

    const videos = iframes.map((iframeUrl, idx) => ({
      id: `clb:${postId}:${idx}`,
      title: iframes.length > 1 ? `Tập ${idx + 1}` : 'Xem Phim',
      season: 1,
      episode: idx + 1
    }));

    let poster = '';
    if (data._embedded && data._embedded['wp:featuredmedia'] && data._embedded['wp:featuredmedia'][0]) {
      poster = data._embedded['wp:featuredmedia'][0].source_url || '';
    }

    return res.json({
      meta: {
        id: `clb:${postId}`,
        type: type || 'movie',
        name: cleanTitle(data.title?.rendered) || 'Phim Xưa',
        poster: poster,
        description: cleanTitle(data.excerpt?.rendered || contentHtml),
        videos: videos.length > 0 ? videos : [{ id: `clb:${postId}:0`, title: 'Xem Phim', season: 1, episode: 1 }]
      }
    });
  } catch (e) {
    return res.json({ meta: null });
  }
});

app.get(['/stream/:type/:id.json', '/stream/:type/:id/:extra.json'], async (req, res) => {
  const { id } = req.params;
  const parts = id.split(':');
  const postId = parts[1];
  const idx = parseInt(parts[2] || '0', 10);

  try {
    const url = `${DOMAIN}/wp-json/wp/v2/posts/${postId}`;
    const { data } = await axios.get(url, AXIOS_OPT);

    const contentHtml = data.content?.rendered || '';
    const $ = cheerio.load(contentHtml);

    const iframes = [];
    $('iframe').each((i, el) => {
      let src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src');
      if (src) {
        if (src.startsWith('//')) src = 'https:' + src;
        iframes.push(src);
      }
    });

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
  } catch (e) {
    return res.json({ streams: [] });
  }
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => console.log(`CLB Phim Xua Addon running on port ${PORT}`));
      
