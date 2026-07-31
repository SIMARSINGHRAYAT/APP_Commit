const form = document.getElementById("commitForm");
const resultBox = document.getElementById("result");
const filterMode = document.getElementById("filterMode");
const selectedDaysPanel = document.getElementById("selectedDays");

filterMode.addEventListener("change", () => {
  selectedDaysPanel.classList.toggle("hidden", filterMode.value !== "selected");
});

function updateProgress(startTime, total, completed) {
  const elapsed = (Date.now() - startTime) / 1000;
  const remaining = Math.max(0, total - completed);
  const estimatedSeconds = elapsed > 0 ? Math.max(1, (elapsed / Math.max(1, completed)) * remaining) : 0;
  const minutes = Math.floor(estimatedSeconds / 60);
  const seconds = Math.round(estimatedSeconds % 60);
  return `${minutes}m ${seconds}s remaining`;
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
    dailyCount: document.getElementById("dailyCount").value,
    maxPerDay: document.getElementById("maxPerDay").value,
    randomize: document.getElementById("randomize").checked,
    filterMode: filterMode.value,
    selectedDays,
    weekdayCounts,
    branch: document.getElementById("branch").value,
    pushToRemote: document.getElementById("pushToRemote").checked,
  };

  resultBox.classList.remove("hidden");
  resultBox.innerHTML = "Generating commits... <span class='progress'>Estimating...</span>";

  const startTime = Date.now();
  let completed = 0;
  const progressTimer = setInterval(() => {
    completed = Math.min(completed + 1, Number(payload.dailyCount || 1));
    const progressText = updateProgress(startTime, Number(payload.dailyCount || 1), completed);
    const node = resultBox.querySelector(".progress");
    if (node) node.textContent = progressText;
  }, 1000);

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
