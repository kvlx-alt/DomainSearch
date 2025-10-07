/* ============================================================
   Analizador de Dominios Sospechosos - Frontend JS (v3.1)
   Integración con Worker (RDAP + WHOIS + ASN + crt.sh + AbuseIPDB)
   ============================================================ */

const WORKER_URL = "https://domain-analyzer-worker.gitsearch.workers.dev"; // tu Worker activo

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

    output.innerHTML = `<div class='text-gray-400'>⏳ Analizando dominios...</div>`;
    progress.value = 0;

    let html = `<table><thead>
      <tr>
        <th>Dominio</th>
        <th>Clasificación</th>
        <th>Fuente</th>
        <th>IPs / ASN</th>
        <th>Creación</th>
        <th>Expira</th>
        <th>Registrante</th>
        <th>Último certificado</th>
        <th>Abuse</th>
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
            html += formatDomainRow(d, brand);
          }
        } else {
          html += `<tr><td>${escapeHTML(brand)}</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>Sin resultados válidos</td></tr>`;
        }

        progress.value = ((i + 1) / brands.length) * 100;
      } catch (e) {
        console.error(e);
        html += `<tr><td>${escapeHTML(brand)}</td><td>Error</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>${escapeHTML(e.message)}</td></tr>`;
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

function formatDomainRow(d, brand) {
  const fuentes = d.certificados > 0 ? "crt.sh" : "-";
  const abuse = d.abuse_score != null ? d.abuse_score : "-";
  const asn = d.asn_org ? " / " + escapeHTML(d.asn_org) : "";
  const ipList = (d.registros || []).join(", ") + asn;

  // resaltado de palabra clave (marca)
  let domainHTML = escapeHTML(d.dominio);
  if (brand) {
    const re = new RegExp(escapeRegExp(brand), "ig");
    domainHTML = domainHTML.replace(
      re,
      m =>
        `<mark style="background:#ffe4b5;color:#000;border-radius:3px;padding:0 3px">${escapeHTML(m)}</mark>`
    );
  }

  return `<tr>
    <td><a href="https://${escapeHTML(d.dominio)}" target="_blank">${domainHTML}</a></td>
    <td>${escapeHTML(d.clasificacion || "-")}</td>
    <td>${fuentes}</td>
    <td>${escapeHTML(ipList || "-")}</td>
    <td>${formatDate(d.fecha_creacion || d.rdap?.fecha_creacion)}</td>
    <td>${formatDate(d.fecha_expiracion || d.rdap?.fecha_expiracion)}</td>
    <td>${escapeHTML(d.registrante || d.rdap?.registrante || "-")}</td>
    <td>${formatDate(d.fecha_cert_reciente)}</td>
    <td>${abuse}</td>
    <td>${d.notas && d.notas.length ? escapeHTML(d.notas.join(", ")) : "-"}</td>
  </tr>`;
}

function formatDate(dateStr) {
  if (!dateStr) return "-";
  try {
    const d = new Date(dateStr);
    return isNaN(d) ? "-" : d.toISOString().split("T")[0];
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

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
