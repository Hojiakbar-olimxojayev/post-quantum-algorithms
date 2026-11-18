# PQC benchmark: ML-KEM / ML-DSA vs RSA and elliptic curves

Requires Node.js 24.7+ (you have 24.12).

1. `npm run bench` (or `node --expose-gc benchmark.mjs`) -> writes results.json and web/data/results.js
2. Open `web/index.html` in a browser (double-click is enough).
3. Optional: `BUDGET_MS=1000 npm run bench` for steadier numbers (default 500 ms per operation).

Switch language (EN/UZ), light/dark mode, KEM/signature view and log scale at the top of the page.
Use "Load results.json" to show results from another machine.
