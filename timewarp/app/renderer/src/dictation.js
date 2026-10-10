// Voice input: records from the microphone and returns the transcribed text.
// Audio goes to Timewarp's transcription service and is not kept.
import { useEffect, useRef, useState } from "react";
import { call } from "./api.js";

const MAX_SECONDS = 15 * 60;
// Shorter recordings are discarded, as before.
const MIN_MS = 250;
// The level meter: one bar every 60ms, the latest 24 shown.
const LEVEL_MS = 60, LEVELS = 24;
export const TRANSCRIPTION_FAILED = "Transcription failed, try again in 5 seconds!";

// How loud the microphone is, 0 to 1.
function levelOf(analyser) {
  const samples = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(samples);
  let sum = 0;
  for (const sample of samples) { const value = (sample - 128) / 128; sum += value * value; }
  return Math.min(1, Math.sqrt(sum / samples.length) * 4);
}

// status: idle, starting (asking for the microphone), recording,
// transcribing, failed (the recording is kept for Retry) or retrying.
// onText(text, { send }) gets the words; send is set by "Transcribe and send".
export function useDictation({ onText, onError }) {
  const [state, setState] = useState({ status: "idle", seconds: 0, levels: [] });
  const session = useRef(null);
  // Set while the microphone is being opened, so a second click doesn't open another.
  const opening = useRef(null);
  // A recording whose transcription failed, for Retry.
  const failed = useRef(null);
  const handlers = useRef({ onText, onError });
  handlers.current = { onText, onError };

  function release(current) {
    clearInterval(current.timer);
    clearInterval(current.meter);
    current.audio?.close?.().catch?.(() => {});
    current.stream.getTracks().forEach(track => track.stop());
  }
  async function transcribe(recording, retrying = false) {
    setState({ status: retrying ? "retrying" : "transcribing", seconds: 0, levels: [] });
    try {
      const { text } = await call("dictation.transcribe", { audio: recording.audio, mimeType: recording.mimeType });
      failed.current = null;
      setState({ status: "idle", seconds: 0, levels: [] });
      if (text) handlers.current.onText(text, { send: recording.send });
    } catch (error) {
      // Credits, length and empty recordings won't change on Retry.
      if ([400, 402, 413].includes(error?.status)) { failed.current = null; setState({ status: "idle", seconds: 0, levels: [] }); handlers.current.onError(error); return; }
      failed.current = recording;
      setState({ status: "failed", seconds: 0, levels: [] });
      handlers.current.onError(new Error(TRANSCRIPTION_FAILED));
    }
  }
  async function start() {
    if (session.current || opening.current) return;
    failed.current = null;
    const pending = { cancelled: false };
    opening.current = pending;
    setState({ status: "starting", seconds: 0, levels: [] });
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch {
      opening.current = null;
      setState({ status: "idle", seconds: 0, levels: [] });
      if (!pending.cancelled) handlers.current.onError(new Error("Timewarp can't use the microphone. Allow microphone access in your system settings and try again."));
      return;
    }
    opening.current = null;
    // Discarded (Escape) or closed while the microphone opened.
    if (pending.cancelled) { stream.getTracks().forEach(track => track.stop()); setState({ status: "idle", seconds: 0, levels: [] }); return; }
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
    const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32000 });
    const current = { recorder, stream, chunks: [], cancelled: false, send: false, timer: null, meter: null, audio: null, levels: [], started: Date.now() };
    session.current = current;
    recorder.ondataavailable = event => { if (event.data.size) current.chunks.push(event.data); };
    recorder.onstop = async () => {
      release(current);
      if (session.current === current) session.current = null;
      const blob = new Blob(current.chunks, { type: "audio/webm" });
      if (current.cancelled || !blob.size || Date.now() - current.started < MIN_MS) { setState({ status: "idle", seconds: 0, levels: [] }); return; }
      await transcribe({ audio: await blob.arrayBuffer(), mimeType: "audio/webm", send: current.send });
    };
    current.timer = setInterval(() => {
      const seconds = Math.floor((Date.now() - current.started) / 1000);
      setState(value => value.status === "recording" ? { ...value, seconds } : value);
      if (seconds >= MAX_SECONDS) recorder.stop();
    }, 500);
    // The level meter, where the page can measure the microphone.
    const Context = window.AudioContext || window.webkitAudioContext;
    if (Context) {
      try {
        current.audio = new Context();
        const analyser = current.audio.createAnalyser();
        analyser.fftSize = 256;
        current.audio.createMediaStreamSource(stream).connect(analyser);
        current.meter = setInterval(() => {
          current.levels = [...current.levels, levelOf(analyser)].slice(-LEVELS);
          setState(value => value.status === "recording" ? { ...value, levels: current.levels } : value);
        }, LEVEL_MS);
      } catch { current.audio = null; }
    }
    recorder.start(1000);
    setState({ status: "recording", seconds: 0, levels: [] });
  }
  // Finishes the recording and transcribes it; with send, the words are sent at once.
  const stop = ({ send = false } = {}) => {
    const current = session.current;
    if (current?.recorder.state !== "recording") return;
    current.send = !!send;
    current.recorder.stop();
  };
  const retry = () => { if (failed.current && !session.current) void transcribe(failed.current, true); };
  const cancel = () => {
    if (opening.current) opening.current.cancelled = true;
    if (session.current) { session.current.cancelled = true; stop(); }
    else if (failed.current) { failed.current = null; setState({ status: "idle", seconds: 0, levels: [] }); }
  };
  useEffect(() => () => {
    if (opening.current) opening.current.cancelled = true;
    if (session.current) { session.current.cancelled = true; session.current.recorder.stop(); }
  }, []);
  return { ...state, start, stop, retry, cancel };
}
