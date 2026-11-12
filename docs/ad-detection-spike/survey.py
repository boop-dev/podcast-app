import urllib.request, re, json, sys
from xml.etree import ElementTree as ET
feeds = {
 "Conspiracy Theories, Cults & Crimes": "https://rss.amperwave.net/v2/feed/audacynetwork/conspiracy-theories-cults-crimes",
 "Rotten Mango": "https://feeds.simplecast.com/6Qp23t6h",
 "ShxtsNGigs": "https://feeds.acast.com/public/shows/6477204262b0900011c3fb37",
 "WHOT Podcast": "https://anchor.fm/s/fba4b39c/podcast/rss",
}
ns = {"podcast":"https://podcastindex.org/namespace/1.0","itunes":"http://www.itunes.com/dtds/podcast-1.0.dtd"}
def get(url, ua="PodcastApp/1.0 (Android)"):
    req = urllib.request.Request(url, headers={"User-Agent": ua})
    return urllib.request.urlopen(req, timeout=30)
for name, url in feeds.items():
    raw = get(url).read()
    root = ET.fromstring(raw)
    items = root.findall("./channel/item")
    ch = [i for i in items if i.find("podcast:chapters", ns) is not None]
    tr = [i for i in items if i.find("podcast:transcript", ns) is not None]
    enc = items[0].find("enclosure").get("url") if items else ""
    host = re.sub(r"^https?://([^/]+)/.*", r"\1", enc)
    print(f"== {name}: {len(items)} items, chapters tag on {len(ch)}, transcript tag on {len(tr)}")
    print("   newest enclosure host:", host)
    print("   enclosure:", enc[:140])
    print("   newest title:", items[0].findtext("title"))
    if ch:
        cu = ch[0].find("podcast:chapters", ns).get("url")
        print("   chapters url:", cu)
        try:
            data = json.load(get(cu))
            print("   chapter titles:", [c.get("title") for c in data.get("chapters", [])][:15])
        except Exception as e: print("   chapters fetch failed", e)
