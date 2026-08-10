const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 8003);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function resolveRequest(urlPath) {
  let pathname = decodeURIComponent(new URL(urlPath, `http://127.0.0.1:${port}`).pathname);
  if (pathname === "/") pathname = "/mobile/";
  if (pathname.endsWith("/")) pathname += "index.html";
  const file = path.resolve(root, pathname.replace(/^\/+/, ""));
  if (!file.startsWith(root)) return null;
  return file;
}

http.createServer((req, res) => {
  const file = resolveRequest(req.url || "/");
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  res.writeHead(200, { "Content-Type": types[path.extname(file).toLowerCase()] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1", () => {
  console.log(`오뱅알 모바일 PWA: http://127.0.0.1:${port}/mobile/`);
});
