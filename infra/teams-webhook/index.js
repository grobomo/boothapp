const crypto = require("crypto");
const https = require("https");

exports.handler = async (event) => {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_REPO = process.env.GITHUB_REPO || "altarr/boothapp";
  const TEAMS_SECRET = process.env.TEAMS_WEBHOOK_SECRET;

  const headers = {
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Invalid JSON body" }),
    };
  }

  // Validate Teams HMAC signature
  if (TEAMS_SECRET) {
    const authorization = event.headers["Authorization"] || event.headers["authorization"] || "";
    const token = authorization.replace(/^HMAC\s+/i, "");
    const expectedHmac = crypto
      .createHmac("sha256", Buffer.from(TEAMS_SECRET, "base64"))
      .update(event.body)
      .digest("base64");

    if (token !== expectedHmac) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: "Invalid HMAC signature" }),
      };
    }
  }

  // Parse message from Teams outgoing webhook
  // Teams sends: { "type": "message", "text": "<at>BotName</at> issue text here" }
  const rawText = (body.text || "").replace(/<at>.*?<\/at>\s*/gi, "").trim();

  if (!rawText) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        type: "message",
        text: "Usage: @BoothApp `title | description`\nExample: @BoothApp `Scanner not working | The badge scanner on booth 3 keeps timing out`",
      }),
    };
  }

  // Split on first pipe: "title | body" or just "title"
  const pipeIndex = rawText.indexOf("|");
  const title = pipeIndex > -1 ? rawText.slice(0, pipeIndex).trim() : rawText;
  const issueBody = pipeIndex > -1 ? rawText.slice(pipeIndex + 1).trim() : "";

  const sender = body.from && body.from.name ? body.from.name : "Teams user";
  const fullBody = [
    issueBody,
    "",
    "---",
    `Reported by ${sender} via Teams`,
  ]
    .filter((line) => line !== undefined)
    .join("\n");

  if (!GITHUB_TOKEN) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        type: "message",
        text: "GitHub token not configured. Ask your admin to set GITHUB_TOKEN.",
      }),
    };
  }

  try {
    const issue = await createGitHubIssue(title, fullBody, GITHUB_REPO, GITHUB_TOKEN);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        type: "message",
        text: `Issue [#${issue.number}](${issue.html_url}) created: **${issue.title}**`,
      }),
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        type: "message",
        text: `Failed to create issue: ${err.message}`,
      }),
    };
  }
};

function createGitHubIssue(title, body, ghRepo, ghToken) {
  return new Promise((resolve, reject) => {
    const [owner, repo] = ghRepo.split("/");
    const postData = JSON.stringify({ title, body, labels: ["from-teams"] });

    const options = {
      hostname: "api.github.com",
      port: 443,
      path: `/repos/${owner}/${repo}/issues`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ghToken}`,
        "User-Agent": "boothapp-teams-webhook",
        Accept: "application/vnd.github+json",
        "Content-Length": Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`GitHub API ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}
