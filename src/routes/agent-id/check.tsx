import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { DragEvent, FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";

import { Reasons } from "@/components/agent-id/site/angles";
import { TracedViz } from "@/components/agent-id/site/demos";
import {
  Closing,
  Faq,
  Hero,
  Icon,
  MASCOT,
  Moment,
  SitePage,
} from "@/components/agent-id/site/Site";
import { errorMessage } from "@/lib/agent-id/client";
import { ORIGIN_LABELS, formatDate, modelKindText, modelLabel } from "@/lib/agent-id/format";
import { traceApi } from "@/lib/agent-id/session";
import { fileKind, preparePicture, prepareSound, type TraceCheck } from "@/lib/agent-id/trace";

const DESCRIPTION =
  "Check if a picture, a voice or a text was made by an AI agent with an Agent ID, and who answers for it.";

export const Route = createFileRoute("/agent-id/check")({
  head: () => ({
    meta: [
      { title: "Check if AI made it · Timewarp Agent ID" },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "AI or real? Check it." },
      { property: "og:description", content: DESCRIPTION },
    ],
  }),
  component: CheckPage,
});

// Angle A2 (docs/agent-id-ladder.md): people who must tell AI work from human
// work. The answer comes first: the checker is the hero, built like the app's
// composer. Then the moment they know, how a mark works and its limits, and
// making your own agents' work traceable.
function CheckPage() {
  return (
    <SitePage>
      <Hero
        kicker="AI or real?"
        title="Was this made by AI?"
        lede={
          <>
            Drop a picture or a voice, or paste text. If an AI with an Agent ID made it, you'll see{" "}
            <b>which one, and who answers for it</b>.
          </>
        }
        actions={<Checker />}
      />

      <Moment
        title="Detectors guess. A mark knows."
        lines={[
          "A logo that was meant to be hand-drawn. A voice note “from the boss”.",
          "AI detectors look at the finished work and guess.",
          "Sometimes they flag real people.",
        ]}
        turn="Agent ID marks the work when it's made, so a check finds the mark, or doesn't."
      />

      <section className="section wrap" aria-label="How it works">
        <h2>Every mark leads back to an agent.</h2>
        <div className="quad three">
          <article className="q-card">
            <div className="q-viz">
              <TracedViz />
            </div>
            <h3>Marked when it's made</h3>
            <p>Pictures and sound get a mark you can't see or hear. Text gets an invisible one.</p>
          </article>
          <article className="q-card">
            <div className="q-viz">
              <div className="card pad">
                <p className="r-text strong">Signed receipt</p>
                {(
                  [
                    ["Made by", "Poster Studio"],
                    ["Answers for it", "Nordic Prints AB ✓"],
                    ["When", "21 Oct 2026, 14:02"],
                    ["Trace", "tr_9a41c07e52d3b816"],
                  ] as const
                ).map(([term, value]) => (
                  <div key={term} className="pay-line small">
                    {term} <b className={term === "Trace" ? "mono" : undefined}>{value}</b>
                  </div>
                ))}
              </div>
            </div>
            <h3>Signed and dated</h3>
            <p>Each mark has a receipt: which AI made it, and when.</p>
          </article>
          <article className="q-card">
            <div className="q-viz">
              <div className="card pad">
                <p className="r-text strong">No Agent ID mark found</p>
                <p className="r-text quiet">That doesn't prove a person made it.</p>
              </div>
            </div>
            <h3>Honest about what it can't see</h3>
            <p>Only work made through Agent ID carries a mark.</p>
          </article>
        </div>
      </section>

      <Faq
        items={[
          [
            "Can the mark be removed?",
            "A picture's mark survives JPEG, resizing, brightness and blur. A sound's survives MP3, volume and noise, from about 10 seconds. Cropping or turning a picture, or speeding up a sound, removes it, and so can someone determined. Text marks are easy to strip, so text is also matched by its fingerprint.",
          ],
          [
            "Is my file kept?",
            "No. Your browser sends a small copy, it's checked, and only the answer comes back.",
          ],
          [
            "What about video?",
            "Video is recorded and matched exactly for now. A mark inside the picture comes next.",
          ],
          [
            "Is it like Google's SynthID?",
            "The idea is the same: a mark put in when it's made. SynthID finds Google's models. Agent ID finds any AI with an Agent ID, and who answers for it.",
          ],
        ]}
      />

      <Closing
        title="Make your agents' work traceable."
        lede="Give your agents an Agent ID, and what they send through it is marked. Free, no card."
      />
      <Reasons current="check" />
    </SitePage>
  );
}

type Mode = "file" | "text";

// The checker, as the app's composer: a file or text in, the answer below.
function Checker() {
  const [mode, setMode] = useState<Mode>("file");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [dragging, setDragging] = useState(false);
  const preview = usePreview(file);
  const kind = file ? fileKind(file) : null;

  const check = useMutation({
    mutationFn: async (): Promise<TraceCheck> => {
      if (mode === "text") return traceApi.check(text, "text/plain; charset=utf-8");
      if (!file) throw new Error("Choose a file first.");
      if (kind === "image") return traceApi.check(await preparePicture(file), "image/png");
      if (kind === "audio") return traceApi.check(await prepareSound(file), "audio/wav");
      if (kind === "text") return traceApi.check(await file.text(), "text/plain; charset=utf-8");
      if (kind === "video") throw new Error("Video can't be checked here yet.");
      throw new Error("Choose a picture, a sound file or a text file.");
    },
  });

  const ready = mode === "text" ? text.trim().length >= 20 : !!file;
  const choose = (next: File | null | undefined) => {
    setFile(next ?? null);
    check.reset();
  };
  const drop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    choose(event.dataTransfer.files[0]);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (check.isPending) return;
    // Nothing to check yet: open the file picker, or go to the text box.
    if (!ready) {
      const form = event.currentTarget as HTMLFormElement;
      if (mode === "file") form.querySelector<HTMLInputElement>("input[type=file]")?.click();
      else form.querySelector("textarea")?.focus();
      return;
    }
    check.mutate();
  };

  return (
    <form onSubmit={submit} aria-label="Check" className="composer checker">
      <div className="sb-tabs" role="group" aria-label="What to check">
        {(
          [
            ["file", "A file"],
            ["text", "Text"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            className={`sb-tab ${mode === value ? "on" : ""}`}
            onClick={() => {
              setMode(value);
              check.reset();
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === "file" ? (
        <label
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={drop}
          className={`drop ${dragging ? "over" : ""}`}
        >
          <input
            type="file"
            accept="image/*,audio/*,.txt,.md"
            className="sr-only"
            onChange={(event) => choose(event.target.files?.[0])}
          />
          {file ? (
            <span className="drop-in">
              {preview && kind === "image" && <img src={preview} alt="" className="drop-pic" />}
              {preview && kind === "audio" && <audio src={preview} controls />}
              <b>{file.name}</b>
              <small>Choose another</small>
            </span>
          ) : (
            <span className="drop-in">
              <span className="drop-mascots" aria-hidden="true">
                <img src={MASCOT.nova} alt="" />
                <img src={MASCOT.cosmo} alt="" />
              </span>
              <b>Drop a picture or a voice</b>
              <small>PNG, JPEG, WebP, WAV, MP3 and more. Only a small copy is checked.</small>
            </span>
          )}
        </label>
      ) : (
        <textarea
          aria-label="Text to check"
          className="ta"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            check.reset();
          }}
          maxLength={100_000}
          placeholder="Paste an email, a message, an essay or code."
        />
      )}
      <div className="c-bar">
        <span className="c-chip">
          <span className="stack">
            <img src={MASCOT.orbit} alt="" />
          </span>
          Free · nothing is kept
        </span>
        <button type="submit" className="send" disabled={check.isPending}>
          {check.isPending ? "Checking…" : "Check"}
          <Icon name="up" />
        </button>
      </div>
      <div aria-live="polite">
        {check.isError && <p className="err">{errorMessage(check.error)}</p>}
        {check.data && <Result result={check.data} />}
      </div>
    </form>
  );
}

function usePreview(file: File | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

const KIND_WORDS: Record<string, string> = {
  image: "picture",
  audio: "sound",
  text: "text",
  code: "code",
  video: "video",
  other: "file",
};
const FACE: Record<string, string> = {
  orbit: MASCOT.orbit,
  nova: MASCOT.nova,
  cosmo: MASCOT.cosmo,
};

function Result({ result }: { result: TraceCheck }) {
  if (!result.found) {
    return (
      <div className="card pad result">
        <p className="r-text strong">
          No Agent ID mark found in this {KIND_WORDS[result.kind] ?? "file"}.
        </p>
        <p className="r-text quiet">
          That doesn't prove a person made it: only work made through Agent ID carries a mark.
        </p>
      </div>
    );
  }
  const { trace } = result;
  const kind = modelKindText(trace.agent.model);
  const via = [
    trace.app ? (ORIGIN_LABELS[trace.app.app] ?? trace.app.label) : null,
    trace.model ? modelLabel(trace.model) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const owner =
    trace.owner.name ??
    (trace.owner.verified
      ? trace.owner.type === "business"
        ? "A verified business"
        : "A verified person"
      : "A person, not verified yet");
  return (
    <div className="card result">
      <div className="row">
        <span className="chip id">Made by AI</span>
        <div>
          <small>
            {result.match === "mark"
              ? "Agent ID mark found"
              : result.match === "exact"
                ? "The same file was made by an agent"
                : `Matches text an agent made${result.similarity ? ` (${Math.round(result.similarity * 100)}% the same)` : ""}`}
          </small>
        </div>
      </div>
      <div className="row">
        <img src={FACE[trace.agent.mascot ?? "orbit"] ?? MASCOT.orbit} alt="" />
        <div>
          <b>{trace.agent.name}</b>
          <small>{[kind ?? "AI agent", via].filter(Boolean).join(" · ")}</small>
        </div>
      </div>
      <div className="row">
        <div>
          <small>Answers for it</small>
          <b>
            {owner}
            {trace.owner.verified ? " ✓" : ""}
          </b>
        </div>
        <div>
          <small>Made</small>
          <b>{formatDate(trace.createdAt)}</b>
        </div>
      </div>
      {trace.agent.status !== "active" && (
        <div className="row">
          <small>
            This agent has since been {trace.agent.status === "revoked" ? "revoked" : "paused"} by
            its owner.
          </small>
        </div>
      )}
    </div>
  );
}
