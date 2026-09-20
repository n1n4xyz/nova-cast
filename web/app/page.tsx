"use client";
import { useRef, useState } from "react";
import { createFalClient } from "@fal-ai/client";
import { wma } from "@fal-ai/client/realtime";

const fal = createFalClient({ proxyUrl: "/api/fal/proxy" });
const BASE = "https://raw.githubusercontent.com/n1n4xyz/nova-cast/main/assets/";
const ASPECT = "9:16";
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

function download(chunks: Blob[], mime: string, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(chunks, { type: mime }));
  a.download = `nina-${name.replace(".json", "")}.${mime.includes("mp4") ? "mp4" : "webm"}`;
  a.click();
}

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runningRef = useRef(false);
  const pausedRef = useRef(false);
  const sessionRef = useRef<any>(null);
  const [paused, setPaused] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [title, setTitle] = useState("");
  const add = (m: string) => setLog((l) => [...l.slice(-40), m]);

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
          ctx.font = `600 ${11 * s}px sans-serif`;
          const label = "AI GENERATED";
          ctx.fillStyle = "rgba(0,0,0,.6)";
          ctx.fillRect(12 * s, 12 * s, ctx.measureText(label).width + 16 * s, 22 * s);
          ctx.fillStyle = "#fff";
          ctx.fillText(label, 20 * s, 23 * s);
          if (t0) {
            const t = (performance.now() - t0) / 1000;
            const cue = cues.find((q) => t >= q.start && t < q.end);
            if (cue) {
              ctx.font = `700 ${20 * s}px sans-serif`;
              ctx.textAlign = "center";
              const lines = wrap(ctx, cue.text, W * 0.85);
              const lh = 28 * s;
              const y0 = H * 0.8 - ((lines.length - 1) * lh) / 2;
              lines.forEach((ln, i) => {
                const y = y0 + i * lh;
                const w = ctx.measureText(ln).width + 16 * s;
                ctx.fillStyle = "rgba(0,0,0,.65)";
                ctx.fillRect(W / 2 - w / 2, y - lh / 2, w, lh);
                ctx.fillStyle = "#fff";
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
          r.onstop = () => download(chunks, r.mimeType, name);
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
          if (m.type === "configured") setStatus("Generating first chunk...");
          if (m.type === "error") finish(`error ${m.code}`);
        },
        onState: (st) => { if (st === "failed" || st === "closed") finish(`state ${st}`); },
        onError: (e) => finish(`error ${String(e)}`),
      });
      sessionRef.current = session;
      session.send({
        type: "configure", prompt_version: 1, protocol_version: 1,
        prompt: premise(img), resolution: "768p", aspect_ratio: ASPECT,
        image_url: BASE + img.file, memory: 12, script,
      });
    });
  }

  async function start() {
    if (runningRef.current) return;
    runningRef.current = true;
    let idx = 0;
    while (runningRef.current) {
      if (pausedRef.current) { setStatus("Paused"); await sleep(1000); continue; }
      let names: string[] = [];
      try { names = await (await fetch(`/queue/index.json?t=${Date.now()}`)).json(); } catch {}
      if (idx < names.length) {
        const name = names[idx++];
        const spec = await (await fetch(`/queue/${name}?t=${Date.now()}`)).json();
        setTitle(spec.title ?? name);
        setStatus("Connecting...");
        await playSegment(name, spec, IMAGES[(idx - 1) % IMAGES.length]);
      } else {
        setStatus("Waiting for the next segment...");
        await sleep(10000);
      }
    }
    setStatus("");
    setTitle("");
  }

  async function stop() {
    runningRef.current = false;
    try { await sessionRef.current?.close(); } catch {}
  }

  const btn = { padding: "8px 16px", border: "1px solid #111", borderRadius: 6 };
  return (
    <main style={{ padding: 24, fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button onClick={start} style={{ ...btn, background: "#111", color: "#fff" }}>Start</button>
        <button onClick={stop} style={btn}>Stop</button>
        <button onClick={() => { pausedRef.current = !pausedRef.current; setPaused(pausedRef.current); }} style={btn}>
          {paused ? "Resume" : "Pause after this segment"}
        </button>
      </div>
      {title && <p style={{ margin: "0 0 8px", fontSize: 14 }}>Now: {title}</p>}
      <div style={{ position: "relative", display: "inline-block" }}>
        <canvas ref={canvasRef} style={{ maxHeight: "75vh", background: "#000", display: "block" }} />
        {status && <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center",
          justifyContent: "center", color: "#fff", fontSize: 14 }}>{status}</span>}
      </div>
      <video ref={videoRef} autoPlay playsInline
        style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }} />
      <pre style={{ fontSize: 11, maxHeight: 200, overflow: "auto" }}>{log.join("\n")}</pre>
    </main>
  );
}
