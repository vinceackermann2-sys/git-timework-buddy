import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { DragEvent, FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { BadgeCheck, FileUp, Loader2, SearchCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { NeedList } from "@/components/agent-id/site/angles";
import {
  Band,
  Eyebrow,
  Offer,
  Questions,
  SitePage,
  StartRow,
} from "@/components/agent-id/site/Site";
import { AgentAvatar, Notice, Segmented } from "@/components/agent-id/ui";
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
// work. The answer comes first (the checker), then how the mark works, its
// honest limits, and marking your own agents' work.
function CheckPage() {
  return (
    <SitePage>
      <section className="mx-auto grid w-full max-w-6xl grid-cols-[minmax(0,1fr)] items-start gap-12 px-4 pb-16 pt-10 sm:px-6 sm:pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
        <div className="lg:pt-6">
          <Eyebrow>AI or real?</Eyebrow>
          <h1 className="mt-3 text-4xl font-semibold leading-[1.06] tracking-tight sm:text-6xl">
            Check if a picture, voice or text was made by AI.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-[var(--muted-foreground)]">
            Everything made through Agent ID carries{" "}
            <strong className="font-semibold text-[var(--foreground)]">a hidden mark</strong>. Drop
            a file or paste text to see which AI made it, and who answers for it.
          </p>
        </div>
        <Checker />
      </section>

      <Band tinted label="How the mark works">
        <h2 className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">
          Detectors guess. A mark knows.
        </h2>
        <p className="mt-5 max-w-3xl text-lg text-[var(--muted-foreground)]">
          AI detectors look at finished work and guess, and they flag real people. Agent ID puts a
          mark in when the work is made, so a check finds it, or doesn't.
        </p>
        <ol className="mt-10 grid gap-8 md:grid-cols-3">
          {[
            [
              "Marked when it's made.",
              "Pictures and sound get a mark you can't see or hear. Text gets an invisible one. Code is left as it is.",
            ],
            [
              "Kept as a signed record.",
              "Which agent made it, what kind of AI, when, and who answers for it. Text and code are also kept as a fingerprint.",
            ],
            [
              "Checked by anyone.",
              "Here, or with the API. Your file isn't kept: only the result of the check.",
            ],
          ].map(([title, line], index) => (
            <li key={title}>
              <span className="grid h-9 w-9 place-items-center rounded-full bg-[var(--aid-ink)] text-sm font-semibold text-[var(--background)]">
                {index + 1}
              </span>
              <p className="mt-4 text-lg font-semibold">{title}</p>
              <p className="mt-2 text-[var(--muted-foreground)]">{line}</p>
            </li>
          ))}
        </ol>
      </Band>

      <Band label="Mark your agents' work">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-16">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight">
              Make your agents' work traceable.
            </h2>
            <p className="mt-4 text-[var(--muted-foreground)]">
              Give your agents an Agent ID, and what they send through it is marked: email, texts,
              attachments, pictures and sound. Nobody can pass it off as made by a person.
            </p>
            <StartRow className="mt-8" />
          </div>
          <Questions
            items={[
              [
                "No mark found. Did a person make it?",
                "Not necessarily. Only work made through Agent ID, or by a model maker who marks through it, carries a mark.",
              ],
              [
                "Can the mark be removed?",
                "A picture's mark survives saving as JPEG, resizing, brightness and blur. A sound's survives MP3, volume and noise, from about 10 seconds. Cropping or turning a picture, or speeding up a sound, removes it, and so can someone determined. Text marks are easy to strip, so text is also matched by its fingerprint.",
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
        </div>
      </Band>

      <Band tinted label="Pricing">
        <div className="mx-auto max-w-xl">
          <Offer />
        </div>
      </Band>

      <Band label="Other reasons">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          Also with Agent ID
        </h2>
        <div className="mt-4">
          <NeedList current="check" />
        </div>
      </Band>
    </SitePage>
  );
}

type Mode = "file" | "text";

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
    if (ready && !check.isPending) check.mutate();
  };

  return (
    <form onSubmit={submit} className="aid-card grid gap-4 p-5 sm:p-6" aria-label="Check">
      <Segmented
        label="What to check"
        value={mode}
        onChange={(next) => {
          setMode(next);
          check.reset();
        }}
        options={[
          { value: "file", label: "A file" },
          { value: "text", label: "Text" },
        ]}
        className="justify-self-start"
      />
      {mode === "file" ? (
        <label
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={drop}
          className={cn(
            "grid min-h-48 cursor-pointer place-items-center rounded-xl border-2 border-dashed p-5 text-center transition-colors",
            dragging
              ? "border-[var(--aid-ink)] bg-[var(--accent)]"
              : "border-[var(--border)] hover:border-[var(--aid-ink)]",
          )}
        >
          <input
            type="file"
            accept="image/*,audio/*,.txt,.md"
            className="sr-only"
            onChange={(event) => choose(event.target.files?.[0])}
          />
          {file ? (
            <span className="grid justify-items-center gap-3">
              {preview && kind === "image" && (
                <img src={preview} alt="" className="max-h-40 rounded-lg object-contain" />
              )}
              {preview && kind === "audio" && <audio src={preview} controls className="w-64" />}
              <span className="max-w-full break-all text-sm font-medium">{file.name}</span>
              <span className="text-xs text-[var(--muted-foreground)]">Choose another</span>
            </span>
          ) : (
            <span className="grid justify-items-center gap-2">
              <FileUp className="h-7 w-7 text-[var(--muted-foreground)]" aria-hidden="true" />
              <span className="font-medium">Drop a picture or a sound file</span>
              <span className="text-xs text-[var(--muted-foreground)]">
                PNG, JPEG, WebP, WAV, MP3 and more. It stays on your computer: only a small copy is
                checked.
              </span>
            </span>
          )}
        </label>
      ) : (
        <Textarea
          aria-label="Text to check"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            check.reset();
          }}
          rows={8}
          maxLength={100_000}
          placeholder="Paste an email, a message, an essay or code."
        />
      )}
      <Button type="submit" size="lg" disabled={!ready || check.isPending}>
        {check.isPending ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <SearchCheck aria-hidden="true" />
        )}
        Check
      </Button>
      <div aria-live="polite">
        {check.isError && <Notice tone="danger">{errorMessage(check.error)}</Notice>}
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

function Result({ result }: { result: TraceCheck }) {
  if (!result.found) {
    return (
      <Notice>
        <span className="font-medium">
          No Agent ID mark found in this {KIND_WORDS[result.kind] ?? "file"}.
        </span>{" "}
        That doesn't prove a person made it: only work made through Agent ID carries a mark.
      </Notice>
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
  return (
    <div className="grid gap-3 rounded-xl border border-[var(--border)] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-[var(--aid-ink)] px-2.5 py-0.5 text-xs font-semibold text-[var(--background)]">
          Made by AI
        </span>
        <span className="text-xs text-[var(--muted-foreground)]">
          {result.match === "mark"
            ? "Agent ID mark found"
            : result.match === "exact"
              ? "The same file was made by an agent"
              : `Matches text an agent made${result.similarity ? ` (${Math.round(result.similarity * 100)}% the same)` : ""}`}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <AgentAvatar mascot={trace.agent.mascot} size="md" />
        <div className="min-w-0">
          <p className="truncate font-medium">{trace.agent.name}</p>
          <p className="truncate text-xs text-[var(--muted-foreground)]">
            {[kind ?? "AI agent", via].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-3 border-t border-[var(--border)] pt-3 text-xs">
        <div>
          <dt className="text-[var(--muted-foreground)]">Answers for it</dt>
          <dd className="mt-0.5 flex items-center gap-1 font-medium">
            {trace.owner.verified && (
              <BadgeCheck className="h-3.5 w-3.5 text-[var(--aid-success)]" aria-hidden="true" />
            )}
            {trace.owner.name ??
              (trace.owner.verified
                ? trace.owner.type === "business"
                  ? "A verified business"
                  : "A verified person"
                : "A person, not verified yet")}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted-foreground)]">Made</dt>
          <dd className="mt-0.5 font-medium">{formatDate(trace.createdAt)}</dd>
        </div>
      </dl>
      {trace.agent.status !== "active" && (
        <p className="text-xs text-[var(--muted-foreground)]">
          This agent has since been {trace.agent.status === "revoked" ? "revoked" : "paused"} by its
          owner.
        </p>
      )}
    </div>
  );
}
