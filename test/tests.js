// Tynn nettleser-renderer. All testlogikk ligger i suite.js (delt med jsc-kjøreren).
import { runTests } from './suite.js';

const out = document.getElementById('out');
const { passed, total, results } = runTests();

for (const r of results) {
  const div = document.createElement('div');
  div.className = r.pass ? 'p' : 'f';
  div.textContent = `${r.pass ? '✓' : '✗'} ${r.name}`;
  out.appendChild(div);
  if (!r.pass) {
    const pre = document.createElement('pre');
    pre.textContent =
      `actual:   ${JSON.stringify(r.actual)}\nexpected: ${JSON.stringify(r.expected)}`;
    out.appendChild(pre);
  }
}

const sum = document.createElement('div');
sum.className = passed === total ? 'p' : 'f';
sum.style.marginTop = '12px';
sum.textContent = `${passed}/${total} grønne`;
out.appendChild(sum);
