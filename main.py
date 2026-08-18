import requests
from bs4 import BeautifulSoup
import json
import subprocess

DOMAIN = "https://clbphimxua.info"
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Referer': f"{DOMAIN}/"
}

def get_movies_via_api(page=1, per_page=10):
    """Cào tự động danh sách phim qua cổng API của WordPress"""
    api_url = f"{DOMAIN}/wp-json/wp/v2/posts?page={page}&per_page={per_page}"
    try:
        res = requests.get(api_url, headers=HEADERS, timeout=10)
        if res.status_code != 200:
            return None
        
        posts = res.json()
        results = []

        for post in posts:
            title = post.get('title', {}).get('rendered', '')
            link = post.get('link', '')
            content_html = post.get('content', {}).get('rendered', '')
            
            # Trích xuất tất cả iframe phát phim trong bài viết
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
                'web_url': link,
                'embed_players': iframes
            })

        return results
    except Exception as e:
        print(f"Lỗi kết nối API: {e}")
        return None

def extract_stream_link(embed_url):
    """Dùng yt-dlp chuyển iframe (Ok.ru/Youtube/Dailymotion) thành link m3u8/mp4"""
    try:
        cmd = ['yt-dlp', '-g', '--referer', DOMAIN, embed_url]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        if res.returncode == 0:
            return res.stdout.strip().split('\n')[0]
    except Exception:
        pass
    return None

if __name__ == '__main__':
    print(">>> Đang lấy 3 bài viết phim mới nhất từ clbphimxua.info...")
    movies = get_movies_via_api(page=1, per_page=3)

    if movies:
        for m in movies:
            print(f"\n🎬 Tên phim: {m['title']}")
            print(f"🔗 Link bài viết: {m['web_url']}")
            print(f"📺 Số lượng Player: {len(m['embed_players'])}")
            
            # Thử giải mã player đầu tiên thành stream
            if m['embed_players']:
                player = m['embed_players'][0]
                print(f"  └─ Iframe gốc: {player}")
                stream = extract_stream_link(player)
                print(f"  └─ Stream trực tiếp (.m3u8/.mp4): {stream or 'Cần proxy/cookie để giải mã'}")
    else:
        print("Không thể kết nối API hoặc trang web chặn Request.")
