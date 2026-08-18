import requests
from bs4 import BeautifulSoup
import json

DOMAIN = "https://clbphimxua.info"
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Referer': f"{DOMAIN}/"
}

def get_movies(page=1, per_page=10):
    url = f"{DOMAIN}/wp-json/wp/v2/posts?page={page}&per_page={per_page}&_embed=1"
    try:
        res = requests.get(url, headers=HEADERS, timeout=10)
        if res.status_code != 200:
            return []
        
        posts = res.json()
        results = []

        for post in posts:
            title = post.get('title', {}).get('rendered', '')
            link = post.get('link', '')
            content_html = post.get('content', {}).get('rendered', '')
            
            poster = ''
            if '_embedded' in post and 'wp:featuredmedia' in post['_embedded']:
                poster = post['_embedded']['wp:featuredmedia'][0].get('source_url', '')

            soup = BeautifulSoup(content_html, 'html.parser')
            iframes = []
            for iframe in soup.find_all('iframe'):
                src = iframe.get('src') or iframe.get('data-src') or iframe.get('data-lazy-src')
                if src:
                    if src.startswith('//'):
                        src = 'https:' + src
                    iframes.append(src)

            results.append({
                'id': post.get('id'),
                'title': title,
                'poster': poster,
                'url': link,
                'players': iframes
            })

        return results
    except Exception as e:
        print(f"Lỗi kết nối: {e}")
        return []

if __name__ == '__main__':
    movies = get_movies(page=1, per_page=5)
    print(json.dumps(movies, ensure_ascii=False, indent=2))
