import { createFileRoute } from "@tanstack/react-router";
import landingHtml from "../../timewarp-site/dist/index.html?raw";
import { staticPage } from "../lib/static-page";

export const Route = createFileRoute("/")({ server: staticPage(landingHtml) });
