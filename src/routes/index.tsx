import { createFileRoute } from "@tanstack/react-router";
import landingHtml from "../../timewarp-site/dist/index.html?raw";

// Serve the existing website unchanged, including its own styles and scripts.
export const Route = createFileRoute("/")({
  server: {
    handlers: {
      GET: () =>
        new Response(landingHtml, {
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
    },
  },
});
