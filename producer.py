"""News in, validated and voiced segments out, into web/public/queue."""
import hashlib, json, os, re, struct, sys, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import feedparser, requests, fal_client
from dotenv import load_dotenv

load_dotenv()
import devin_orchestrator as d

FEEDS = [
    "https://techcrunch.com/category/artificial-intelligence/feed/",
    "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
    "https://www.technologyreview.com/topic/artificial-intelligence/feed",
]
QUEUE = Path("web/public/queue")
STATE = Path("produced.json")
PARALLEL = 3     # Devin sessions at once
PER_ROUND = 3    # news items per round
INTERVAL = 600   # seconds between rounds
VOICE = "aura-2-helena-en"


def fetch_news(seen):
    items = []
    for url in FEEDS:
        for e in feedparser.parse(url).entries[:8]:
            key = hashlib.sha1(e.link.encode()).hexdigest()
            if key in seen:
                continue
            summary = re.sub(r"<[^>]+>", "", e.get("summary", ""))[:600]
            items.append({"key": key, "title": e.title, "url": e.link, "summary": summary})
    return items


def tts(script):
    t0 = time.time()
    r = requests.post("https://api.slng.ai/v1/bridges/unmute/tts/deepgram/aura:2",
        headers={"Authorization": f"Bearer {os.environ['SLNG_API_KEY']}"},
        json={"text": script, "model": VOICE}, timeout=120)
    r.raise_for_status()
    latency = time.time() - t0
    data = r.content
    ch, rate = struct.unpack("<HI", data[22:28])
    bits = struct.unpack("<H", data[34:36])[0]
    secs = (len(data) - 44) / (rate * ch * bits / 8)
    path = f"/tmp/nina_{int(time.time()*1000)}.wav"
    open(path, "wb").write(data)
    return fal_client.upload_file(path), secs, latency


def produce(item):
    spec = d.run({"title": item["title"], "url": item["url"], "summary": item["summary"]})
    if not spec:
        return None
    url, secs, lat = tts(spec["script"])
    spec.update(audio_url=url, audio_seconds=round(secs, 1), tts_latency=round(lat, 2), news=item)
    return spec


def enqueue(spec):
    QUEUE.mkdir(parents=True, exist_ok=True)
    idx = QUEUE / "index.json"
    names = json.loads(idx.read_text()) if idx.exists() else []
    name = f"{len(names) + 1:03d}.json"
    (QUEUE / name).write_text(json.dumps(spec, indent=2))
    names.append(name)
    idx.write_text(json.dumps(names))
    print(f"QUEUED {name}: {spec['title']} ({spec['audio_seconds']}s, TTS {spec['tts_latency']}s)")


def main():
    seen = set(json.loads(STATE.read_text())) if STATE.exists() else set()
    while True:
        items = fetch_news(seen)[:PER_ROUND]
        print(f"round: {len(items)} new items")
        with ThreadPoolExecutor(PARALLEL) as ex:
            futs = {ex.submit(produce, it): it for it in items}
            for f in as_completed(futs):
                seen.add(futs[f]["key"])
                STATE.write_text(json.dumps(sorted(seen)))
                try:
                    spec = f.result()
                except Exception as e:
                    print("error:", e)
                    continue
                if spec:
                    enqueue(spec)
                else:
                    print("refused:", futs[f]["title"])
        if "--once" in sys.argv:
            break
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
