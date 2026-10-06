import { createFileRoute } from "@tanstack/react-router";
import GoogleStart from "../components/auth/GoogleStart";
// Keep the named branded bridge entry compatible with desktop requests.
export const Route = createFileRoute("/auth/bridge")({ component: GoogleStart });
