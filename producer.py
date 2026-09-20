"""News in, validated and voiced segments out. Writes live status for the site."""
import datetime, hashlib, json, os, re, struct, sys, threading, time
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
STATUS = Path("web/public/status.json")
STATE = Path("produced.json")
PARALLEL, PER_ROUND, INTERVAL = 3, 3, 600
VOICE = "aura-2-helena-en"

_lock = threading.Lock()
_events, _active = [], {}


def emit(kind, title, text=""):
    with _lock:
        _events.insert(0, {"t": datetime.datetime.now().strftime("%H:%M"), "kind": kind,
                           "title": title[:90], "text": str(text)[:160]})
        del _events[40:]
        if kind in ("queued", "refused", "error"):
            _active.pop(title, None)
        else:
            _active[title] = kind
        STATUS.parent.mkdir(parents=True, exist_ok=True)
        tmp = STATUS.with_suffix(".tmp")
        tmp.write_text(json.dumps({"events": _events,
            "active": [{"title": k, "stage": v} for k, v in _active.items()]}))
        tmp.replace(STATUS)


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
    path = f"/tmp/nina_{int(time.time() * 1000)}.wav"
    open(path, "wb").write(data)
    return fal_client.upload_file(path), secs, latency


def produce(item):
    title = item["title"]
    spec = d.run({"title": title, "url": item["url"], "summary": item["summary"]},
                 on_event=lambda kind, text: emit(kind, title, text))
    if not spec:
        return None
    url, secs, lat = tts(spec["script"])
    emit("voice", title, f"{secs:.0f}s of audio, TTS in {lat:.1f}s")
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
    emit("queued", spec["news"]["title"], f"ready to air as {name}")
    print(f"QUEUED {name}: {spec['title']}")


def main():
    seen = set(json.loads(STATE.read_text())) if STATE.exists() else set()
    while True:
        items = fetch_news(seen)[:PER_ROUND]
        for it in items:
            emit("research", it["title"], "picked up from the feed")
        with ThreadPoolExecutor(PARALLEL) as ex:
            futs = {ex.submit(produce, it): it for it in items}
            for f in as_completed(futs):
                it = futs[f]
                seen.add(it["key"])
                STATE.write_text(json.dumps(sorted(seen)))
                try:
                    spec = f.result()
                except Exception as e:
                    emit("error", it["title"], e)
                    print("error:", e)
                    continue
                if spec:
                    enqueue(spec)
        if "--once" in sys.argv:
            break
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
