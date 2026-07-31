import http from "http";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { execFile } from "child_process";
import { promisify } from "util";
import moment from "moment";

const PORT = Number(process.env.PORT) || 3200;
const repoRoot = process.cwd();
const publicDir = path.join(repoRoot, "public");
const dataFile = path.join(repoRoot, "data.json");
const execFileAsync = promisify(execFile);

export function resolveGitHubIdentity(user = {}, env = process.env) {
  const login = user.login || env.GITHUB_LOGIN || "github-user";
  const email = user.email || env.GITHUB_EMAIL || `${login}@users.noreply.github.com`;
  const accessToken = user.accessToken || env.GITHUB_TOKEN || null;
  const repoOwner = user.repoOwner || env.REPO_OWNER || login;
  const repoName = user.repoName || env.REPO_NAME || "APP_Commit";

  return { login, email, accessToken, repoOwner, repoName };
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(JSON.stringify(payload));
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return index === -1 ? [part, ""] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function decodeSessionCookie(req) {
  const cookieValue = parseCookies(req).gh_session;
  if (!cookieValue) return null;

  try {
    return JSON.parse(Buffer.from(cookieValue, "base64url").toString("utf8"));
  } catch (error) {
    return null;
  }
}

function setSessionCookie(res, user) {
  const session = Buffer.from(JSON.stringify(user)).toString("base64url");
  res.setHeader("Set-Cookie", `gh_session=${session}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      "User-Agent": "APP_Commit",
      ...(init.headers || {}),
    },
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    const message = typeof payload === "string" ? payload : payload.message || "GitHub request failed.";
    throw new Error(message);
  }

  return payload;
}

async function getCurrentUser(req) {
  const sessionUser = decodeSessionCookie(req);
  if (sessionUser) {
    return resolveGitHubIdentity(sessionUser, process.env);
  }

  if (process.env.GITHUB_LOGIN) {
    return resolveGitHubIdentity({ login: process.env.GITHUB_LOGIN, email: process.env.GITHUB_EMAIL }, process.env);
  }

  return null;
}

async function getGitHubUserFromToken(accessToken) {
  const user = await fetchJson("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  let email = user.email || null;
  if (!email) {
    const emailList = await fetchJson("https://api.github.com/user/emails", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const primary = Array.isArray(emailList)
      ? emailList.find((entry) => entry.primary && entry.verified) || emailList.find((entry) => entry.verified)
      : null;
    email = primary ? primary.email : `${user.login}@users.noreply.github.com`;
  }

  return { login: user.login, email, accessToken };
}

async function exchangeCodeForToken(code) {
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID || "",
    client_secret: process.env.GITHUB_CLIENT_SECRET || "",
    code,
  });

  if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
    throw new Error("GitHub OAuth is not configured. Add GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET to the environment.");
  }

  const tokenResponse = await fetchJson(`https://github.com/login/oauth/access_token?${params.toString()}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
    },
  });

  if (!tokenResponse.access_token) {
    throw new Error("GitHub OAuth token exchange did not return an access token.");
  }

  return tokenResponse.access_token;
}

async function serveFile(res, filePath) {
  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
    };
    res.writeHead(200, { "Content-Type": types[ext] || "text/plain; charset=utf-8" });
    res.end(content);
  } catch (error) {
    sendJson(res, 404, { success: false, message: "File not found" });
  }
}

function getDayName(date) {
  const safeDate = moment.isMoment(date) ? date : moment(date);
  return safeDate.format("dddd").toLowerCase();
}

export function isDateSelected(date, payload) {
  const safeDate = moment.isMoment(date) ? date : moment(date);
  const mode = payload.filterMode || "all";
  const selectedDays = Array.isArray(payload.selectedDays) ? payload.selectedDays.map((d) => d.toLowerCase()) : [];
  const dayName = getDayName(safeDate);
  const dayNumber = safeDate.date();

  if (mode === "odd") return dayNumber % 2 === 1;
  if (mode === "even") return dayNumber % 2 === 0;
  if (mode === "weekends") return ["saturday", "sunday"].includes(dayName);
  if (mode === "weekdays") return !["saturday", "sunday"].includes(dayName);
  if (mode === "selected") return selectedDays.includes(dayName);
  return true;
}

export function resolveDailyCount(date, payload) {
  const safeDate = moment.isMoment(date) ? date : moment(date);
  const weekdayMap = payload.weekdayCounts || {};
  const weekdayKey = getDayName(safeDate);
  const baseCount = Number(payload.dailyCount || 1);

  if (weekdayMap[weekdayKey] !== undefined && Number(weekdayMap[weekdayKey]) >= 0) {
    return Number(weekdayMap[weekdayKey]);
  }

  if (payload.randomize) {
    const max = Number(payload.maxPerDay || baseCount || 1);
    const min = Math.min(1, max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  return baseCount;
}

export function buildDateWindow(startDate, endDate) {
  const start = moment(startDate, "YYYY-MM-DD");
  const end = moment(endDate, "YYYY-MM-DD");

  if (!start.isValid() || !end.isValid()) {
    throw new Error("Please choose a valid start date and end date.");
  }

  if (end.isBefore(start)) {
    throw new Error("The end date must be after the start date.");
  }

  const dates = [];
  let current = start.clone();
  while (current.isSameOrBefore(end)) {
    dates.push(current.clone());
    current.add(1, "day");
  }
  return dates;
}

function spreadTimesForDay(date, count) {
  const start = moment(date).hour(9).minute(0).second(0).millisecond(0);
  const end = moment(date).hour(20).minute(0).second(0).millisecond(0);

  if (count <= 1) return [start.clone()];

  const diffMinutes = end.diff(start, "minutes");
  const step = diffMinutes / (count - 1);
  const times = [];

  for (let i = 0; i < count; i += 1) {
    times.push(start.clone().add(Math.round(step * i), "minutes"));
  }

  return times;
}

async function generateCommits(payload, req) {
  const account = await getCurrentUser(req);
  if (!account) {
    throw new Error("GitHub sign-in is required before generating commits.");
  }

  const startDate = payload.startDate;
  const endDate = payload.endDate;
  const dailyCount = Number(payload.dailyCount || 1);
  const pushToRemote = Boolean(payload.pushToRemote);
  const branchName = (payload.branch || "main").toString().trim() || "main";

  if (!startDate || !endDate) {
    throw new Error("Please choose a start date and an end date.");
  }

  if (!Number.isInteger(dailyCount) || dailyCount < 1) {
    throw new Error("The daily commit count must be a whole number greater than zero.");
  }

  const selectedDates = buildDateWindow(startDate, endDate).filter((date) => isDateSelected(date, payload));
  if (!selectedDates.length) {
    throw new Error("No days matched your selection. Try another date range or filter.");
  }

  const currentBranch = (await execFileAsync("git", ["branch", "--show-current"], { cwd: repoRoot })).stdout.trim() || "main";
  const targetBranch = branchName || currentBranch;

  const created = [];
  let totalCommitCount = 0;

  for (const selectedDate of selectedDates) {
    const countForDay = resolveDailyCount(selectedDate, payload);
    const times = spreadTimesForDay(selectedDate, countForDay);

    for (const commitTime of times) {
      const isoDate = commitTime.toISOString();
      const message = `Auto commit ${created.length + 1} — ${commitTime.format("YYYY-MM-DD HH:mm")}`;
      const payloadData = {
        commitNumber: created.length + 1,
        date: commitTime.format("YYYY-MM-DD"),
        time: commitTime.format("HH:mm"),
        branch: targetBranch,
      };

      await fs.writeFile(dataFile, `${JSON.stringify(payloadData, null, 2)}\n`);
      await execFileAsync("git", ["add", "data.json"], { cwd: repoRoot });

      const env = {
        ...process.env,
        GIT_AUTHOR_NAME: account.login,
        GIT_AUTHOR_EMAIL: account.email,
        GIT_AUTHOR_DATE: isoDate,
        GIT_COMMITTER_NAME: account.login,
        GIT_COMMITTER_EMAIL: account.email,
        GIT_COMMITTER_DATE: isoDate,
      };

      try {
        await execFileAsync(
          "git",
          [
            "-c",
            `user.name=${account.login}`,
            "-c",
            `user.email=${account.email}`,
            "commit",
            "-m",
            message,
            "--date",
            commitTime.format(),
            "--allow-empty",
            "--no-gpg-sign",
          ],
          { cwd: repoRoot, env }
        );
      } catch (error) {
        if (!String(error.message).includes("nothing to commit")) {
          throw error;
        }
      }

      created.push({
        number: created.length + 1,
        date: commitTime.format("YYYY-MM-DD"),
        time: commitTime.format("HH:mm"),
        message,
      });
      totalCommitCount += 1;
    }
  }

  let pushResult = {
    enabled: false,
    status: "not_attempted",
    message: "Push was not requested.",
  };

  if (pushToRemote) {
    pushResult.enabled = true;

    try {
      const repoOwner = (payload.repoOwner || account.repoOwner || process.env.REPO_OWNER || account.login).trim();
      const repoName = (payload.repoName || account.repoName || process.env.REPO_NAME || "APP_Commit").trim();
      const token = account.accessToken || process.env.GITHUB_TOKEN;

      if (!token) {
        throw new Error("No GitHub access token is available for this user. Configure GITHUB_TOKEN or complete the GitHub OAuth login flow.");
      }

      await execFileAsync("git", ["remote", "set-url", "origin", `https://x-access-token:${token}@github.com/${repoOwner}/${repoName}.git`], { cwd: repoRoot });
      await execFileAsync("git", ["push", "--set-upstream", "origin", `HEAD:${targetBranch}`], { cwd: repoRoot });
      pushResult.status = "success";
      pushResult.message = `Pushed successfully to ${repoOwner}/${repoName}:${targetBranch}`;
    } catch (error) {
      pushResult.status = "failed";
      pushResult.message = error.message || "GitHub push failed.";
    }
  }

  return {
    success: true,
    branch: targetBranch,
    startDate,
    endDate,
    selectedDays: selectedDates.length,
    commitsCreated: totalCommitCount,
    pushToRemote,
    pushResult,
    created,
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "OPTIONS") {
      return sendJson(res, 200, { success: true });
    }

    if (req.method === "GET" && url.pathname === "/") {
      return await serveFile(res, path.join(publicDir, "index.html"));
    }

    if (req.method === "GET" && url.pathname === "/auth/github/login") {
      const clientId = process.env.GITHUB_CLIENT_ID;
      if (!clientId) {
        return sendJson(res, 500, {
          success: false,
          message: "GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.",
        });
      }

      const redirectUri = encodeURIComponent(process.env.APP_BASE_URL || "http://localhost:3200/auth/github/callback");
      const target = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=read:user,user:email,repo`;
      res.writeHead(302, { Location: target });
      return res.end();
    }

    if (req.method === "GET" && url.pathname === "/auth/github/callback") {
      try {
        const code = url.searchParams.get("code");
        if (!code) {
          throw new Error("GitHub authorization code was not received.");
        }

        const accessToken = await exchangeCodeForToken(code);
        const user = await getGitHubUserFromToken(accessToken);
        setSessionCookie(res, user);
        res.writeHead(302, { Location: "/" });
        return res.end();
      } catch (error) {
        return sendJson(res, 400, { success: false, message: error.message || "GitHub login failed." });
      }
    }

    if (req.method === "GET" && url.pathname === "/auth/github") {
      const user = await getCurrentUser(req);
      if (!user) {
        return sendJson(res, 401, { success: false, message: "GitHub sign-in is required." });
      }
      return sendJson(res, 200, { success: true, user });
    }

    if (req.method === "GET" && url.pathname === "/auth/logout") {
      res.setHeader("Set-Cookie", "gh_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
      return sendJson(res, 200, { success: true, message: "Signed out." });
    }

    if (req.method === "GET" && url.pathname === "/styles.css") {
      return await serveFile(res, path.join(publicDir, "styles.css"));
    }

    if (req.method === "GET" && url.pathname === "/script.js") {
      return await serveFile(res, path.join(publicDir, "script.js"));
    }

    if (req.method === "POST" && url.pathname === "/generate") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });

      req.on("end", async () => {
        try {
          const data = JSON.parse(body || "{}");
          const result = await generateCommits(data, req);
          sendJson(res, 200, result);
        } catch (error) {
          sendJson(res, 400, {
            success: false,
            message: error.message || "Failed to generate the commit schedule.",
          });
        }
      });

      return;
    }

    sendJson(res, 404, { success: false, message: "Route not found" });
  } catch (error) {
    sendJson(res, 500, {
      success: false,
      message: error.message || "Unexpected server error",
    });
  }
});

function startServer(port) {
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE") {
      const fallbackPort = port + 1;
      console.log(`Port ${port} is busy. Retrying on ${fallbackPort}...`);
      startServer(fallbackPort);
      return;
    }

    throw error;
  });

  server.listen(port, () => {
    console.log(`Web app is running at http://localhost:${port}`);
  });
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMainModule) {
  startServer(PORT);
}

