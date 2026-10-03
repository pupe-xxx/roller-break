// ステージを作って src/game/levels.gen.ts に書き出す。
// 使い方: npm run gen
// 乱数の種は固定なので、何度実行しても同じステージができる。段階（TIERS）を変えた時だけ中身が変わる。
import { writeFileSync } from 'node:fs';
import { boardCells, dirTo, type Hex } from '../src/game/hex';
import type { Level } from '../src/game/rules';
import { solve } from '../src/game/solve';
import { createRng, type Rng } from '../src/kit/rng';

type Range = readonly [min: number, max: number];

interface Tier {
  radius: number;
  rollers: Range;
  targets: Range;
  walls: Range;
  heavy: Range;
  par: Range;
  count: number;
}

// 後ろの段階ほど、盤が広く、最少の発射数が多い
const TIERS: Tier[] = [
  { radius: 2, rollers: [1, 1], targets: [3, 4], walls: [2, 4], heavy: [0, 0], par: [3, 4], count: 4 },
  { radius: 3, rollers: [1, 1], targets: [4, 5], walls: [4, 7], heavy: [0, 1], par: [4, 5], count: 5 },
  { radius: 3, rollers: [2, 2], targets: [4, 6], walls: [5, 8], heavy: [0, 1], par: [4, 5], count: 5 },
  { radius: 4, rollers: [2, 2], targets: [5, 7], walls: [7, 12], heavy: [1, 2], par: [5, 6], count: 4 },
  { radius: 4, rollers: [2, 2], targets: [6, 8], walls: [8, 12], heavy: [1, 2], par: [6, 6], count: 3 },
];

const between = (rng: Rng, [min, max]: Range) => min + rng.int(max - min + 1);
const factorial = (n: number): number => (n <= 1 ? 1 : n * factorial(n - 1));

function randomLevel(rng: Rng, tier: Tier): Level {
  const cells: Hex[] = boardCells(tier.radius);
  for (let i = cells.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  const take = (n: number) => cells.splice(0, n);
  return {
    radius: tier.radius,
    rollers: take(between(rng, tier.rollers)),
    targets: take(between(rng, tier.targets)),
    walls: take(between(rng, tier.walls)).map(([q, r]) => [q, r, rng.next() < 0.3 ? 2 : 1] as const),
    heavy: between(rng, tier.heavy),
    par: 0,
  };
}

/** 面白いステージだけ通す。通ったら par を入れて返す */
function accept(level: Level, tier: Tier): Level | null {
  // どの転師のまっすぐ先にも無い的があれば、解けない（総当たりの前に落として速くする）
  if (!level.targets.every((target) => level.rollers.some((roller) => dirTo(roller, target) >= 0))) return null;
  const best = solve(level, tier.par[1]);
  if (!best) return null;
  const par = best.shots.length;
  if (par < tier.par[0]) return null;
  // 撃つ順番を選ばないステージは外す（どの順でも解けるなら、最少の撃ち方は par! 通りある）
  if (best.ways * 4 > factorial(par)) return null;
  // 重いタイヤがあるなら、無いと最少では解けないこと
  if (level.heavy > 0) {
    const without = solve({ ...level, heavy: 0 }, par);
    if (without) return null;
  }
  // 転師が複数いるなら、1人では最少で解けないこと
  if (level.rollers.length > 1) {
    for (const roller of level.rollers) {
      const others = level.rollers.filter((r) => r !== roller).map(([q, r]) => [q, r, 9] as const);
      if (solve({ ...level, rollers: [roller], walls: [...level.walls, ...others] }, par)) return null;
    }
  }
  return { ...level, par };
}

const levels: Level[] = [];
TIERS.forEach((tier, t) => {
  const rng = createRng(1000 + t);
  let found = 0;
  for (let tries = 0; found < tier.count && tries < 400000; tries++) {
    const level = accept(randomLevel(rng, tier), tier);
    if (!level) continue;
    levels.push(level);
    found++;
  }
  console.log(`段階 ${t + 1}: ${found} / ${tier.count}`);
});

const lines = levels.map((l) => `  ${JSON.stringify(l)},`);
writeFileSync(
  new URL('../src/game/levels.gen.ts', import.meta.url),
  `// scripts/gen.ts が書き出したステージ。手で直さない（直したい時は scripts/gen.ts を変えて npm run gen）。\nimport type { Level } from './rules';\n\nexport const GENERATED: Level[] = [\n${lines.join('\n')}\n];\n`,
);
console.log(`${levels.length} ステージを書き出した: src/game/levels.gen.ts`);
