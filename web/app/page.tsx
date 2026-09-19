"use client";
import { useRef, useState } from "react";
import { createFalClient } from "@fal-ai/client";
import { wma } from "@fal-ai/client/realtime";

const fal = createFalClient({ proxyUrl: "/api/fal/proxy" });
const IMAGE_BASE = "https://raw.githubusercontent.com/n1n4xyz/nova-cast/main/assets/";
const ASPECT = "9:16"; // must match your reference image
const ROOM =
  "a cozy dark podcast studio with wooden bookshelves full of books, small plants " +
  "and warm Edison bulb lamps behind her, a black podcast microphone on the right";
const PREMISE =
  "Realistic talking-head segment. One presenter, static medium shot at eye level, " +
  "speaking calmly to camera with small natural hand gestures. Her face, hair, outfit, " +
  "lighting and room stay exactly as in the first frame. Natural skin texture, soft even lighting, gentle contrast, " +
  "documentary realism. The room: " + ROOM + ". The frame shows only the presenter and this room for the whole shot.";

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<any>(null);
  const totalRef = useRef(0);
  const timerRef = useRef<any>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const add = (m: string) => setLog((l) => [...l.slice(-30), m]);

  async function start() {
    add("starting..."); setStatus("Connecting...");
    try { await run(); } catch (e) { add(`error: ${String(e)}`); }
  }

  async function run() {
    const spec = await (await fetch("/segment.json")).json();
    const step = Math.max(5, Math.floor(40 / spec.scenes.length));
    totalRef.current = spec.scenes.length * step;
    const sentences: string[] = spec.script.match(/[^.!?]+[.!?]+/g) ?? [spec.script];
    const per = Math.ceil(sentences.length / spec.scenes.length);
    const withLine = (p: string, i: number) => {
      const line = sentences.slice(i * per, (i + 1) * per).join(" ").trim();
      return line ? `${p} The presenter says, in clear English: "${line}"` : p;
    };
    const anchor = IMAGE_BASE + (spec.references?.[0] ?? "nina_podcast.png");
    const script = spec.scenes.map((p: string, i: number) =>
      i === 0 ? { offset: 0, prompt: withLine(p, i) } : { offset: i * step, prompt: withLine(p, i) });
    const session = fal.realtime.open(wma("minimax/h3-max/director"), {
      receive: ["video", "audio"],
      onMedia: (stream) => {
        const v = videoRef.current;
        if (!v) return;
        add(`media: ${stream.getTracks().map((t) => t.kind).join(",")}`);
        const combined = (v.srcObject as MediaStream) ?? new MediaStream();
        stream.getTracks().forEach((t) => { if (!combined.getTracks().includes(t)) combined.addTrack(t); });
        v.srcObject = combined;
        if (!recorderRef.current && combined.getVideoTracks().length && combined.getAudioTracks().length) {
          const mime = MediaRecorder.isTypeSupported("video/mp4") ? "video/mp4" : "video/webm";
          const r = new MediaRecorder(combined, { mimeType: mime });
          chunksRef.current = [];
          r.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
          r.onstop = () => {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob(chunksRef.current, { type: mime }));
            a.download = `nina-${Date.now()}.${mime.includes("mp4") ? "mp4" : "webm"}`;
            a.click();
          };
          r.start(1000);
          recorderRef.current = r;
          add(`recording (${mime})`);
        }
        v.play().catch((e) => add(`play blocked: ${e}`));
      },
      onData: (raw) => {
        const m = JSON.parse(raw);
        if (m.type === "configured") setStatus("Generating first chunk, about 10 seconds...");
        if (m.type === "chunk") setStatus("");
        if (!["chunk_metrics", "session_metrics"].includes(m.type)) add(JSON.stringify(m).slice(0, 200));
      },
      onState: (s) => add(`state: ${s}`),
      onError: (e) => add(`error: ${String(e)}`),
    });
    sessionRef.current = session;
    session.send({
      type: "configure", prompt_version: 1, protocol_version: 1,
      prompt: PREMISE, resolution: "768p", aspect_ratio: ASPECT,
      image_url: IMAGE_BASE + (spec.references?.[0] ?? "nina_podcast.png"),
      memory: 12, script,
    });
  }

  async function stop() {
    clearTimeout(timerRef.current); timerRef.current = null;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    recorderRef.current = null;
    await sessionRef.current?.close(); add("closed");
  }

  return (
    <main style={{ padding: 24, fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}><button onClick={start} style={{ padding: "8px 16px", background: "#111", color: "#fff", borderRadius: 6 }}>Start</button><button onClick={stop} style={{ padding: "8px 16px", border: "1px solid #111", borderRadius: 6 }}>Stop</button></div>
      <div style={{ position: "relative", display: "inline-block", marginTop: 16 }}>
        <video onPlaying={() => { if (!timerRef.current && totalRef.current) { add(`auto-stop in ${totalRef.current}s`); timerRef.current = setTimeout(stop, totalRef.current * 1000); } }} ref={videoRef} autoPlay playsInline controls style={{ maxHeight: "75vh", background: "#000" }} />
        <span style={{ position: "absolute", top: 12, left: 12, background: "rgba(0,0,0,.6)",
          color: "#fff", padding: "4px 8px", fontSize: 12, borderRadius: 4 }}>AI GENERATED</span>
        {status && <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 14 }}>{status}</span>}
      </div>
      <pre style={{ fontSize: 11, maxHeight: 200, overflow: "auto" }}>{log.join("\n")}</pre>
    </main>
  );
}
