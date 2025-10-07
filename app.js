/* ============================================================
   Analizador de Dominios Sospechosos - Frontend JS (v4)
   Integración completa con RDAP + ASN + crt.sh + AbuseIPDB
   ============================================================ */

const WORKER_URL = "https://domain-analyzer-worker.gitsearch.workers.dev";

document.addEventListener("DOMContentLoaded", () => {
  const analyzeBtn = document.getElementById("analyzeBtn");
  const clearBtn = document.getElementById("clearBtn");
  const modal = document.getElementById("detailModal");
  const modalTitle = document.getElementById("modalTitle");
  const modalBody = document.getElementById("modalBody");
  const closeModal = document.getElementById("closeModal");
  const brandInput = document.getElementById("brandList");
  const tldInput = document.getElementById("tldList");
  const output = document.getElementById("results");
  const progress = document.getElementById("progressBar");

  analyzeBtn.addEventListener("click", async () => {
    const brands = brandInput.value.split("\n").map(b => b.trim()).filter(b => b.length > 0);
    const tlds = tldInput.value.trim();

    if (!brands.length) return alert("Introduce al menos una marca o dominio");

    output.innerHTML = `<div class='text-gray-400'>⏳ Analizando dominios...</div>`;
    progress.value = 0;

    let html = `<table><thead>
      <tr>
        <th>Dominio</th>
        <th>Clasificación</th>
        <th>IPs / ASN</th>
        <th>Abuse</th>
        <th>Certs</th>
        <th>Creación</th>
        <th>Registrante</th>
        <th>País</th>
        <th>Acciones</th>
      </tr></thead><tbody>`;

    for (let i = 0; i < brands.length; i++) {
      const brand = brands[i];
      try {
        const res = await fetch(`${WORKER_URL}/?brand=${encodeURIComponent(brand)}&tlds=${encodeURIComponent(tlds)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        for (const d of data.encontrados || []) {
          html += formatDomainRow(d, brand);
        }

        progress.value = ((i + 1) / brands.length) * 100;
      } catch (e) {
        html += `<tr><td>${escapeHTML(brand)}</td><td colspan="8" class="text-red-400">Error: ${escapeHTML(e.message)}</td></tr>`;
      }
    }

    html += "</tbody></table>";
    output.innerHTML = html;
    progress.value = 100;

    document.querySelectorAll(".viewBtn").forEach(btn => {
      btn.addEventListener("click", e => {
        const details = JSON.parse(decodeURIComponent(e.target.dataset.details));
        modalTitle.textContent = details.dominio;
        modalBody.textContent = JSON.stringify(details, null, 2);
        modal.classList.remove("hidden");
      });
    });
  });

  clearBtn.addEventListener("click", () => {
    brandInput.value = "";
    output.innerHTML = "";
    progress.value = 0;
  });

  closeModal.addEventListener("click", () => modal.classList.add("hidden"));
});

/* ------------------- Utilidades ------------------- */
function formatDomainRow(d, brand) {
  const risk = getRiskClass(d.abuse_score);
  const abuseCell = d.abuse_score == null ? "-" : `<span class="${risk.cls}">${risk.label}</span>`;
  const asn = d.asn_org ? " / " + escapeHTML(d.asn_org) : "";
  const ipList = (d.registros || []).join(", ") + asn;
  const country = d.geo?.country || "-";
  const certs = d.certificados || 0;

  // resaltado de marca
  let domainHTML = escapeHTML(d.dominio);
  if (brand) {
    const re = new RegExp(escapeRegExp(brand), "ig");
    domainHTML = domainHTML.replace(re, m => `<mark>${escapeHTML(m)}</mark>`);
  }

  const details = encodeURIComponent(JSON.stringify(d));

  return `<tr>
    <td><a href="https://${escapeHTML(d.dominio)}" target="_blank">${domainHTML}</a></td>
    <td>${escapeHTML(d.clasificacion || "-")}</td>
    <td>${escapeHTML(ipList || "-")}</td>
    <td>${abuseCell}</td>
    <td>${certs}</td>
    <td>${formatDate(d.fecha_creacion || d.rdap?.fecha_creacion)}</td>
    <td>${escapeHTML(d.registrante || d.rdap?.registrante || "-")}</td>
    <td>${escapeHTML(country)}</td>
    <td><button class="viewBtn bg-sky-600 px-2 py-1 rounded text-white" data-details="${details}">Ver</button></td>
  </tr>`;
}

function getRiskClass(score) {
  if (score == null) return { cls: "risk-low", label: "-" };
  if (score >= 60) return { cls: "risk-high", label: `Alto (${score})` };
  if (score >= 30) return { cls: "risk-med", label: `Medio (${score})` };
  return { cls: "risk-low", label: `Bajo (${score})` };
}

function formatDate(dateStr) {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  return isNaN(d) ? "-" : d.toISOString().split("T")[0];
}

function escapeHTML(str) {
  return str ? str.replace(/[&<>'"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;" }[c])) : "";
}
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
