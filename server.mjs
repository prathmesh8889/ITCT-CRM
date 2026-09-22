import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("./dist", import.meta.url)));
const PORT = Number(process.env.PORT || 8080);
const production = process.env.NODE_ENV === "production";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function securityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; " +
    "connect-src 'self' https:; object-src 'none'; base-uri 'self'; form-action 'self'; " +
    "frame-ancestors 'none'; worker-src 'self' blob:; upgrade-insecure-requests"
  );
  if (production) res.setHeader("Strict-Transport-Security", "max-age=31536000");
}

async function resolveFile(pathname) {
  const clean = decodeURIComponent(pathname).replace(/\\/g, "/");
  const requested = clean === "/" ? "/index.html" : clean;
  const candidate = resolve(ROOT, "." + requested);
  if (candidate !== ROOT && !candidate.startsWith(ROOT + sep)) return null;
  try {
    const info = await stat(candidate);
    if (info.isFile()) return candidate;
  } catch { /* SPA fallback */ }
  return resolve(ROOT, "index.html");
}

const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  if (!["GET", "HEAD"].includes(req.method || "")) {
    res.writeHead(405, { Allow: "GET, HEAD" });
    return res.end();
  }

  let url;
  try { url = new URL(req.url || "/", "http://localhost"); }
  catch { res.writeHead(400); return res.end("Bad Request"); }

  const file = await resolveFile(url.pathname);
  if (!file) { res.writeHead(403); return res.end("Forbidden"); }

  try {
    const body = await readFile(file);
    const ext = extname(file).toLowerCase();
    res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
    if (url.pathname.startsWith("/assets/")) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    } else {
      res.setHeader("Cache-Control", "no-store");
    }
    res.writeHead(200);
    if (req.method === "HEAD") return res.end();
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[frontend] ITCT CRM listening on 0.0.0.0:${PORT}`);
});
