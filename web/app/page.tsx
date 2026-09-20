"use client";
import { useEffect, useRef, useState } from "react";
import { Bricolage_Grotesque, Figtree } from "next/font/google";
import { createFalClient } from "@fal-ai/client";
import { wma } from "@fal-ai/client/realtime";

const fDisplay = Bricolage_Grotesque({ subsets: ["latin"], weight: ["500", "700"] });
const fBody = Figtree({ subsets: ["latin"], weight: ["400", "500", "600"] });
const fal = createFalClient({ proxyUrl: "/api/fal/proxy" });

const BASE = "https://raw.githubusercontent.com/n1n4xyz/nova-cast/main/assets/";
type Img = { file: string; framing: string; room: string };
const SLAT_ROOM =
  "a warm backlit vertical wooden slat wall behind her, the edge of a podcast desk with a " +
  "microphone on a boom arm at the left, shelves with green plants at the right";
const IMAGES: Img[] = [
  { file: "nina_podcast_vertical.png", framing: "static medium shot at eye level, seated at a desk",
    room: "a softly lit blue-lilac wall with a string of warm Edison bulbs above her, a dark wooden " +
          "desk in front, a black podcast microphone on a boom arm in front of her" },
  { file: "nina_podcast2_medium.png", framing: "static medium shot at eye level, standing", room: SLAT_ROOM },
  { file: "nina_podcast3_medium.png", framing: "static medium shot at eye level, standing", room: SLAT_ROOM },
  { file: "nina_podcast4_medium.png", framing: "static medium shot at eye level, standing", room: SLAT_ROOM },
  { file: "nina_podcast5_medium.png", framing: "static medium shot at eye level, standing",
    room: "a bright studio with soft grey walls and beige acoustic panels behind her, a warm lamp and a desk " +
          "with an audio mixer and a microphone on a boom arm at the left, a green plant at the right edge" },
];
const premise = (img: Img) =>
  `Realistic talking-head segment. One presenter, ${img.framing}, speaking calmly to camera ` +
  `with small natural hand gestures. Her face, hair, outfit, lighting and room stay exactly as ` +
  `in the first frame. Natural skin texture, soft even lighting, gentle contrast, documentary ` +
  `realism. The room: ${img.room}. The frame shows only the presenter and this room for the whole shot.`;
const SCENES = [
  "The presenter speaks calmly to camera, relaxed posture.",
  "The presenter continues explaining, one small hand gesture.",
  "The presenter leans slightly forward and keeps talking to camera.",
  "The presenter keeps talking calmly to camera and ends with a small nod, same framing.",
];
const C = { ink: "#16142A", deep: "#0F0E1F", line: "#2E2A52", lilac: "#B9B3F2", bulb: "#F4B860",
  text: "#EEEBFA", muted: "#9C97C4", bad: "#F2998F", good: "#8FD6B4" };
const KIND: Record<string, { label: string; color: string }> = {
  research: { label: "Picked up", color: C.muted },
  writing: { label: "Devin is writing", color: C.lilac },
  blocked: { label: "Validator blocked", color: C.bad },
  passed: { label: "Verified", color: C.good },
  refused: { label: "Dropped", color: C.bad },
  voice: { label: "Voiced", color: C.bulb },
  queued: { label: "Ready to air", color: C.bulb },
  error: { label: "Failed", color: C.bad },
};
type Ev = { t: string; kind: string; title: string; text: string };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function cuesFrom(script: string, secs: number) {
  const words = script.split(/\s+/).filter(Boolean);
  const groups: string[] = [];
  for (let i = 0; i < words.length; i += 6) groups.push(words.slice(i, i + 6).join(" "));
  const total = groups.reduce((n, g) => n + g.length, 0) || 1;
  let t = 0;
  return groups.map((text) => { const start = t; t += (text.length / total) * secs; return { start, end: t, text }; });
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  const lines: string[] = [];
  let line = "";
  for (const w of text.split(" ")) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill();
}

function host(url?: string) {
  try { return new URL(url ?? "").hostname.replace(/^www\./, ""); } catch { return ""; }
}

const CSS = `
.nc{min-height:100vh;background:${C.ink};color:${C.text}}
.nc-top{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:18px 32px;border-bottom:1px solid ${C.line}}
.nc-brand{font-size:22px;font-weight:700;letter-spacing:-0.01em;margin:0}
.nc-sub{font-size:13px;color:${C.muted};margin:2px 0 0}
.nc-controls{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.nc-live{display:inline-flex;align-items:center;gap:7px;font-size:13px;margin-right:6px}
.nc-dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex:none}
.nc-btn{font:inherit;font-size:14px;padding:8px 16px;border-radius:999px;border:1px solid ${C.line};background:transparent;color:${C.text};cursor:pointer}
.nc-btn:hover{border-color:${C.muted}}
.nc-btn:focus-visible{outline:2px solid ${C.bulb};outline-offset:2px}
.nc-primary{background:${C.bulb};border-color:${C.bulb};color:${C.ink};font-weight:600}
.nc-grid{display:grid;grid-template-columns:auto minmax(0,1fr);gap:48px;padding:32px;max-width:1240px;margin:0 auto;align-items:start}
.nc-stage{position:relative;height:min(78vh,860px);aspect-ratio:9/16;border-radius:22px;overflow:hidden;background:${C.deep};outline:1px solid ${C.line}}
.nc-stage canvas{width:100%;height:100%;display:block}
.nc-status{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;color:${C.muted};font-size:15px}
.nc-ticker{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:14px;font-size:13px;color:${C.muted}}
.nc-side{display:flex;flex-direction:column;gap:36px;min-width:0;padding-top:4px}
.nc-h{font-size:13px;color:${C.muted};margin:0 0 8px}
.nc-now{font-size:34px;font-weight:500;line-height:1.12;letter-spacing:-0.02em;margin:0 0 16px;max-width:22ch}
.nc-chips{display:flex;gap:8px;flex-wrap:wrap}
.nc-chip{display:inline-flex;align-items:center;gap:6px;font-size:13px;padding:6px 13px;border-radius:999px;border:1px solid ${C.line};color:${C.text};text-decoration:none}
a.nc-chip:hover{border-color:${C.muted}}
.nc-list{list-style:none;margin:0;padding:0}
.nc-list li{padding:11px 0;border-top:1px solid ${C.line};font-size:15px;line-height:1.4}
.nc-empty{color:${C.muted}}
.nc-feed li{display:grid;grid-template-columns:8px minmax(0,1fr) auto;gap:12px;align-items:baseline;font-size:14px}
.nc-time{font-size:12px;color:${C.muted}}
.nc-note{color:${C.muted}}
.nc-log{max-width:1240px;margin:0 auto;padding:0 32px 32px;color:${C.muted};font-size:12px}
.nc-log pre{max-height:220px;overflow:auto;white-space:pre-wrap}
@media (prefers-reduced-motion:no-preference){.nc-pulse{animation:ncp 2s ease-in-out infinite}}
@keyframes ncp{50%{opacity:.35}}
@media (max-width:860px){.nc-grid{grid-template-columns:1fr;padding:16px;gap:28px}.nc-stage{height:auto;width:100%}.nc-top{padding:14px 16px}.nc-now{font-size:26px}}
`;

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runningRef = useRef(false);
  const pausedRef = useRef(false);
  const sessionRef = useRef<any>(null);
  const titles = useRef(new Map<string, string>());
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [status, setStatus] = useState("Press Go live to start the stream");
  const [current, setCurrent] = useState<any>(null);
  const [upNext, setUpNext] = useState<{ name: string; title: string }[]>([]);
  const [events, setEvents] = useState<Ev[]>([]);
  const [active, setActive] = useState<{ title: string; stage: string }[]>([]);
  const [reels, setReels] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const add = (m: string) => setLog((l) => [...l.slice(-60), m]);

  useEffect(() => {
    const poll = async () => {
      try {
        const s = await (await fetch(`/status.json?t=${Date.now()}`)).json();
        setEvents(s.events ?? []);
        setActive(s.active ?? []);
      } catch {}
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, []);

  async function refreshUpNext(names: string[], from: number) {
    const out: { name: string; title: string }[] = [];
    for (const n of names.slice(from, from + 4)) {
      if (!titles.current.has(n)) {
        try {
          const s = await (await fetch(`/queue/${n}?t=${Date.now()}`)).json();
          titles.current.set(n, s.title ?? n);
        } catch {}
      }
      out.push({ name: n, title: titles.current.get(n) ?? n });
    }
    setUpNext(out);
  }

  function playSegment(name: string, spec: any, img: Img): Promise<void> {
    return new Promise((resolve) => {
      const v = videoRef.current!;
      const c = canvasRef.current!;
      const ctx = c.getContext("2d")!;
      add(`${name}: image ${img.file}`);
      const combined = new MediaStream();
      v.srcObject = combined;
      const secs = spec.audio_seconds ?? 25;
      const cues = cuesFrom(spec.script ?? "", secs);
      const step = Math.max(5, Math.floor(secs / SCENES.length));
      const script = SCENES.map((p, i) =>
        i === 0 ? { offset: 0, prompt: p, audio_url: spec.audio_url } : { offset: i * step, prompt: p });
      let recorder: MediaRecorder | null = null;
      const chunks: Blob[] = [];
      let finished = false;
      let t0 = 0;

      const draw = () => {
        if (finished) return;
        if (v.videoWidth) {
          if (c.width !== v.videoWidth) { c.width = v.videoWidth; c.height = v.videoHeight; }
          const W = c.width, H = c.height, s = W / 400;
          ctx.drawImage(v, 0, 0, W, H);
          ctx.textBaseline = "middle";
          ctx.textAlign = "left";
          ctx.font = `500 ${11 * s}px ${fBody.style.fontFamily}`;
          const label = "AI-generated";
          ctx.fillStyle = "rgba(22,20,42,.72)";
          pill(ctx, 12 * s, 12 * s, ctx.measureText(label).width + 18 * s, 22 * s, 11 * s);
          ctx.fillStyle = C.text;
          ctx.fillText(label, 21 * s, 23 * s);
          if (t0) {
            const t = (performance.now() - t0) / 1000;
            const cue = cues.find((q) => t >= q.start && t < q.end);
            if (cue) {
              ctx.font = `700 ${20 * s}px ${fDisplay.style.fontFamily}`;
              ctx.textAlign = "center";
              const lines = wrap(ctx, cue.text, W * 0.82);
              const lh = 30 * s;
              const y0 = H * 0.8 - ((lines.length - 1) * lh) / 2;
              lines.forEach((ln, i) => {
                const y = y0 + i * lh;
                const w = ctx.measureText(ln).width + 20 * s;
                ctx.fillStyle = "rgba(22,20,42,.78)";
                pill(ctx, W / 2 - w / 2, y - lh / 2 + 1 * s, w, lh - 2 * s, 9 * s);
                ctx.fillStyle = C.text;
                ctx.fillText(ln, W / 2, y);
              });
            }
          }
        }
        requestAnimationFrame(draw);
      };
      requestAnimationFrame(draw);

      const finish = async (reason: string) => {
        if (finished) return;
        finished = true;
        add(`${name}: ${reason}`);
        const r = recorder;
        if (r && r.state === "recording") {
          r.onstop = () => {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob(chunks, { type: r.mimeType }));
            a.download = `nina-${name.replace(".json", "")}.${r.mimeType.includes("mp4") ? "mp4" : "webm"}`;
            a.click();
            setReels((n) => n + 1);
          };
          r.stop();
        }
        try { await sessionRef.current?.close(); } catch {}
        sessionRef.current = null;
        resolve();
      };

      v.addEventListener("playing", () => {
        setStatus("");
        t0 = performance.now();
        c.width = v.videoWidth; c.height = v.videoHeight;
        const mime = MediaRecorder.isTypeSupported("video/mp4") ? "video/mp4" : "video/webm";
        const out = new MediaStream([...c.captureStream(30).getVideoTracks(), ...combined.getAudioTracks()]);
        recorder = new MediaRecorder(out, { mimeType: mime });
        recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        recorder.start(1000);
        add(`${name}: live, ends in ${Math.ceil(secs) + 2}s`);
        setTimeout(() => finish("done"), (Math.ceil(secs) + 2) * 1000);
      }, { once: true });
      setTimeout(() => finish("timeout"), (secs + 90) * 1000);

      const session = fal.realtime.open(wma("minimax/h3-max/director"), {
        receive: ["video", "audio"],
        onMedia: (stream) => {
          stream.getTracks().forEach((t) => { if (!combined.getTracks().includes(t)) combined.addTrack(t); });
          v.play().catch(() => {});
        },
        onData: (raw) => {
          const m = JSON.parse(raw);
          if (String(m.type).startsWith("audio") || m.type === "prompt_rejected")
            add(`${name}: ${m.type} ${m.code ?? ""} ${JSON.stringify(m.detail ?? m.error ?? "")}`.slice(0, 220));
          if (m.type === "configured") setStatus("Nina is getting ready");
          if (m.type === "error") finish(`error ${m.code}`);
        },
        onState: (st) => { if (st === "failed" || st === "closed") finish(`state ${st}`); },
        onError: (e) => finish(`error ${String(e)}`),
      });
      sessionRef.current = session;
      session.send({
        type: "configure", prompt_version: 1, protocol_version: 1,
        prompt: premise(img), resolution: "768p", aspect_ratio: "9:16",
        image_url: BASE + img.file, memory: 12, script,
      });
    });
  }

  async function start() {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    let idx = 0;
    while (runningRef.current) {
      if (pausedRef.current) { setStatus("Paused. Press Resume to continue"); await sleep(1000); continue; }
      let names: string[] = [];
      try { names = await (await fetch(`/queue/index.json?t=${Date.now()}`)).json(); } catch {}
      if (idx < names.length) {
        const name = names[idx++];
        refreshUpNext(names, idx);
        const spec = await (await fetch(`/queue/${name}?t=${Date.now()}`)).json();
        setCurrent(spec);
        setStatus("Connecting to the studio");
        await playSegment(name, spec, IMAGES[(idx - 1) % IMAGES.length]);
      } else {
        refreshUpNext(names, idx);
        setStatus("Researching the next story");
        await sleep(10000);
      }
    }
    setRunning(false);
    setCurrent(null);
    setStatus("Stream ended. Press Go live to start again");
  }

  async function stop() {
    runningRef.current = false;
    try { await sessionRef.current?.close(); } catch {}
  }

  const togglePause = () => { pausedRef.current = !pausedRef.current; setPaused(pausedRef.current); };
  const source = current?.news?.url ?? current?.claims?.[0]?.source_url;
  const claims = current?.claims?.length ?? 0;
  const count = (k: string) => active.filter((a) => a.stage === k).length;
  const blocked = events.filter((e) => e.kind === "blocked").length;

  return (
    <div className={`nc ${fBody.className}`}>
      <style>{CSS}</style>
      <header className="nc-top">
        <div>
          <h1 className={`nc-brand ${fDisplay.className}`}>Nova Cast</h1>
          <p className="nc-sub">AI news, sourced and labeled</p>
        </div>
        <div className="nc-controls">
          <span className="nc-live" style={{ color: running ? C.bulb : C.muted }}>
            <span className={`nc-dot ${running ? "nc-pulse" : ""}`} style={{ background: running ? C.bulb : C.muted }} />
            {running ? "On air" : "Off air"}
          </span>
          {!running && <button className="nc-btn nc-primary" onClick={start}>Go live</button>}
          {running && <button className="nc-btn" onClick={togglePause}>{paused ? "Resume" : "Pause after this story"}</button>}
          {running && <button className="nc-btn" onClick={stop}>End stream</button>}
        </div>
      </header>

      <main className="nc-grid">
        <section aria-label="Live stream">
          <div className="nc-stage">
            <canvas ref={canvasRef} width={720} height={1280} />
            {status && <div className={`nc-status ${fDisplay.className}`}>{status}</div>}
          </div>
          <div className="nc-ticker">
            <span>{count("research")} researching</span>
            <span>{count("writing")} being written</span>
            <span>{blocked} blocked by the validator</span>
            <span>{reels} reels saved</span>
          </div>
          <video ref={videoRef} autoPlay playsInline aria-hidden="true"
            style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }} />
        </section>

        <aside className="nc-side">
          <div>
            <p className="nc-h">Now playing</p>
            {current ? (
              <>
                <h2 className={`nc-now ${fDisplay.className}`}>{current.news?.title ?? current.title}</h2>
                <div className="nc-chips">
                  {source && <a className="nc-chip" href={source} target="_blank" rel="noreferrer">{host(source)}</a>}
                  {claims > 0 && <span className="nc-chip" style={{ color: C.good }}>{claims} claims checked against sources</span>}
                </div>
              </>
            ) : (
              <h2 className={`nc-now ${fDisplay.className}`} style={{ color: C.muted }}>Nothing on air yet</h2>
            )}
          </div>

          <div>
            <p className="nc-h">Up next</p>
            <ul className="nc-list">
              {upNext.length ? upNext.map((u) => <li key={u.name}>{u.title}</li>)
                : <li className="nc-empty">The newsroom is researching the next stories</li>}
            </ul>
          </div>

          <div>
            <p className="nc-h">In the newsroom</p>
            <ul className="nc-list nc-feed">
              {events.length ? events.slice(0, 8).map((e, i) => {
                const k = KIND[e.kind] ?? { label: e.kind, color: C.muted };
                return (
                  <li key={i}>
                    <span className="nc-dot" style={{ background: k.color }} />
                    <span><span style={{ color: k.color }}>{k.label}</span> {e.title}
                      {e.text && <span className="nc-note">. {e.text}</span>}</span>
                    <span className="nc-time">{e.t}</span>
                  </li>
                );
              }) : <li className="nc-empty" style={{ display: "block" }}>Start the producer to see the newsroom at work</li>}
            </ul>
          </div>
        </aside>
      </main>

      <details className="nc-log">
        <summary>Operator log</summary>
        <pre>{log.join("\n")}</pre>
      </details>
    </div>
  );
}
