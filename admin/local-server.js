const http = require("http");
const fs = require("fs");
const path = require("path");
const https = require("https");

const root = __dirname;

function readAdminConfig() {
  const source = fs.readFileSync(path.join(root, "config.js"), "utf8");
  const pick = (name) => {
    const match = source.match(new RegExp(name + "\\s*:\\s*([\"'`])([^\"'`]+)\\1"));
    return match ? match[2] : "";
  };
  return {
    supabaseUrl: pick("supabaseUrl").replace(/\/+$/, ""),
    supabaseKey: pick("supabaseKey"),
  };
}

function proxyChzzkSearch(url, res) {
  const cfg = readAdminConfig();
  const keyword = (url.searchParams.get("keyword") || "").trim();
  const target = new URL(cfg.supabaseUrl + "/functions/v1/chzzk-search?keyword=" + encodeURIComponent(keyword));
  const upstream = https.request(target, {
    method: "GET",
    headers: {
      apikey: cfg.supabaseKey,
      Authorization: "Bearer " + cfg.supabaseKey,
    },
  }, (upstreamRes) => {
    const chunks = [];
    upstreamRes.on("data", (chunk) => chunks.push(chunk));
    upstreamRes.on("end", () => {
      res.writeHead(upstreamRes.statusCode || 502, {
        "Content-Type": upstreamRes.headers["content-type"] || "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(Buffer.concat(chunks));
    });
  });
  upstream.on("error", (err) => {
    res.writeHead(502, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ error: String((err && err.message) || err) }));
  });
  upstream.end();
}
const port = Number(process.env.PORT || 8001);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

http
  .createServer((req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
      if (url.pathname === "/functions/v1/chzzk-search") {
        proxyChzzkSearch(url, res);
        return;
      }

      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
      const file = path.resolve(root, rel);

      if (file !== root && !file.startsWith(root + path.sep)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }

      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        res.writeHead(200, {
          "Content-Type": types[path.extname(file).toLowerCase()] || "application/octet-stream",
          "Cache-Control": "no-store",
        });
        res.end(data);
      });
    } catch (err) {
      res.writeHead(500);
      res.end(String((err && err.message) || err));
    }
  })
  .listen(port, "127.0.0.1", () => {
    console.log(`admin local server: http://127.0.0.1:${port}/`);
  });
