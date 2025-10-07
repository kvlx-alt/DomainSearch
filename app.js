const WORKER_URL = "https://domain-analyzer-worker.gitsearch.workers.dev"; // tu worker

document.addEventListener("DOMContentLoaded", () => {
  const analyzeBtn = document.getElementById("analyzeBtn");
  const clearBtn = document.getElementById("clearBtn");
  const progress = document.getElementById("progressBar");
  const output = document.getElementById("results");
  const brandInput = document.getElementById("brandList");
  const tldInput = document.getElementById("tldList");
  const modal = document.getElementById("detailModal");
  const modalTitle = document.getElementById("modalTitle");
  const modalBody = document.getElementById("modalBody");
  const closeModalBtn = document.getElementById("closeModal");

  // 👇 Checkbox modo rápido
  const modeToggle = document.createElement("label");
  modeToggle.className = "text-sm text-gray-300 block mb-2";
  modeToggle.innerHTML = `
    <input type="checkbox" id="modeLight" checked> 🔎 Análisis rápido (solo certificados)
  `;
  tldInput.parentNode.appendChild(modeToggle);

  analyzeBtn.addEventListener("click", async () => {
    const brand = brandInput.value.trim();
    const tlds = tldInput.value.trim();
    const lightMode = document.getElementById("modeLight")?.checked ? "light" : "deep";

    if (!brand) return alert("Introduce una marca o dominio");

    output.innerHTML = `
      <div class="text-gray-400 mb-2">⏳ Analizando: <span class="text-sky-300">${brand}</span> (${lightMode})</div>
      <div id="liveLog" class="text-xs text-gray-400 bg-slate-800 p-2 rounded h-32 overflow-auto mb-3"></div>
      <table id="resultTable" class="w-full text-sm">
        <thead>
          <tr>
            <th>Dominio</th>
            <th>IPs</th>
            <th>Certs</th>
            <th>Abuse</th>
            <th>Registrante</th>
            <th>Creación</th>
            <th></th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    `;

    const logDiv = document.getElementById("liveLog");
    const tbody = document.querySelector("#resultTable tbody");
    progress.value = 0;

    const whitelist = document.getElementById("whitelistInput")?.value.trim() || "";
    const totalChunks = 4;
    const chunkSize = 100;
    const fetches = [];

    // ✅ Definimos aquí para evitar errores
    const chunkProgressMap = {};
    function updateProgress(chunkIdx, chunkPercent) {
      chunkProgressMap[chunkIdx] = chunkPercent;
      const total = Object.values(chunkProgressMap).reduce((a, b) => a + b, 0);
      progress.value = total;
    }

    for (let i = 0; i < totalChunks; i++) {
      const url = `${WORKER_URL}/?brand=${encodeURIComponent(brand)}&tlds=${encodeURIComponent(
        tlds
      )}&whitelist=${encodeURIComponent(whitelist)}&chunk=${i}&chunkSize=${chunkSize}&mode=${lightMode}`;
      fetches.push(runChunk(url, i));
    }

    const results = await Promise.all(fetches);
    const totalFound = results.reduce((acc, val) => acc + (val || 0), 0);
    log(`✅ Todos los chunks completados. Total hallazgos: ${totalFound}`);

    async function runChunk(url, idx) {
      try {
        const resp = await fetch(url);
        if (!resp || !resp.ok) {
          log(`❌ Chunk ${idx + 1} error HTTP ${resp?.status ?? "sin respuesta"}`);
          console.error("Error en chunk", idx + 1, resp);
          return 0;
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let found = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop();

          for (const line of lines) {
            if (!line.trim()) continue;
            let msg;
            try {
              msg = JSON.parse(line);
            } catch {
              continue;
            }

            if (msg.status === "init") {
              log(`🔍 Chunk ${idx + 1}: iniciando (${msg.brand})`);
            } else if (msg.status === "info") {
              log(`📦 Chunk ${idx + 1}: ${msg.msg}`);
            } else if (msg.status === "progress") {
              const percentPerChunk = 100 / totalChunks;
              const chunkProgress = (msg.done / msg.total) * percentPerChunk;
              updateProgress(idx, chunkProgress);
              log(`⏩ Chunk ${idx + 1}: ${msg.done}/${msg.total} dominios procesados`);
            } else if (msg.status === "found") {
              found++;
              addRow(msg, tbody, lightMode);
              log(`✅ ${msg.domain} (${msg.certs} certs, abuse ${msg.abuse ?? "-"})`);
            } else if (msg.status === "error") {
              log(`⚠️ ${msg.domain}: ${msg.msg}`);
            } else if (msg.status === "done") {
              log(`🏁 Chunk ${idx + 1} finalizado — ${msg.total_found} hallazgos`);
            }
          }
        }

        return found;
      } catch (err) {
        log(`💥 Chunk ${idx + 1} falló: ${err.message}`);
        console.error("Error en chunk", idx + 1, err);
        return 0;
      }
    }

    function log(text) {
      const p = document.createElement("div");
      p.textContent = text;
      logDiv.appendChild(p);
      logDiv.scrollTop = logDiv.scrollHeight;
    }

    function addRow(d, tbody, mode) {
      const abuse =
        d.abuse == null
          ? "-"
          : `<span class="${getRiskClass(d.abuse).cls}">${getRiskClass(d.abuse).label}</span>`;
      const tr = document.createElement("tr");

      const refetchBtn =
        mode === "light"
          ? `<button class="btn btn-small btn-secondary btn-refetch" data-domain="${escapeHTML(
              d.domain || d.dominio
            )}">🔍 Analizar full</button>`
          : "";

      tr.innerHTML = `
        <td><a href="https://${d.domain || d.dominio}" target="_blank" class="text-sky-400">${escapeHTML(
        d.domain || d.dominio
      )}</a></td>
        <td>${(d.ips || d.registros || []).join(", ") || "-"}</td>
        <td>${d.certs || d.certificados || 0}</td>
        <td>${abuse}</td>
        <td>${escapeHTML(d.rdap?.registrante || "-")}</td>
        <td>${formatDate(d.rdap?.fecha_creacion)}</td>
        <td>${refetchBtn}</td>
      `;
      tbody.appendChild(tr);
    }
  });

  // 🔁 Evento global para botones de reanálisis (full)
  document.addEventListener("click", async (e) => {
    if (e.target.classList.contains("btn-refetch")) {
      const domain = e.target.dataset.domain;
      e.target.textContent = "⏳ Analizando...";
      e.target.disabled = true;

      const url = `${WORKER_URL}/?brand=${encodeURIComponent(domain)}&tlds=.com,.net,.org,.es,.info&mode=deep`;
      try {
        const resp = await fetch(url);
        const text = await resp.text();
        e.target.textContent = "✅ Hecho";
        showFullModal(domain, text);
      } catch (err) {
        console.error(err);
        e.target.textContent = "❌ Error";
      }
    }
  });

  clearBtn.addEventListener("click", () => {
    brandInput.value = "";
    output.innerHTML = "";
    progress.value = 0;
  });

  closeModalBtn.addEventListener("click", () => {
    modal.classList.add("hidden");
  });

  function showFullModal(domain, ndjsonText) {
    const lines = ndjsonText.trim().split("\n");
    const data = lines.map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean);
    const encontrados = data.find(x => x.status === "done")?.encontrados || [];

    modalTitle.textContent = `Análisis completo: ${domain}`;
    modalBody.innerHTML = encontrados.length
      ? encontrados.map(d => `
        <div class="border-b border-slate-700 py-2">
          <div class="font-semibold text-sky-300">${d.dominio}</div>
          <div>IP: ${d.registros.join(", ") || "-"}</div>
          <div>Certificados: ${d.certificados}</div>
          <div>Registrante: ${escapeHTML(d.rdap?.registrante || "-")}</div>
          <div>Fecha creación: ${formatDate(d.rdap?.fecha_creacion)}</div>
        </div>
      `).join("")
      : "<div class='text-gray-400'>No se encontraron hallazgos adicionales.</div>";

    modal.classList.remove("hidden");
  }
});

/* ================= UTILIDADES ================= */
function formatDate(d) {
  if (!d) return "-";
  const t = new Date(d);
  return isNaN(t) ? "-" : t.toISOString().split("T")[0];
}

function escapeHTML(s) {
  return s
    ? s.replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]))
    : "";
}

function getRiskClass(score) {
  if (score == null) return { cls: "risk-low", label: "-" };
  if (score >= 60) return { cls: "risk-high", label: `Alto (${score})` };
  if (score >= 30) return { cls: "risk-med", label: `Medio (${score})` };
  return { cls: "risk-low", label: `Bajo (${score})` };
}
