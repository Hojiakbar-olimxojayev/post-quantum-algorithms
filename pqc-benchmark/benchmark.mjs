// benchmark.mjs: measures size, time and CPU/memory of PQC vs classical algorithms (Node >= 24.7)
import crypto from 'node:crypto';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const BUDGET_MS = Number(process.env.BUDGET_MS || 500); // time spent per operation
const msg = Buffer.from('{"id":"12","role":"user"}');

// Runs fn repeatedly for ~BUDGET_MS (min 5 runs); returns mean time and CPU time per call
function bench(fn) {
  for (let i = 0; i < 3; i++) fn(); // warm-up
  globalThis.gc?.();
  const cpu0 = process.cpuUsage();
  const t0 = process.hrtime.bigint();
  const limit = BigInt(BUDGET_MS) * 1_000_000n;
  let n = 0, el = 0n;
  do { fn(); n++; el = process.hrtime.bigint() - t0; } while (el < limit || n < 5);
  const cpu = process.cpuUsage(cpu0);
  const ms = Number(el) / 1e6 / n;
  return { ms, ops: 1000 / ms, cpuUs: (cpu.user + cpu.system) / n, runs: n };
}

const rsaKG = (b) => () => crypto.generateKeyPairSync('rsa', { modulusLength: b });
const ecKG = () => crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const xKG = () => crypto.generateKeyPairSync('x25519');
const spki = (k) => k.export({ type: 'spki', format: 'der' });
// Diffie-Hellman as a KEM-like flow: sender makes an ephemeral key, receiver uses its private key
const dh = (kg) => ({
  keygen: kg,
  encaps: (kp) => { const e = kg(); return { pub: e.publicKey, ss: crypto.diffieHellman({ privateKey: e.privateKey, publicKey: kp.publicKey }) }; },
  decaps: (kp, ct) => crypto.diffieHellman({ privateKey: kp.privateKey, publicKey: ct.pub }),
  outLen: (ct) => spki(ct.pub).length,
});

const KEM = [
  ...[[512, 'NIST L1'], [768, 'NIST L3'], [1024, 'NIST L5']].map(([n, level]) => ({
    id: `ML-KEM-${n}`, pq: true, level,
    keygen: () => crypto.generateKeyPairSync(`ml-kem-${n}`),
    encaps: (kp) => crypto.encapsulate(kp.publicKey),
    decaps: (kp, ct) => crypto.decapsulate(kp.privateKey, ct.ciphertext),
    outLen: (ct) => ct.ciphertext.length,
  })),
  { id: 'X25519', base: true, level: '≈128-bit', ...dh(xKG) },
  { id: 'ECDH P-256', level: '≈128-bit', ...dh(ecKG) },
  ...[2048, 3072].map((b) => ({
    id: `RSA-${b} OAEP`, level: b === 2048 ? '≈112-bit' : '≈128-bit', keygen: rsaKG(b),
    encaps: (kp) => ({ ct: crypto.publicEncrypt({ key: kp.publicKey, oaepHash: 'sha256' }, crypto.randomBytes(32)) }),
    decaps: (kp, ct) => crypto.privateDecrypt({ key: kp.privateKey, oaepHash: 'sha256' }, ct.ct),
    outLen: (ct) => ct.ct.length,
  })),
];

const pss = crypto.constants.RSA_PKCS1_PSS_PADDING;
const SIG = [
  ...[[44, 'NIST L2'], [65, 'NIST L3'], [87, 'NIST L5']].map(([n, level]) => ({
    id: `ML-DSA-${n}`, pq: true, level,
    keygen: () => crypto.generateKeyPairSync(`ml-dsa-${n}`),
    sign: (kp) => crypto.sign(null, msg, kp.privateKey),
    verify: (kp, s) => crypto.verify(null, msg, kp.publicKey, s),
  })),
  {
    id: 'Ed25519', base: true, level: '≈128-bit', keygen: () => crypto.generateKeyPairSync('ed25519'),
    sign: (kp) => crypto.sign(null, msg, kp.privateKey), verify: (kp, s) => crypto.verify(null, msg, kp.publicKey, s)
  },
  {
    id: 'ECDSA P-256', level: '≈128-bit', keygen: ecKG,
    sign: (kp) => crypto.sign('sha256', msg, kp.privateKey), verify: (kp, s) => crypto.verify('sha256', msg, kp.publicKey, s)
  },
  ...[2048, 3072].map((b) => ({
    id: `RSA-${b} PSS`, level: b === 2048 ? '≈112-bit' : '≈128-bit', keygen: rsaKG(b),
    sign: (kp) => crypto.sign('sha256', msg, { key: kp.privateKey, padding: pss }),
    verify: (kp, s) => crypto.verify('sha256', msg, { key: kp.publicKey, padding: pss }, s),
  })),
];

function measure(group, d) {
  globalThis.gc?.();
  const rss0 = process.memoryUsage().rss;
  const kp = d.keygen();
  const sizes = { pub: spki(kp.publicKey).length, priv: kp.privateKey.export({ type: 'pkcs8', format: 'der' }).length };
  const ops = { keygen: bench(d.keygen) };
  if (group === 'kem') {
    const ct = d.encaps(kp);
    sizes.out = d.outLen(ct);
    ops.encaps = bench(() => d.encaps(kp));
    ops.decaps = bench(() => d.decaps(kp, ct));
  } else {
    const s = d.sign(kp);
    if (!d.verify(kp, s)) throw new Error('signature did not verify');
    sizes.out = s.length;
    ops.sign = bench(() => d.sign(kp));
    ops.verify = bench(() => d.verify(kp, s));
  }
  const rssMB = Math.max(0, (process.memoryUsage().rss - rss0) / 1048576);
  return { name: d.id, pq: !!d.pq, base: !!d.base, level: d.level, sizes, ops, rssMB };
}

const result = {
  meta: {
    node: process.version, openssl: process.versions.openssl, platform: `${os.platform()} ${os.arch()}`,
    cpu: os.cpus()[0]?.model ?? 'unknown', cores: os.cpus().length, date: new Date().toISOString().slice(0, 16).replace('T', ' '), budgetMs: BUDGET_MS
  },
  kem: [], sig: [],
};

for (const [g, list] of [['kem', KEM], ['sig', SIG]]) {
  for (const d of list) {
    process.stdout.write(`[${g}] ${d.id.padEnd(16)} `);
    try { result[g].push(measure(g, d)); console.log('done'); }
    catch (e) { console.log(`skipped (${e.message})`); }
  }
}

fs.mkdirSync(path.join(here, 'web/data'), { recursive: true });
fs.writeFileSync(path.join(here, 'results.json'), JSON.stringify(result, null, 2));
fs.writeFileSync(path.join(here, 'web/data/results.js'), `window.BENCH = ${JSON.stringify(result)};\n`);

for (const g of ['kem', 'sig']) {
  console.log(`\n${g.toUpperCase()}`);
  console.table(result[g].map((r) => ({
    algorithm: r.name, pub: r.sizes.pub, priv: r.sizes.priv, out: r.sizes.out,
    ...Object.fromEntries(Object.entries(r.ops).map(([k, v]) => [`${k} ms`, +v.ms.toFixed(4)])),
  })));
}
console.log('\nSaved results.json and web/data/results.js. Open web/index.html in a browser.');
