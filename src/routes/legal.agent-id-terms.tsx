import { createFileRoute } from "@tanstack/react-router";
import html from "../../timewarp-site/dist/legal/agent-id-terms.html?raw";
import { staticPage } from "../lib/static-page";

export const Route = createFileRoute("/legal/agent-id-terms")({ server: staticPage(html) });
