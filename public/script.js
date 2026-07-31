const authPanel = document.getElementById("authPanel");
const schedulerPanel = document.getElementById("schedulerPanel");
const authStatus = document.getElementById("authStatus");
const userSummary = document.getElementById("userSummary");
const githubLoginBtn = document.getElementById("githubLoginBtn");
const signOutBtn = document.getElementById("signOutBtn");
const form = document.getElementById("commitForm");
const resultBox = document.getElementById("result");
const filterMode = document.getElementById("filterMode");
const selectedDaysPanel = document.getElementById("selectedDays");

if (filterMode) {
  filterMode.addEventListener("change", () => {
    selectedDaysPanel.classList.toggle("hidden", filterMode.value !== "selected");
  });
}

function showScheduler(user) {
  authPanel.classList.add("hidden");
  schedulerPanel.classList.remove("hidden");
  userSummary.textContent = `${user.login} · ${user.email}`;
}

async function checkGitHubAuth() {
  try {
    const response = await fetch("/auth/github");
    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.message || "GitHub sign-in is required.");
    }

    showScheduler(data.user);
    authStatus.textContent = "GitHub account connected.";
    authStatus.classList.add("success");
  } catch (error) {
    authStatus.textContent = error.message;
    authStatus.classList.remove("success");
    authPanel.classList.remove("hidden");
    schedulerPanel.classList.add("hidden");
  }
}

githubLoginBtn.addEventListener("click", () => {
  window.location.href = "/auth/github/login";
});

signOutBtn.addEventListener("click", async () => {
  await fetch("/auth/logout");
  authPanel.classList.remove("hidden");
  schedulerPanel.classList.add("hidden");
  authStatus.textContent = "Signed out. Connect a GitHub account to continue.";
  authStatus.classList.remove("success");
});

function formatETA(seconds) {
  const totalSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const secondsLeft = totalSeconds % 60;
  return `${minutes}m ${secondsLeft}s remaining`;
}

function estimateProgress(startAt, totalTasks, completedTasks) {
  if (completedTasks <= 0) return "Estimating...";
  const elapsedSeconds = (Date.now() - startAt) / 1000;
  const averagePerTask = elapsedSeconds / completedTasks;
  const remaining = Math.max(0, totalTasks - completedTasks);
  const eta = averagePerTask * remaining;
  return formatETA(eta);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const weekdayInputs = document.querySelectorAll("[data-weekday]");
  const weekdayCounts = {};
  weekdayInputs.forEach((input) => {
    weekdayCounts[input.dataset.weekday] = Number(input.value || 0);
  });

  const selectedDays = Array.from(document.querySelectorAll("#selectedDays input:checked")).map((input) => input.value);

  const payload = {
    startDate: document.getElementById("startDate").value,
    endDate: document.getElementById("endDate").value,
    dailyCount: Number(document.getElementById("dailyCount").value || 1),
    maxPerDay: Number(document.getElementById("maxPerDay").value || 1),
    randomize: document.getElementById("randomize").checked,
    filterMode: filterMode.value,
    selectedDays,
    weekdayCounts,
    branch: document.getElementById("branch").value,
    repoOwner: document.getElementById("repoOwner").value,
    repoName: document.getElementById("repoName").value,
    pushToRemote: document.getElementById("pushToRemote").checked,
  };

  const start = new Date(payload.startDate);
  const end = new Date(payload.endDate);
  const differenceDays = Math.max(1, Math.ceil((end - start) / 86400000) + 1);
  const estimatedTotal = Math.max(1, Math.round((payload.dailyCount || 1) * differenceDays));
  const startedAt = Date.now();
  let completed = 0;

  resultBox.classList.remove("hidden");
  resultBox.innerHTML = "Generating commits... <span class='progress'>0/0 · Estimating...</span>";

  const progressTimer = setInterval(() => {
    completed = Math.min(completed + 1, estimatedTotal);
    const eta = estimateProgress(startedAt, estimatedTotal, completed);
    const node = resultBox.querySelector(".progress");
    if (node) node.textContent = `${completed}/${estimatedTotal} · ${eta}`;
  }, 800);

  try {
    const response = await fetch("/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.message || "Something went wrong.");
    }

    clearInterval(progressTimer);
    resultBox.innerHTML = `
      <strong>Success!</strong><br>
      Branch: ${data.branch}<br>
      Commits created: ${data.commitsCreated}<br>
      Date range: ${data.startDate} → ${data.endDate}<br>
      Selected days: ${data.selectedDays}<br>
      Push enabled: ${data.pushToRemote ? "Yes" : "No"}
    `;
  } catch (error) {
    clearInterval(progressTimer);
    resultBox.innerHTML = `<strong>Error:</strong> ${error.message}`;
  }
});

checkGitHubAuth();
