import { createFileRoute } from "@tanstack/react-router";
import html from "../../timewarp-site/dist/legal/terms-of-service.html?raw";
import { staticPage } from "../lib/static-page";

export const Route = createFileRoute("/legal/terms-of-service")({ server: staticPage(html) });
