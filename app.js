// app.js - Frontend para GitHub Pages
// Conecta al Worker: https://domain-analyzer-worker.gitsearch.workers.dev
// Desarrollado por kvzlx / ChatGPT

const WORKER_URL = "https://domain-analyzer-worker.gitsearch.workers.dev"; // tu worker activo

const $ = (sel) => document.querySelector(sel);

// ==== UI Helpers ====
function log(msg) {
  $("#log").textContent = msg;
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ==== Lógica principal ====
async function analyzeBrand(brand) {
  const url = `${WORKER_URL}/?brand=${encodeURIComponent(brand)}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Error ${resp.status}: ${resp.statusText}`);
  const data = await resp.json();
  return data;
}

// ==== Renderización ====
function renderResults(data) {
  const tbody = $("#resultTable tbody");
  tbody.innerHTML = "";

  if (!data || !data.encontrados || data.encontrados.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="7" style="text-align:center;color:#666;">No se detectaron dominios sospechosos válidos.</td>`;
    tbody.appendChild(tr);
    return;
  }

  for (const res of data.encontrados) {
    const tr = document.createElement("tr");
    const notas = res.notas && res.notas.length ? res.notas.join(" | ") : "-";
    const colorClass =
      res.clasificacion.includes("clara")
        ? "clear"
        : res.clasificacion.includes("dudosa")
        ? "doubt"
        : "irrelevant";

    tr.innerHTML = `
      <td><strong>${res.dominio}</strong><details><summary>Detalles</summary><pre>${JSON.stringify(res, null, 2)}</pre></details></td>
      <td>${res.tipologia || "Typosquatting"}</td>
      <td><span class="badge ${colorClass}">${res.clasificacion}</span></td>
      <td>${res.certificados > 0 ? "crt.sh" : "-"}</td>
      <td>${res.fecha_creacion || "-"}</td>
      <td>${res.registrante || "-"}</td>
      <td>${notas}</td>`;
    tbody.appendChild(tr);
  }
}

// ==== Controlador de flujo ====
$("#btnRun").addEventListener("click", async () => {
  const raw = $("#brandsInput").value.trim();
  if (!raw) {
    alert("⚠️ Ingresa una o más marcas o dominios (una por línea)");
    return;
  }

  const lines = raw.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const total = lines.length;

  const tbody = $("#resultTable tbody");
  tbody.innerHTML = "";
  $("#progressWrap").hidden = false;
  $("#progressText").textContent = `0 / ${total}`;
  $("#progressBar").style.width = "0%";
  log("Iniciando análisis remoto...");

  for (let i = 0; i < lines.length; i++) {
    const brand = lines[i];
    $("#progressText").textContent = `${i + 1} / ${total}`;
    $("#progressBar").style.width = `${Math.round(((i + 1) / total) * 100)}%`;

    try {
      const data = await analyzeBrand(brand);
      renderResults(data);
    } catch (e) {
      console.error(e);
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="7" style="color:red;">Error analizando ${brand}: ${e.message}</td>`;
      tbody.appendChild(tr);
    }

    await sleep(1000); // pequeña pausa para evitar saturar el Worker
  }

  $("#progressWrap").hidden = true;
  log("✅ Análisis completado");
});

// ==== Limpiar ====
$("#btnClear").addEventListener("click", () => {
  $("#brandsInput").value = "";
  $("#resultTable tbody").innerHTML = "";
  log("");
});
