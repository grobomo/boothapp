#!/usr/bin/env node
/**
 * Quick endpoint smoke test for the presenter server.
 * Starts the server, hits each endpoint, verifies response, then exits.
 */

const http = require("http");
const { spawn } = require("child_process");
const path = require("path");

const PORT = 3099; // Use a non-default port to avoid conflicts
let pass = 0;
let fail = 0;

function get(urlPath) {
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${PORT}${urlPath}`, (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      })
      .on("error", reject);
  });
}

function check(label, ok) {
  if (ok) {
    pass++;
    console.log(`[PASS] ${label}`);
  } else {
    fail++;
    console.log(`[FAIL] ${label}`);
  }
}

async function run() {
  // Start server
  const server = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: "pipe",
  });

  // Wait for server to be ready
  await new Promise((resolve) => {
    server.stdout.on("data", (d) => {
      if (d.toString().includes("listening")) resolve();
    });
    setTimeout(resolve, 3000); // fallback timeout
  });

  try {
    // GET / -> index.html
    const home = await get("/");
    check("GET / returns 200", home.status === 200);
    check("GET / returns HTML", home.body.includes("<html"));

    // GET /sessions.html
    const sessions = await get("/sessions.html");
    check("GET /sessions.html returns 200", sessions.status === 200);

    // GET /timeline.html
    const timeline = await get("/timeline.html");
    check("GET /timeline.html returns 200", timeline.status === 200);

    // GET /api/health
    const health = await get("/api/health");
    check("GET /api/health returns 200", health.status === 200);
    const hj = JSON.parse(health.body);
    check("health.status is ok", hj.status === "ok");
    check("health has uptime", typeof hj.uptime === "number");

    // GET /api/config
    const config = await get("/api/config");
    check("GET /api/config returns 200", config.status === 200);
    const cj = JSON.parse(config.body);
    check("config has s3_bucket", typeof cj.s3_bucket === "string");
    check("config has aws_region", typeof cj.aws_region === "string");
    check("config.port matches", cj.port === PORT);

    // GET /api/pages
    const pages = await get("/api/pages");
    check("GET /api/pages returns 200", pages.status === 200);
    const pj = JSON.parse(pages.body);
    check("pages lists html files", pj.pages.length >= 3);
  } finally {
    server.kill();
  }

  console.log(`\nResults: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
