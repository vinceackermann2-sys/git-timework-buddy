import { useEffect, useState } from "react";

// highlight.js is a large part of the interface, so it loads on first use.
// Until it's there, code shows as plain text in the same box.
let hljs = null, loading = null;
export function loadHighlighter() {
  loading ||= import("highlight.js/lib/common").then(module => { hljs = module.default; return hljs; });
  return loading;
}

// highlight.js once loaded (null until then); `wanted` false doesn't load it.
export function useHighlighter(wanted = true) {
  const [value, setValue] = useState(hljs);
  useEffect(() => {
    if (!wanted || value) return undefined;
    let live = true;
    void loadHighlighter().then(loaded => { if (live) setValue(loaded); });
    return () => { live = false; };
  }, [wanted, value]);
  return value || hljs;
}
