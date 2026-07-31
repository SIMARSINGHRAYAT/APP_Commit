const form = document.getElementById("commitForm");
const resultBox = document.getElementById("result");
const filterMode = document.getElementById("filterMode");
const selectedDaysPanel = document.getElementById("selectedDays");

filterMode.addEventListener("change", () => {
  selectedDaysPanel.classList.toggle("hidden", filterMode.value !== "selected");
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
    pushToRemote: document.getElementById("pushToRemote").checked,
  };

  const estimatedTotal = Math.max(1, Math.round((payload.dailyCount || 1) * 7));
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
