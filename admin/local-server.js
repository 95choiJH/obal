const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
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
