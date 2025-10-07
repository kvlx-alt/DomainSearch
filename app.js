const WORKER_URL = "https://domain-analyzer-worker.gitsearch.workers.dev"; // tu worker

document.addEventListener("DOMContentLoaded", () => {
  const analyzeBtn = document.getElementById("analyzeBtn");
  const clearBtn = document.getElementById("clearBtn");
  const progress = document.getElementById("progressBar");
  const output = document.getElementById("results");
  const brandInput = document.getElementById("brandList");
  const tldInput = document.getElementById("tldList");

  // 👇 NUEVO: Checkbox para elegir modo
  const modeToggle = document.createElement("label");
  modeToggle.className = "text-sm text-gray-300 block mb-2";
  modeToggle.innerHTML = `
    <input type="checkbox" id="modeLight" checked> 🔎 Análisis rápido (solo DNS + Certificados)
  `;
  tldInput.parentNode.appendChild(modeToggle);

  analyzeBtn.addEventListener("click", async () => {
    const brand = brandInput.value.trim();
    const tlds = tldInput.value.trim();
    const lightMode = document.getElementById("modeLight")?.checked ? "light" : "deep"; // 👈 nuevo

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

    for (let i = 0; i < totalChunks; i++) {
      // 👇 se añade mode al URL
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
            } else if (msg.status === "checking") {
              progress.value += 0.1;
            } else if (msg.status === "found") {
              found++;
              addRow(msg, tbody);
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

    function addRow(d, tbody) {
      const abuse =
        d.abuse == null
          ? "-"
          : `<span class="${getRiskClass(d.abuse).cls}">${getRiskClass(d.abuse).label}</span>`;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><a href="https://${d.domain || d.dominio}" target="_blank" class="text-sky-400">${escapeHTML(
        d.domain || d.dominio
      )}</a></td>
        <td>${(d.ips || d.registros || []).join(", ") || "-"}</td>
        <td>${d.certs || d.certificados || 0}</td>
        <td>${abuse}</td>
        <td>${escapeHTML(d.rdap?.registrante || "-")}</td>
        <td>${formatDate(d.rdap?.fecha_creacion)}</td>
      `;
      tbody.appendChild(tr);
    }
  });

  clearBtn.addEventListener("click", () => {
    brandInput.value = "";
    output.innerHTML = "";
    progress.value = 0;
  });
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

