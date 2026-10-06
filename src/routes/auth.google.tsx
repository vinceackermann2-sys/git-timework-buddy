import { createFileRoute } from "@tanstack/react-router";
import GoogleStart from "../components/auth/GoogleStart";
export const Route = createFileRoute("/auth/google")({ component: GoogleStart });
