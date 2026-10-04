// ステージを作って src/game/levels.gen.ts に書き出す。
// 使い方: npm run gen
// 乱数の種は固定なので、何度実行しても同じステージができる。段階（TIERS）を変えた時だけ中身が変わる。
import { writeFileSync } from 'node:fs';
import { DIRS, boardCells, dirTo, inBoard, keyOf, type Hex } from '../src/game/hex';
import { createState, fire, type Level, type State } from '../src/game/rules';
import { solve } from '../src/game/solve';
import { createRng, type Rng } from '../src/kit/rng';

type Range = readonly [min: number, max: number];

interface Tier {
  radius: number;
  rollers: Range;
  targets: Range;
  /** 壁の数。壁は転師と的の間にだけ置く */
  walls: Range;
  heavy: Range;
  par: Range;
  /** 当たるものをでたらめに撃って解ける割合が、これより高いステージは外す */
  maxLucky: number;
  count: number;
}

// 後ろの段階ほど、盤が広く、最少の発射数が多く、でたらめに撃って解ける割合が低い
const TIERS: Tier[] = [
  { radius: 2, rollers: [1, 2], targets: [3, 4], walls: [3, 5], heavy: [1, 1], par: [4, 5], maxLucky: 0.4, count: 4 },
  { radius: 3, rollers: [1, 2], targets: [4, 5], walls: [5, 8], heavy: [1, 1], par: [5, 6], maxLucky: 0.25, count: 5 },
  { radius: 3, rollers: [2, 2], targets: [4, 6], walls: [6, 10], heavy: [1, 2], par: [6, 7], maxLucky: 0.15, count: 5 },
  { radius: 4, rollers: [2, 2], targets: [5, 7], walls: [8, 12], heavy: [1, 2], par: [7, 8], maxLucky: 0.1, count: 4 },
  { radius: 4, rollers: [2, 3], targets: [6, 8], walls: [9, 13], heavy: [1, 2], par: [8, 9], maxLucky: 0.05, count: 3 },
];

const between = (rng: Rng, [min, max]: Range) => min + rng.int(max - min + 1);

function shuffle<T>(rng: Rng, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** 転師と的の間にあるマス。壁はここにだけ置く（ほかの場所の壁は、タイヤが通らないので効かない） */
function cellsBetween(rollers: Hex[], targets: Hex[], radius: number): Hex[] {
  const found = new Map<string, Hex>();
  for (const roller of rollers) {
    for (const target of targets) {
      const dir = dirTo(roller, target);
      if (dir < 0) continue;
      const [dq, dr] = DIRS[dir];
      for (let q = roller[0] + dq, r = roller[1] + dr; inBoard(q, r, radius) && !(q === target[0] && r === target[1]); q += dq, r += dr) {
        found.set(keyOf(q, r), [q, r]);
      }
    }
  }
  return [...found.values()];
}

function randomLevel(rng: Rng, tier: Tier): Level | null {
  const cells = shuffle(rng, boardCells(tier.radius));
  const rollers = cells.splice(0, between(rng, tier.rollers));
  const targets = cells.splice(0, between(rng, tier.targets));
  // どの転師のまっすぐ先にも無い的があれば、解けない
  if (!targets.every((target) => rollers.some((roller) => dirTo(roller, target) >= 0))) return null;
  const taken = new Set([...rollers, ...targets].map(([q, r]) => keyOf(q, r)));
  const spots = shuffle(rng, cellsBetween(rollers, targets, tier.radius).filter(([q, r]) => !taken.has(keyOf(q, r))));
  const walls = spots.slice(0, between(rng, tier.walls)).map(([q, r]) => [q, r, rng.next() < 0.35 ? 2 : 1] as const);
  return { radius: tier.radius, rollers, targets, walls, heavy: between(rng, tier.heavy), par: 0 };
}

/** 最初の1発（軽いタイヤ）で倒せる的の数 */
function openTargets(level: Level): number {
  const start = createState(level, Infinity);
  const hit = new Set<string>();
  level.rollers.forEach((_, roller) => {
    for (let dir = 0; dir < 6; dir++) {
      const result = fire(start, { roller, dir, kind: 'light' });
      for (const key of start.targets) if (result && !result.state.targets.includes(key)) hit.add(key);
    }
  });
  return hit.size;
}

/**
 * 「何かに当たる発射」の中から毎回でたらめに選んで撃った時に、発射数の上限までに倒しきれる割合。
 * これが高いステージは、当たるものを順に撃つだけで解けてしまう。
 */
function luckyRate(level: Level, par: number): number {
  const memo = new Map<string, number>();
  const rate = (state: State): number => {
    if (state.status === 'cleared') return 1;
    if (state.status === 'failed') return 0;
    const key = `${state.shots}|${state.heavyLeft}|${state.targets.join(';')}|${Object.entries(state.walls).sort().join(';')}`;
    const known = memo.get(key);
    if (known !== undefined) return known;
    const next: State[] = [];
    state.rollers.forEach((_, roller) => {
      for (let dir = 0; dir < 6; dir++) {
        for (const kind of ['light', 'heavy'] as const) {
          const result = fire(state, { roller, dir, kind });
          if (result && (result.hitAt.length > 0 || result.end === 'wall')) next.push(result.state);
        }
      }
    });
    const value = next.length === 0 ? 0 : next.reduce((sum, s) => sum + rate(s), 0) / next.length;
    memo.set(key, value);
    return value;
  };
  return rate(createState({ ...level, par }));
}

/** 面白いステージだけ通す。通ったら par を入れて返す */
function accept(level: Level, tier: Tier): Level | null {
  const best = solve(level, tier.par[1]);
  if (!best || best.shots.length < tier.par[0]) return null;
  const par = best.shots.length;

  // 最初から狙える的が多いと、順に撃つだけになる。狙えるのは3つに1つまで
  if (openTargets(level) > Math.max(1, Math.floor(level.targets.length / 3))) return null;
  // 当たるものをでたらめに撃っても解けるステージは外す。壁を崩す場所・重いタイヤの使い所・どの転師で撃つかを
  // 間違えると発射数が足りなくなる、というステージだけが残る
  if (luckyRate(level, par) > tier.maxLucky) return null;
  // 重いタイヤがあるなら、無いと最少では解けないこと
  if (level.heavy > 0 && solve({ ...level, heavy: 0 }, par)) return null;
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
    const candidate = randomLevel(rng, tier);
    const level = candidate && accept(candidate, tier);
    if (!level) continue;
    levels.push(level);
    found++;
    const lucky = Math.round(luckyRate(level, level.par) * 100);
    console.log(`  段階 ${t + 1}: 的 ${level.targets.length}（最初から狙える ${openTargets(level)}）・壁 ${level.walls.length}・par ${level.par}・でたらめで解ける ${lucky}%・${tries + 1} 回目`);
  }
  console.log(`段階 ${t + 1}: ${found} / ${tier.count}`);
});

const lines = levels.map((l) => `  ${JSON.stringify(l)},`);
writeFileSync(
  new URL('../src/game/levels.gen.ts', import.meta.url),
  `// scripts/gen.ts が書き出したステージ。手で直さない（直したい時は scripts/gen.ts を変えて npm run gen）。\nimport type { Level } from './rules';\n\nexport const GENERATED: Level[] = [\n${lines.join('\n')}\n];\n`,
);
console.log(`${levels.length} ステージを書き出した: src/game/levels.gen.ts`);
