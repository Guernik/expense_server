import { existsSync } from "node:fs";
import { relative } from "node:path";
import { createApp, type Runtime } from "@denarii/api";
import { serveStatic } from "@hono/node-server/serve-static";

/**
 * The shared Hono app, plus the built SPA from `webRoot` when it exists: static files, and
 * `index.html` for any other non-API GET so client-side routes load.
 */
export function createNodeApp(runtime: Runtime, webRoot: string) {
  const app = createApp(() => runtime);
  if (!existsSync(webRoot)) return app;
  // serveStatic resolves `root` against the working directory.
  const root = relative(process.cwd(), webRoot) || ".";
  app.use("*", serveStatic({ root }));
  app.get("*", async (c, next) => {
    if (c.req.path.startsWith("/api/")) return next();
    return serveStatic({ root, path: "index.html" })(c, next);
  });
  return app;
}
