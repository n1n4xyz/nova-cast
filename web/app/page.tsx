"use client";
import { useRef, useState } from "react";
import { createFalClient } from "@fal-ai/client";
import { wma } from "@fal-ai/client/realtime";

const fal = createFalClient({ proxyUrl: "/api/fal/proxy" });
const IMAGE = "https://raw.githubusercontent.com/n1n4xyz/nova-cast/main/assets/nina_podcast_vertical.png";
const ASPECT = "9:16";
const ROOM =
  "a softly lit blue-lilac wall with a string of warm Edison bulbs above her, " +
  "a dark wooden desk in front, a black podcast microphone on a boom arm in front of her";
const PREMISE =
  "Realistic talking-head segment. One presenter, static medium shot at eye level, " +
  "speaking calmly to camera with small natural hand gestures. Her face, hair, outfit, " +
  "lighting and room stay exactly as in the first frame. Natural skin texture, soft even lighting, " +
  "gentle contrast, documentary realism. The room: " + ROOM +
  ". The frame shows only the presenter and this room for the whole shot.";
const SCENES = [
  "The presenter speaks calmly to camera, relaxed posture.",
  "The presenter continues explaining, one small hand gesture.",
  "The presenter leans slightly forward and keeps talking to camera.",
  "The presenter keeps talking calmly to camera and ends with a small nod, same framing.",
];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function download(chunks: Blob[], mime: string, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(chunks, { type: mime }));
  a.download = `nina-${name.replace(".json", "")}.${mime.includes("mp4") ? "mp4" : "webm"}`;
  a.click();
}

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const runningRef = useRef(false);
  const pausedRef = useRef(false);
  const [paused, setPaused] = useState(false);
  const sessionRef = useRef<any>(null);
  const [log, setLog] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [title, setTitle] = useState("");
  const add = (m: string) => setLog((l) => [...l.slice(-40), m]);

  function playSegment(name: string, spec: any): Promise<void> {
    return new Promise((resolve) => {
      const v = videoRef.current!;
      const combined = new MediaStream();
      v.srcObject = combined;
      const secs = spec.audio_seconds ?? 25;
      const step = Math.max(5, Math.floor(secs / SCENES.length));
      const script = SCENES.map((p, i) =>
        i === 0 ? { offset: 0, prompt: p, audio_url: spec.audio_url } : { offset: i * step, prompt: p });
      let recorder: MediaRecorder | null = null;
      const chunks: Blob[] = [];
      let finished = false;

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
        const mime = MediaRecorder.isTypeSupported("video/mp4") ? "video/mp4" : "video/webm";
        recorder = new MediaRecorder(combined, { mimeType: mime });
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
        onState: (s) => { if (s === "failed" || s === "closed") finish(`state ${s}`); },
        onError: (e) => finish(`error ${String(e)}`),
      });
      sessionRef.current = session;
      session.send({
        type: "configure", prompt_version: 1, protocol_version: 1,
        prompt: PREMISE, resolution: "768p", aspect_ratio: ASPECT,
        image_url: IMAGE, memory: 12, script,
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
        await playSegment(name, spec);
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

  return (
    <main style={{ padding: 24, fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button onClick={start} style={{ padding: "8px 16px", background: "#111", color: "#fff", borderRadius: 6 }}>Start</button>
        <button onClick={stop} style={{ padding: "8px 16px", border: "1px solid #111", borderRadius: 6 }}>Stop</button>
        <button onClick={() => { pausedRef.current = !pausedRef.current; setPaused(pausedRef.current); }} style={{ padding: "8px 16px", border: "1px solid #111", borderRadius: 6 }}>{paused ? "Resume" : "Pause after this segment"}</button>
      </div>
      {title && <p style={{ margin: "0 0 8px", fontSize: 14 }}>Now: {title}</p>}
      <div style={{ position: "relative", display: "inline-block" }}>
        <video ref={videoRef} autoPlay playsInline controls style={{ maxHeight: "75vh", background: "#000" }} />
        <span style={{ position: "absolute", top: 12, left: 12, background: "rgba(0,0,0,.6)",
          color: "#fff", padding: "4px 8px", fontSize: 12, borderRadius: 4 }}>AI GENERATED</span>
        {status && <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center",
          justifyContent: "center", color: "#fff", fontSize: 14 }}>{status}</span>}
      </div>
      <pre style={{ fontSize: 11, maxHeight: 200, overflow: "auto" }}>{log.join("\n")}</pre>
    </main>
  );
}
