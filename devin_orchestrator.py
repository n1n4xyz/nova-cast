"""
Devin orchestrator: news item in, validated segment spec out.
Devin writes the spec, this code decides if it passes, failures go back to Devin.

Setup:
  pip install requests
  export DEVIN_API_KEY=...
  python devin_orchestrator.py news.json
"""
import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv()

API = "https://api.devin.ai/v1"
HEADERS = {"Authorization": f"Bearer {os.environ['DEVIN_API_KEY']}"}
MAX_ATTEMPTS = 3
MAX_ACU = 5  # cost cap per session
TERMINAL = {"blocked", "finished", "expired", "suspended"}
RUN_DIR = Path("runs")

SPEC_SCHEMA = {
    "type": "object",
    "required": ["title", "script", "scenes", "references", "claims", "ai_label"],
    "properties": {
        "title": {"type": "string"},
        "script": {"type": "string"},
        "scenes": {"type": "array", "items": {"type": "string"}},
        "references": {"type": "array", "items": {"type": "string"}},
        "claims": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["text", "source_url", "evidence_terms"],
                "properties": {
                    "text": {"type": "string"},
                    "source_url": {"type": "string"},
                    "evidence_terms": {"type": "array", "items": {"type": "string"}},
                },
            },
        },
        "ai_label": {"type": "boolean"},
    },
}

BANNED = ["delve", "tapestry", "seamless", "leverage", "unlock", "game-changer",
          "cutting-edge", "journey", "ecosystem", "revolutionize"]

PROMPT = """You write one segment for Nina de la Nova, an AI presenter who explains tech news.
News item:
{news}

Deliver the segment ONLY as structured output matching the schema. Rules:
- script: 20 to 25 seconds spoken, second person, calm, no em dashes
- scenes: describe ONLY action, camera and on-screen graphics. Refer to her only as
  "the presenter". Never describe her appearance, hair, clothing, face or the studio;
  those come from a reference image. Never depict a real person.
- claims: every factual statement in the script, each with a public source_url and 2 to 4
  evidence_terms that appear literally on that page
- ai_label: true
- references: one image per scene, same order as scenes, chosen ONLY from:
  nina_podcast.png (studio), nina_portrait.png (close-up), nina_profile.png (side view)
Do not open a PR. Only update the structured output."""


def api(method, path, **kw):
    r = requests.request(method, f"{API}{path}", headers=HEADERS, timeout=30, **kw)
    r.raise_for_status()
    return r.json() if r.text else {}


def wait(session_id, prev_hash=None, timeout=900):
    """Poll until the session stops and has new structured output."""
    start = time.time()
    time.sleep(10)
    while time.time() - start < timeout:
        s = api("GET", f"/sessions/{session_id}")
        out = s.get("structured_output") or {}
        h = hashlib.sha1(json.dumps(out, sort_keys=True).encode()).hexdigest()
        if s.get("status_enum") in TERMINAL and out and h != prev_hash:
            return s.get("status_enum"), out, h
        time.sleep(15)
    raise TimeoutError(f"session {session_id} timed out")


def validate(spec):
    """Deterministic checks. Returns a list of failures, empty means pass."""
    errors = []
    for key in SPEC_SCHEMA["required"]:
        if key not in spec:
            errors.append(f"missing field: {key}")
    if errors:
        return errors

    if spec["ai_label"] is not True:
        errors.append("ai_label must be true")

    text = f"{spec['title']} {spec['script']} {' '.join(spec['scenes'])}"
    if "\u2014" in text or "\u2013" in text:
        errors.append("em or en dash found, use a hyphen or rewrite")
    for word in BANNED:
        if re.search(rf"\b{re.escape(word)}\b", text, re.I):
            errors.append(f"banned word: {word}")

    APPEARANCE = ["hair", "bob", "blazer", "dress", "shirt", "eyes", "face", "skin",
                  "wearing", "outfit", "desk", "studio"]
    for i, scene in enumerate(spec["scenes"]):
        hits = [w for w in APPEARANCE if re.search(rf"\b{w}\b", scene, re.I)]
        if hits:
            errors.append(f"scene {i}: describes appearance or set ({hits}), use 'the presenter' only")

    allowed = {f.name for f in Path("assets").glob("*.png")}
    refs = spec["references"]
    if len(refs) != len(spec["scenes"]):
        errors.append(f"references: need one per scene ({len(spec['scenes'])}), got {len(refs)}")
    for i, r in enumerate(refs):
        if r not in allowed:
            errors.append(f"reference {i}: '{r}' not in assets, allowed: {sorted(allowed)}")

    if not spec["claims"]:
        errors.append("no claims listed, every factual statement needs a source")
    for i, c in enumerate(spec["claims"]):
        try:
            page = requests.get(c["source_url"], timeout=15,
                                headers={"User-Agent": "Mozilla/5.0"})
        except requests.RequestException as e:
            errors.append(f"claim {i}: source unreachable ({e.__class__.__name__})")
            continue
        if page.status_code != 200:
            errors.append(f"claim {i}: source returned HTTP {page.status_code}")
            continue
        body = page.text.lower()
        missing = [t for t in c["evidence_terms"] if t.lower() not in body]
        if missing:
            errors.append(f"claim {i}: terms not found on source page: {missing}")
    return errors


def log(run, entry):
    run["attempts"].append(entry)
    RUN_DIR.mkdir(exist_ok=True)
    (RUN_DIR / f"{run['id']}.json").write_text(json.dumps(run, indent=2))


def run(news):
    s = api("POST", "/sessions", json={
        "prompt": PROMPT.format(news=json.dumps(news, indent=2)),
        "structured_output_schema": SPEC_SCHEMA,
        "max_acu_limit": MAX_ACU,
        "title": f"Nina segment: {news.get('title', '')[:60]}",
        "tags": ["hackbarna", "nina-segment"],
    })
    sid = s["session_id"]
    record = {"id": sid, "url": s.get("url"), "news": news, "attempts": []}
    print(f"session {sid} {s.get('url')}")

    prev = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        status, spec, prev = wait(sid, prev)
        errors = validate(spec)
        log(record, {"attempt": attempt, "status": status, "spec": spec, "errors": errors})
        if not errors:
            print(f"PASS on attempt {attempt}")
            return spec
        print(f"FAIL attempt {attempt}:\n  " + "\n  ".join(errors))
        api("POST", f"/sessions/{sid}/message", json={"message":
            "The validator rejected your output. Fix every point and update the "
            "structured output again:\n- " + "\n- ".join(errors)})

    print("REFUSED: no valid spec after max attempts, nothing ships")
    return None


if __name__ == "__main__":
    news = json.loads(Path(sys.argv[1]).read_text())
    spec = run(news)
    if spec:
        Path("segment.json").write_text(json.dumps(spec, indent=2))