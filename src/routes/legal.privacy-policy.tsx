import { createFileRoute } from "@tanstack/react-router";
import html from "../../timewarp-site/dist/legal/privacy-policy.html?raw";
import { staticPage } from "../lib/static-page";

export const Route = createFileRoute("/legal/privacy-policy")({ server: staticPage(html) });
