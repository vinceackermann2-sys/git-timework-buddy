// Voice input: records from the microphone and returns the transcribed text.
// Audio goes to Timewarp's transcription service and is not kept.
import { useEffect, useRef, useState } from "react";
import { call } from "./api.js";

const MAX_SECONDS = 15 * 60;

export function useDictation({ onText, onError }) {
  const [state, setState] = useState({ status: "idle", seconds: 0 });
  const session = useRef(null);

  function release(current) {
    clearInterval(current.timer);
    current.stream.getTracks().forEach(track => track.stop());
  }
  async function start() {
    if (session.current) return;
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch { onError(new Error("Timewarp can't use the microphone. Allow microphone access in your system settings and try again.")); return; }
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
    const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32000 });
    const current = { recorder, stream, chunks: [], cancelled: false, timer: null, started: Date.now() };
    session.current = current;
    recorder.ondataavailable = event => { if (event.data.size) current.chunks.push(event.data); };
    recorder.onstop = async () => {
      release(current);
      session.current = null;
      const blob = new Blob(current.chunks, { type: "audio/webm" });
      if (current.cancelled || !blob.size) { setState({ status: "idle", seconds: 0 }); return; }
      setState({ status: "transcribing", seconds: 0 });
      try {
        const { text } = await call("dictation.transcribe", { audio: await blob.arrayBuffer(), mimeType: "audio/webm" });
        if (text) onText(text);
      } catch (error) { onError(error); }
      finally { setState({ status: "idle", seconds: 0 }); }
    };
    current.timer = setInterval(() => {
      const seconds = Math.floor((Date.now() - current.started) / 1000);
      setState({ status: "recording", seconds });
      if (seconds >= MAX_SECONDS) recorder.stop();
    }, 500);
    recorder.start(1000);
    setState({ status: "recording", seconds: 0 });
  }
  const stop = () => { if (session.current?.recorder.state === "recording") session.current.recorder.stop(); };
  const cancel = () => { if (session.current) { session.current.cancelled = true; stop(); } };
  useEffect(() => () => { if (session.current) { session.current.cancelled = true; session.current.recorder.stop(); } }, []);
  return { ...state, start, stop, cancel };
}
