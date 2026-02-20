import { Elysia } from "elysia";
import { socialAgentRoutes } from "./routes/social-agent";
import { strategistInlinks } from "./routes/strategist-inlinks";
import { trendsMasterRoutes } from "./routes/trends-master";
import { envValid } from "../envSchema";

import { cors } from "@elysiajs/cors";

const frontendDist = new URL("../../front-end/dist/", import.meta.url);
const indexHtml = Bun.file(new URL("index.html", frontendDist));

const app = new Elysia()
  .use(
    cors({
      origin: [
        envValid.CORS_ORIGIN ?? "http://localhost:5173",
        "http://localhost:5174",
      ],
    }),
  )
  .onError(({ code, error }) => {
    if (code === "VALIDATION") {
      return new Response(
        JSON.stringify({ success: false, error: "VALIDATION", details: error }),
        { status: 422, headers: { "Content-Type": "application/json" } },
      );
    }

    if (code === "PARSE") {
      return new Response(
        JSON.stringify({ success: false, error: "PARSE", details: error }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    console.error("[Server] Internal error:", error);
    return new Response(
      JSON.stringify({ success: false, error: "INTERNAL", details: error }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  })
  .use(socialAgentRoutes)
  .use(strategistInlinks)
  .use(trendsMasterRoutes)
  .get("/", () => indexHtml)
  .get("/assets/*", async ({ request }) => {
    const { pathname } = new URL(request.url);
    const path = pathname.replace(/^\/+/, "");
    const file = Bun.file(new URL(path, frontendDist));
    if (await file.exists()) {
      return new Response(file, {
        headers: {
          "Content-Type": file.type || "application/octet-stream",
        },
      });
    }
    return new Response("Not found", { status: 404 });
  })
  .get("/*", () => indexHtml);

app.listen(3333, () => {
  console.log("Server started on http://localhost:3333");
});
