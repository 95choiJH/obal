"use strict";
const fs = require("fs");
const path = require("path");

const root = __dirname;
const sourceRoot = path.join(root, "admin");
const outputRoot = path.join(root, "netlify-admin");
const version = "1.2.2";
const files = [
  "index.html",
  "app.js",
  "config.js",
  path.join("vendor", "supabase-2.45.4.min.js"),
];

fs.rmSync(outputRoot, { recursive: true, force: true });
for (const relative of files) {
  const source = path.join(sourceRoot, relative);
  const target = path.join(outputRoot, relative);
  if (!fs.existsSync(source)) throw new Error("Missing admin deploy file: " + relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

const headers = [
  "/*",
  "  X-Frame-Options: DENY",
  "  X-Content-Type-Options: nosniff",
  "  Referrer-Policy: no-referrer",
  "  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()",
  "  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self' https://ggebdrlvzrgoyumlrnxe.supabase.co wss://ggebdrlvzrgoyumlrnxe.supabase.co; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "",
].join("\n");
fs.writeFileSync(path.join(outputRoot, "_headers"), headers, "utf8");

const deployInfo = {
  name: "obaengal-admin",
  source: "admin",
  version,
  generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  files: files.map((file) => file.split(path.sep).join("/")),
};
fs.writeFileSync(path.join(outputRoot, "deploy-info.json"), JSON.stringify(deployInfo, null, 2) + "\n", "utf8");
console.log("Admin deploy folder created: " + outputRoot);
