// Kjør: jsc -m test/run-jsc.js  (JavaScriptCore, ES-moduler)
import { runTests } from './suite.js';

const { passed, total, results } = runTests();
for (const r of results) {
  if (!r.pass) {
    print(`FAIL  ${r.name}`);
    if ('actual' in r) print(`        actual:   ${JSON.stringify(r.actual)}`);
    if ('expected' in r) print(`        expected: ${JSON.stringify(r.expected)}`);
  }
}
print(`\n${passed}/${total} grønne`);
if (passed !== total) throw new Error(`${total - passed} test(er) feilet`);
