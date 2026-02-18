import { Elysia } from "elysia";
import { socialAgentRoutes } from "./routes/social-agent";
import { strategistInlinks } from "./routes/strategist-inlinks";
import { envValid } from "../envSchema";

import { cors } from "@elysiajs/cors";

const app = new Elysia()
  .use(
    cors({
      origin: [
        envValid.CORS_ORIGIN ?? "http://localhost:5173",
        "http://localhost:5174",
      ],
    }),
  )
  .use(socialAgentRoutes)
  .use(strategistInlinks);

app.listen(3333, () => {
  console.log("Server started on http://localhost:3333");
});
