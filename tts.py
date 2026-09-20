import json, os, struct, time
import requests, fal_client
from dotenv import load_dotenv

load_dotenv()
MODEL = "deepgram/aura:2"
VOICE = "aura-2-helena-en"
SEG = "web/public/segment.json"
OUT = "nina_segment.wav"

seg = json.load(open(SEG))
t0 = time.time()
r = requests.post(f"https://api.slng.ai/v1/bridges/unmute/tts/{MODEL}",
    headers={"Authorization": f"Bearer {os.environ['SLNG_API_KEY']}"},
    json={"text": seg["script"], "model": VOICE}, timeout=120)
r.raise_for_status()
latency = time.time() - t0
data = r.content
open(OUT, "wb").write(data)

channels, rate = struct.unpack("<HI", data[22:28])
bits = struct.unpack("<H", data[34:36])[0]
secs = (len(data) - 44) / (rate * channels * bits / 8)

seg["audio_url"] = fal_client.upload_file(OUT)
seg["audio_seconds"] = round(secs, 1)
json.dump(seg, open(SEG, "w"), indent=2)
print(f"{secs:.1f}s audio, TTS latency {latency:.2f}s")
print("uploaded:", seg["audio_url"])
