import http from "http";
import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import moment from "moment";

const PORT = Number(process.env.PORT) || 3000;
const repoRoot = process.cwd();
const publicDir = path.join(repoRoot, "public");
const dataFile = path.join(repoRoot, "data.json");
const execFileAsync = promisify(execFile);

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(payload));
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
  return date.format("dddd").toLowerCase();
}

function isDateSelected(date, payload) {
  const mode = payload.filterMode || "all";
  const selectedDays = Array.isArray(payload.selectedDays) ? payload.selectedDays.map((d) => d.toLowerCase()) : [];
  const dayName = getDayName(date);
  const dayNumber = date.date();

  if (mode === "odd") return dayNumber % 2 === 1;
  if (mode === "even") return dayNumber % 2 === 0;
  if (mode === "weekends") return ["saturday", "sunday"].includes(dayName);
  if (mode === "weekdays") return !["saturday", "sunday"].includes(dayName);
  if (mode === "selected") return selectedDays.includes(dayName);
  return true;
}

function resolveDailyCount(date, payload) {
  const weekdayMap = payload.weekdayCounts || {};
  const weekdayKey = getDayName(date);
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

function buildDateWindow(startDate, endDate) {
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

async function ensureGitIdentity() {
  try {
    await execFileAsync("git", ["config", "user.name"], { cwd: repoRoot });
    await execFileAsync("git", ["config", "user.email"], { cwd: repoRoot });
  } catch {
    await execFileAsync("git", ["config", "user.name", "Auto Commit Bot"], { cwd: repoRoot });
    await execFileAsync("git", ["config", "user.email", "auto@commit.local"], { cwd: repoRoot });
  }
}

async function ensureGitHubAuth() {
  try {
    const remoteUrl = (await execFileAsync("git", ["remote", "get-url", "origin"], { cwd: repoRoot })).stdout.trim();
    if (!remoteUrl.includes("github.com")) {
      throw new Error("The repo remote is not a GitHub URL.");
    }

    await execFileAsync("gh", ["auth", "status"], { cwd: repoRoot });
    await execFileAsync("gh", ["auth", "setup-git"], { cwd: repoRoot });

    const remoteCheck = await execFileAsync("git", ["ls-remote", "--heads", "origin"], { cwd: repoRoot });
    if (!remoteCheck.stdout) {
      throw new Error("GitHub remote is reachable but does not expose any branch metadata.");
    }
  } catch (error) {
    const message = error && error.message ? error.message : "Unknown GitHub auth error";
    throw new Error(
      `GitHub authentication or remote access is not valid for this repository. ${message}. Run: gh auth login -h github.com -w, then gh auth setup-git, and confirm the remote is writable by your account.`
    );
  }
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

async function generateCommits(payload) {
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

  await ensureGitIdentity();

  const created = [];
  let totalCommitCount = 0;

  for (const selectedDate of selectedDates) {
    const countForDay = resolveDailyCount(selectedDate, payload);
    const times = spreadTimesForDay(selectedDate, countForDay);

    for (let i = 0; i < times.length; i += 1) {
      const commitTime = times[i];
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
        GIT_AUTHOR_NAME: "Auto Commit Bot",
        GIT_AUTHOR_EMAIL: "auto@commit.local",
        GIT_AUTHOR_DATE: isoDate,
        GIT_COMMITTERMINAL_NAME: "Auto Commit Bot",
        GIT_COMMITTERMINAL_EMAIL: "auto@commit.local",
        GIT_COMMITTERMINAL_DATE: isoDate,
      };

      await execFileAsync(
        "git",
        [
          "-c",
          "user.name=Auto Commit Bot",
          "-c",
          "user.email=auto@commit.local",
          "commit",
          "-m",
          message,
          "--date",
          commitTime.format(),
          "--allow-empty",
          "--no-gpg-sign",
        ],
        {
          cwd: repoRoot,
          env,
        }
      );

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
      await ensureGitHubAuth();
      await execFileAsync("git", ["push", "--set-upstream", "origin", `HEAD:${targetBranch}`], { cwd: repoRoot });
      pushResult.status = "success";
      pushResult.message = `Pushed successfully to origin/${targetBranch}`;
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

    if (req.method === "GET" && url.pathname === "/") {
      return await serveFile(res, path.join(publicDir, "index.html"));
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
          const result = await generateCommits(data);
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

startServer(PORT);