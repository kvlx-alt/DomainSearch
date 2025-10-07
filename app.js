/* ============================================================
   Analizador de Dominios Sospechosos - Frontend JS (v3)
   Funciona con Cloudflare Worker (v2 avanzado o v2 optimizado)
   ============================================================ */

const WORKER_URL = "https://domain-analyzer-worker.gitsearch.workers.dev"; // ← tu Worker

document.addEventListener("DOMContentLoaded", () => {
  const analyzeBtn = document.getElementById("analyzeBtn");
  const clearBtn = document.getElementById("clearBtn");
  const brandInput = document.getElementById("brandList");
  const tldInput = document.getElementById("tldList");
  const output = document.getElementById("results");
  const progress = document.getElementById("progressBar");

  analyzeBtn.addEventListener("click", async () => {
    const brands = brandInput.value
      .split("\n")
      .map(b => b.trim())
      .filter(b => b.length > 0);
    const tlds = tldInput.value.trim();

    if (!brands.length) {
      alert("Introduce al menos una marca o dominio");
      return;
    }

    output.innerHTML = "⏳ Analizando dominios...";
    progress.value = 0;

    let html = `<table><thead>
      <tr>
        <th>Dominio</th>
        <th>Tipologías</th>
        <th>Clasificación</th>
        <th>Fuentes</th>
        <th>Fecha creación</th>
        <th>Expira</th>
        <th>Registrante</th>
        <th>Último certificado</th>
        <th>Notas</th>
      </tr></thead><tbody>`;

    for (let i = 0; i < brands.length; i++) {
      const brand = brands[i];
      try {
        const res = await fetch(`${WORKER_URL}/?brand=${encodeURIComponent(brand)}&tlds=${encodeURIComponent(tlds)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (data.error) throw new Error(data.error);

        if (Array.isArray(data.encontrados) && data.encontrados.length > 0) {
          for (const d of data.encontrados) {
            html += formatDomainRow(d);
          }
        } else {
          html += `<tr><td>${brand}</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>Sin resultados válidos</td></tr>`;
        }

        progress.value = ((i + 1) / brands.length) * 100;
      } catch (e) {
        html += `<tr><td>${brand}</td><td>-</td><td>Error</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>${escapeHTML(e.message)}</td></tr>`;
      }
    }

    html += "</tbody></table>";
    output.innerHTML = html;
    progress.value = 100;
  });

  clearBtn.addEventListener("click", () => {
    brandInput.value = "";
    output.innerHTML = "";
    progress.value = 0;
  });
});

/* ------------------- Utilidades ------------------- */

function formatDomainRow(d) {
  const tipologia = "Typosquatting";
  const fuentes = d.certificados > 0 ? "crt.sh" : "-";

  return `<tr>
    <td><a href="https://${escapeHTML(d.dominio)}" target="_blank">${escapeHTML(d.dominio)}</a></td>
    <td>${tipologia}</td>
    <td>${escapeHTML(d.clasificacion || "-")}</td>
    <td>${fuentes}</td>
    <td>${formatDate(d.fecha_creacion)}</td>
    <td>${formatDate(d.fecha_expiracion)}</td>
    <td>${escapeHTML(d.registrante || "-")}</td>
    <td>${formatDate(d.fecha_cert_reciente)}</td>
    <td>${d.notas && d.notas.length ? escapeHTML(d.notas.join(", ")) : "-"}</td>
  </tr>`;
}

function formatDate(dateStr) {
  if (!dateStr) return "-";
  try {
    const d = new Date(dateStr);
    if (isNaN(d)) return "-";
    return d.toISOString().split("T")[0];
  } catch {
    return "-";
  }
}

function escapeHTML(str) {
  return str
    ? str.replace(/[&<>'"]/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c])
      )
    : "";
}
