// 動作記録（tests/golden/golden.json）と、今のルールの動きが一致するかを確かめる。
// ここが失敗したら、ルールか CPU の動きが変わっている。
// 意図した変更なら `npm run record` で記録を取り直す。意図していなければ、変更を見直す。
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { diffTraces, type Trace } from '../src/kit/golden';
import { goldenCases } from './golden/cases';

const recorded = JSON.parse(readFileSync(new URL('./golden/golden.json', import.meta.url), 'utf8')) as {
  cases: Record<string, Trace>;
};

it(`動作記録（${Object.keys(recorded.cases).length} 場面）と一致する`, () => {
  expect(diffTraces(recorded.cases, goldenCases())).toEqual([]);
});
