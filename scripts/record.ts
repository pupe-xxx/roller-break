// 動作記録（tests/golden/golden.json）を取り直す。
// 使い方: npm run record
// ルールや CPU を意図して変えた時だけ実行する。実行する前に、変わってよい理由を確かめること。
import { writeFileSync } from 'node:fs';
import { goldenCases } from '../tests/golden/cases';

const cases = goldenCases();
// 1つの場面を1行に書く（取り直した時に、どの場面が変わったかを差分で見やすくする）
const lines = Object.entries(cases).map(([name, trace]) => `${JSON.stringify(name)}: ${JSON.stringify(trace)}`);
writeFileSync(new URL('../tests/golden/golden.json', import.meta.url), `{"cases": {\n${lines.join(',\n')}\n}}\n`);

const steps = Object.values(cases).reduce((sum, trace) => sum + trace.length, 0);
console.log(`${lines.length} 場面・${steps} 件の状態を記録した: tests/golden/golden.json`);
