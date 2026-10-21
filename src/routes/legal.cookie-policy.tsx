import { createFileRoute } from "@tanstack/react-router";
import html from "../../timewarp-site/dist/legal/cookie-policy.html?raw";
import { staticPage } from "../lib/static-page";

export const Route = createFileRoute("/legal/cookie-policy")({ server: staticPage(html) });
