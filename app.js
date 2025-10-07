
// app.js - Analizador para GitHub Pages (vanilla JS)
// Requisitos: navegador moderno. Usa Cloudflare DoH y endpoints públicos crt.sh + rdap.org

const GENERIC_KEYWORDS = ["login", "cliente", "empleado", "tienda", "online", "db", "acceso"];
const SECTOR_KEYWORDS = ["shop", "store", "moda", "ropa"];
const RISKY_TLDS = new Set(["pw","ga","cf","gq","tk","ml","top","xyz"]);

// Cloudflare DoH JSON endpoint
const DOH_ENDPOINT = name => `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=A`;
const DOH_ACCEPT = "application/dns-json";

const $ = sel => document.querySelector(sel);
const $all = sel => Array.from(document.querySelectorAll(sel));

function log(msg){
  const el = $("#log");
  el.textContent = msg;
}

// --- utilidades ---
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function normalizeDomain(d){ return d.trim().toLowerCase().replace(/^https?:\/\//,'').split('/')[0]; }
function extTld(domain){ const parts = domain.split('.'); return parts.length>1?parts.slice(1).join('.') : ''; }
function baseLabel(domain){ return domain.split('.')[0]; }

// Simple ratio (SequenceMatcher replacement)
function similarity(a,b){
  if(!a||!b) return 0;
  let matches = 0;
  const minL = Math.min(a.length,b.length);
  for(let i=0;i<minL;i++) if(a[i]===b[i]) matches++;
  return matches / Math.max(a.length,b.length);
}

// Homoglyph norm simple
function homoglyphNormalize(s){
  const map = {'\u0430':'a','\u0410':'a','\u03B1':'a','0':'o','1':'l','3':'e','5':'s'};
  return s.split('').map(ch=>map[ch]||ch).join('');
}

// --- network calls ---
async function dohResolveA(name){
  try{
    const res = await fetch(DOH_ENDPOINT(name), {method:'GET', headers:{Accept: DOH_ACCEPT}});
    if(!res.ok) return null;
    const js = await res.json();
    if(js && js.Answer && Array.isArray(js.Answer)){
      const recs = js.Answer.filter(x=>x.type===1).map(x=>x.data);
      return recs.length?recs:null;
    }
  }catch(e){
    // CORS or network errors -> return null (no resolution)
    return null;
  }
  return null;
}

async function queryCrtSh(domain){
  try{
    const url = `https://crt.sh/?q=%25.${domain}&output=json`;
    const r = await fetch(url);
    if(!r.ok) return [];
    const js = await r.json();
    return Array.isArray(js)?js:[];
  }catch(e){
    return [];
  }
}

async function queryRdap(domain){
  try{
    const r = await fetch(`https://rdap.org/domain/${domain}`);
    if(!r.ok) return null;
    return await r.json();
  }catch(e){
    return null;
  }
}

// --- permutaciones (versión reducida pero efectiva) ---
function generatePermutations(domain, extraTlds){
  const ext = domain.split('.');
  const sld = ext[0];
  const origTld = ext.slice(1).join('.') || '';
  const res = new Set();

  // change TLDs
  for(const t of extraTlds){
    res.add(`${sld}.${t.replace(/^\./,'')}`);
  }
  // add dash insertions
  for(let i=1;i<sld.length;i++){
    res.add(`${sld.slice(0,i)}-${sld.slice(i)}.${origTld || extraTlds[0]}`);
  }
  // duplicate char (common typo)
  for(let i=0;i<sld.length;i++){
    res.add(`${sld.slice(0,i)}${sld[i]}${sld.slice(i)}.${origTld || extraTlds[0]}`);
  }
  // char swaps (simple)
  const swaps = {'a':'e','e':'a','i':'1','o':'0','l':'1'};
  for(const [k,v] of Object.entries(swaps)){
    if(sld.includes(k)) res.add(`${sld.replace(k,v)}.${origTld || extraTlds[0]}`);
  }
  // prefix/suffix common: login, online, clientes
  ['-login','.login','-online','.online','-clientes','.clientes','login-','.login-'].forEach(suff=>{
    if(suff.includes('.') && origTld) {
      // e.g. sld.login + .tld -> not ideal; skip
    } else {
      let t = suff.replace(/\./g,'');
      // add hyphen variations
      res.add(`${sld}${suff}.${origTld || extraTlds[0]}`);
      res.add(`${sld}${suff}.${extraTlds[0].replace(/^\./,'')}`);
    }
  });

  // remove original and keep limited size
  res.delete(domain);
  return Array.from(res).slice(0,300); // cap permutations
}

// --- clasificación heurística ---
function classify(domain, brands){
  const dl = domain.toLowerCase();
  for(const b of brands){
    const bl = b.toLowerCase().replace(/^https?:\/\//,'').split('/')[0];
    if(dl.includes(bl)){
      for(const g of GENERIC_KEYWORDS) if(dl.includes(g)) return 'Coincidencia clara';
      // numbers/Hyphen -> dudosa
      if(/[0-9-]/.test(dl)) return 'Coincidencia dudosa';
      return 'Coincidencia dudosa';
    }
  }
  return 'Coincidencia no relevante';
}

// --- analyze single domain (generates permutations, resolves only the ones that resolve A) ---
async function analyzeDomain(domain, brands, tlds, limiter){
  const d = normalizeDomain(domain);
  const out = {
    dominio: d, tipologias: [], clasificacion: '', fuentes: [], fecha_creacion: '', registrante: '', notas:[]
  };

  // RDAP
  const rd = await queryRdap(d);
  if(rd){
    // events
    if(Array.isArray(rd.events)){
      const ev = rd.events.find(e=>e.eventAction==='registration' || e.eventAction==='registered');
      if(ev) out.fecha_creacion = ev.eventDate || ev.eventDate;
    }
    // entities vcard
    if(Array.isArray(rd.entities)){
      for(const ent of rd.entities){
        if(ent.vcardArray && Array.isArray(ent.vcardArray) && ent.vcardArray[1]){
          for(const fld of ent.vcardArray[1]){
            if(fld && fld[0]=='fn'){ out.registrante = fld[3]; break; }
          }
          if(out.registrante) break;
        }
      }
    }
  }

  // crt.sh
  const certs = await queryCrtSh(d);
  if(certs.length>0){ out.tipologias.push('Certificados'); out.fuentes.push('crt.sh'); }

  // generate perms and resolve only A records
  const perms = generatePermutations(d, tlds);
  if(perms.length>0){
    const resolved = [];
    // limited concurrency
    const concurrency = 6;
    let idx = 0;
    const worker = async () => {
      while(true){
        let i = idx++;
        if(i >= perms.length) break;
        const candidate = perms[i];
        const recs = await dohResolveA(candidate);
        if(recs && recs.length>0){
          resolved.push({domain:candidate, records: recs});
        }
        // small backoff to avoid DoH rate limits
        await sleep(80);
      }
    };
    const jobs = Array.from({length: Math.min(concurrency, perms.length)}, worker).map(fn=>fn());
    await Promise.all(jobs);
    if(resolved.length>0){
      out.tipologias.push('Typosquatting');
      out.fuentes.push('DoH-resolve');
      out.notas.push('Variaciones que resolvieron DNS: ' + resolved.map(r=>r.domain).join(', '));
    }
  }

  // classification & homograph
  out.clasificacion = classify(d, brands);
  // homograph
  const sld = baseLabel(d);
  const norm = homoglyphNormalize(sld);
  for(const b of brands){
    const bb = b.toLowerCase().replace(/^https?:\/\//,'').split('/')[0];
    if(norm === bb && norm !== sld){
      out.tipologias.push('Typosquatting (homógrafo)');
      out.notas.push(`Homógrafo: ${sld} → ${norm}`);
      break;
    }
  }

  // tld risk
  const tld = d.split('.').slice(-1)[0];
  if(RISKY_TLDS.has(tld)) out.notas.push('TLD de riesgo heurístico');

  return out;
}

// --- UI flow ---
$("#btnRun").addEventListener('click', async ()=>{
  const raw = $("#brandsInput").value.trim();
  if(!raw){ alert('Ingresa marcas o dominios (una por línea)'); return; }
  const lines = raw.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const tlds = ($("#tldsInput").value || ".com").split(",").map(x=>x.trim()).filter(Boolean);
  // Prepare UI
  const tbody = $("#resultTable tbody");
  tbody.innerHTML = "";
  $("#progressWrap").hidden = false;
  $("#progressText").textContent = `0 / ${lines.length}`;
  $("#progressBar").style.width = `0%`;
  log('Iniciando análisis... (evita enviar demasiadas marcas al mismo tiempo)');

  // process sequentially but each domain will spawn parallel resolves for permutations
  for(let i=0;i<lines.length;i++){
    const dom = normalizeDomain(lines[i]);
    $("#progressText").textContent = `${i+1} / ${lines.length}`;
    $("#progressBar").style.width = `${Math.round(((i)/lines.length)*100)}%`;
    // analyze
    let res;
    try{
      res = await analyzeDomain(dom, lines, tlds);
    }catch(e){
      res = {dominio:dom, tipologias:[],clasificacion:'Error',fuentes:[],fecha_creacion:'-',registrante:'-',notas:[String(e)]};
    }
    // append row
    const tr = document.createElement('tr');
    const tip = res.tipologias.length?res.tipologias.join(', '):'-';
    const fuentes = res.fuentes.length?res.fuentes.join(', '):'-';
    const notas = res.notas.length?res.notas.join(' | '):'-';
    tr.innerHTML = `<td><strong>${res.dominio}</strong><details><summary>Detalles</summary><pre>${JSON.stringify(res,null,2)}</pre></details></td>
      <td>${tip}</td>
      <td><span class="badge ${res.clasificacion.toLowerCase().includes('clara')?'clear':res.clasificacion.toLowerCase().includes('dudosa')?'doubt':'irrelevant'}">${res.clasificacion}</span></td>
      <td>${fuentes}</td>
      <td>${res.fecha_creacion || '-'}</td>
      <td>${res.registrante || '-'}</td>
      <td>${notas}</td>`;
    tbody.appendChild(tr);

    // progress visual
    $("#progressBar").style.width = `${Math.round(((i+1)/lines.length)*100)}%`;
    // small throttle to reduce burst
    await sleep(120);
  }

  $("#progressText").textContent = `Completado: ${lines.length} dominios`;
  log('Análisis finalizado.');
  await sleep(400);
  $("#progressWrap").hidden = true;
});

$("#btnClear").addEventListener('click', ()=>{
  $("#brandsInput").value = '';
  $("#resultTable tbody").innerHTML = '';
  log('');
});
