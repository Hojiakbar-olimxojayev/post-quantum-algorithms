const $ = (s) => document.querySelector(s);
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { } } };
let lang = store.get('lang') || (navigator.language.startsWith('uz') ? 'uz' : 'en');
let theme = store.get('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
let group = 'kem', log = true, data = window.BENCH;
const t = (k) => I18N[lang][k] ?? k;
const OPS = { kem: ['keygen', 'encaps', 'decaps'], sig: ['keygen', 'sign', 'verify'] };

const fmtMs = (v) => v < 1 ? (v * 1000).toFixed(v < 0.01 ? 1 : 0) + ' µs' : v < 100 ? v.toFixed(2) + ' ms' : v.toFixed(0) + ' ms';
const fmtUs = (v) => v < 1000 ? v.toFixed(0) + ' µs' : (v / 1000).toFixed(2) + ' ms';
const fmtB = (v) => v.toLocaleString('en-US') + ' B';
const width = (v, min, max, lg) => max <= min ? 100 : lg ? 6 + 94 * Math.log(v / min) / Math.log(max / min) : Math.max(2, 100 * v / max);

function chart(title, rows, fmt, lg) {
  const vs = rows.map((r) => Math.max(r.v, 1e-3)), min = Math.min(...vs), max = Math.max(...vs);
  return `<figure class="chart"><figcaption>${title}</figcaption>` + rows.map((r, i) =>
    `<div class="row"><span class="nm">${r.name}${r.pq ? '<i class="tag">PQ</i>' : ''}</span>` +
    `<span class="track"><b class="bar ${r.pq ? 'pq' : 'cl'}" style="width:${width(vs[i], min, max, lg).toFixed(1)}%"></b></span>` +
    `<span class="val">${fmt(r.v)}</span></div>`).join('') + '</figure>';
}

function render() {
  document.documentElement.dataset.theme = theme;
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((e) => { e.textContent = t(e.dataset.i18n); });
  document.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.g === group));
  $('#lang').textContent = lang === 'en' ? 'O‘zbekcha' : 'English';
  $('#theme').textContent = t(theme === 'dark' ? 'light' : 'dark');
  $('#content').hidden = !data;
  $('#empty').hidden = !!data;
  if (!data) return;

  const it = data[group], ops = OPS[group], m = data.meta;
  const rows = (f) => it.map((x) => ({ name: x.name, pq: x.pq, v: f(x) }));
  const outLabel = t(group === 'kem' ? 'out_kem' : 'out_sig');
  const base = it.find((x) => x.base) || it[0];
  const wire = (x) => x.sizes.pub + x.sizes.out;

  const table = `<div class="scroll"><table><thead><tr><th>${t('alg')}</th><th>${t('type')}</th><th>${t('level')}</th><th>${t('pub')}</th><th>${t('priv')}</th><th>${outLabel}</th>` +
    ops.map((o) => `<th>${t(o)}</th>`).join('') + `<th>${t(group === 'kem' ? 'wire_kem' : 'wire_sig')}</th><th>${t('vs')} (${base.name})</th></tr></thead><tbody>` +
    it.map((x) => `<tr class="${x.pq ? 'pq' : 'cl'}"><th scope="row">${x.name}</th><td>${t(x.pq ? 'pqt' : 'cl')}</td><td>${x.level}</td>` +
      `<td>${fmtB(x.sizes.pub)}</td><td>${fmtB(x.sizes.priv)}</td><td>${fmtB(x.sizes.out)}</td>` +
      ops.map((o) => `<td>${fmtMs(x.ops[o].ms)}</td>`).join('') +
      `<td>${fmtB(wire(x))}</td><td>${(wire(x) / wire(base)).toFixed(1)}×</td></tr>`).join('') + '</tbody></table></div>';

  $('#content').innerHTML =
    `<p class="meta">${t('meta')}: Node ${m.node}, OpenSSL ${m.openssl}, ${m.cpu} (${m.cores} cores), ${m.date}</p>` +
    `<section><h2>${t('sizes_h')}</h2><p>${t('sizes_p')}</p><div class="grid">` +
    chart(t('pub'), rows((x) => x.sizes.pub), fmtB, log) + chart(t('priv'), rows((x) => x.sizes.priv), fmtB, log) +
    chart(outLabel, rows((x) => x.sizes.out), fmtB, log) + `</div></section>` +
    `<section><h2>${t('time_h')}</h2><p>${t('time_p')}</p><div class="grid">` +
    ops.map((o) => chart(t(o), rows((x) => x.ops[o].ms), fmtMs, log)).join('') + `</div></section>` +
    `<section><h2>${t('res_h')}</h2><p>${t('res_p')}</p><div class="grid">` +
    chart(t(group === 'kem' ? 'cpu_kem' : 'cpu_sig'), rows((x) => x.ops[ops[1]].cpuUs + x.ops[ops[2]].cpuUs), fmtUs, log) +
    chart(t('rss'), rows((x) => x.rssMB), (v) => v.toFixed(1) + ' MB', false) + `</div></section>` +
    `<section><h2>${t('table_h')}</h2>${table}</section>` +
    `<section class="notes"><h2>${t('notes_h')}</h2><ul><li>${t('n1')}</li><li>${t('n2')}</li><li>${t('n3')}</li></ul><p class="foot">${t('foot')}</p></section>`;
}

document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => { group = b.dataset.g; render(); }));
$('#lang').addEventListener('click', () => { lang = lang === 'en' ? 'uz' : 'en'; store.set('lang', lang); render(); });
$('#theme').addEventListener('click', () => { theme = theme === 'dark' ? 'light' : 'dark'; store.set('theme', theme); render(); });
$('#log').addEventListener('change', (e) => { log = e.target.checked; render(); });
$('#file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try { const j = JSON.parse(await f.text()); if (!j.kem || !j.sig) throw 0; data = j; render(); } catch { alert(t('badfile')); }
});
render();
