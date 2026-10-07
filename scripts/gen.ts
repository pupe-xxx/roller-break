// ステージを作って src/game/levels.gen.ts に書き出す。
// 使い方: npm run gen
// 乱数の種は固定なので、何度実行しても同じステージができる。段階（TIERS）を変えた時だけ中身が変わる。
import { writeFileSync } from 'node:fs';
import { boardCells, dirTo, keyOf, type Hex } from '../src/game/hex';
import { createState, fire, type Level, type State } from '../src/game/rules';
import { TooManyStates, solve } from '../src/game/solve';
import { createRng, type Rng } from '../src/kit/rng';

type Range = readonly [min: number, max: number];

interface Tier {
  radius: number;
  rollers: Range;
  targets: Range;
  /** 壁の数。壁は転師と的の間にだけ置く */
  walls: Range;
  heavy: Range;
  /** 向きを変える板の数 */
  plates: Range;
  par: Range;
  /** 転師を押さないと、最少の発射数では解けないステージだけ残す */
  needPush?: boolean;
  /** 板が無いと、最少の発射数では解けないステージだけ残す */
  needPlate?: boolean;
  /** 当たるものをでたらめに撃って解ける割合が、これより高いステージは外す */
  maxLucky: number;
  count: number;
}

// 後ろの段階ほど、盤が広く、でたらめに撃って解ける割合が低い。
// 並びは src/game/levels.ts が決める（段階の間に、押す・板を覚える手作りのステージが入る）ので、数を変えたらそちらも直す
const TIERS: Tier[] = [
  // 壁と重いタイヤだけ
  { radius: 2, rollers: [1, 2], targets: [3, 4], walls: [3, 5], heavy: [1, 1], plates: [0, 0], par: [4, 5], maxLucky: 0.4, count: 3 },
  { radius: 3, rollers: [1, 2], targets: [4, 5], walls: [5, 8], heavy: [1, 1], plates: [0, 0], par: [5, 6], maxLucky: 0.25, count: 2 },
  // 転師を押す
  { radius: 3, rollers: [2, 2], targets: [4, 5], walls: [4, 7], heavy: [0, 1], plates: [0, 0], par: [5, 7], maxLucky: 0.15, needPush: true, count: 4 },
  // 板で曲げる
  { radius: 3, rollers: [1, 2], targets: [4, 5], walls: [4, 7], heavy: [0, 1], plates: [1, 2], par: [5, 7], maxLucky: 0.15, needPlate: true, count: 4 },
  // 両方
  { radius: 4, rollers: [2, 3], targets: [5, 7], walls: [6, 10], heavy: [1, 2], plates: [1, 3], par: [6, 8], maxLucky: 0.05, needPush: true, needPlate: true, count: 6 },
];

const between = (rng: Rng, [min, max]: Range) => min + rng.int(max - min + 1);

function shuffle<T>(rng: Rng, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/**
 * どれかの的のまっすぐ先にあるマス。壁と板はここにだけ置く。
 * 転師は押されて動くので、「今の転師と的の間」だけでは足りない。的と同じ線の上なら、どこかで撃つ線に関わる。
 */
function cellsInLine(targets: Hex[], radius: number): Hex[] {
  return boardCells(radius).filter((cell) => targets.some((target) => dirTo(cell, target) >= 0));
}

function randomLevel(rng: Rng, tier: Tier): Level | null {
  const cells = shuffle(rng, boardCells(tier.radius));
  const rollers = cells.splice(0, between(rng, tier.rollers));
  const targets = cells.splice(0, between(rng, tier.targets));
  // 押すことも板も無い段階では、どの転師のまっすぐ先にも無い的があれば解けない
  const moving = tier.needPush || tier.plates[1] > 0;
  if (!moving && !targets.every((target) => rollers.some((roller) => dirTo(roller, target) >= 0))) return null;
  const taken = new Set([...rollers, ...targets].map(([q, r]) => keyOf(q, r)));
  const spots = shuffle(rng, cellsInLine(targets, tier.radius).filter(([q, r]) => !taken.has(keyOf(q, r))));
  const plates = spots.splice(0, between(rng, tier.plates)).map(([q, r]) => [q, r, rng.next() < 0.5 ? 1 : -1] as const);
  const walls = spots.slice(0, between(rng, tier.walls)).map(([q, r]) => [q, r, rng.next() < 0.35 ? 2 : 1] as const);
  const level: Level = { radius: tier.radius, rollers, targets, walls, heavy: between(rng, tier.heavy), par: 0 };
  return plates.length > 0 ? { ...level, plates } : level;
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
 * 「盤が変わる発射」の中から毎回でたらめに選んで撃った時に、発射数の上限までに倒しきれる割合。
 * これが高いステージは、当たるものを順に撃つだけで解けてしまう。
 */
function luckyRate(level: Level, par: number): number {
  const memo = new Map<string, number>();
  const rate = (state: State): number => {
    if (memo.size > MAX_STATES * 4) throw new TooManyStates();
    if (state.status === 'cleared') return 1;
    if (state.status === 'failed') return 0;
    const key = `${state.shots}|${state.heavyLeft}|${state.targets.join(';')}|${Object.entries(state.walls).sort().join(';')}|${state.rollers.join(';')}|${Object.entries(state.plates).sort().join(';')}`;
    const known = memo.get(key);
    if (known !== undefined) return known;
    const next: State[] = [];
    state.rollers.forEach((_, roller) => {
      for (let dir = 0; dir < 6; dir++) {
        for (const kind of ['light', 'heavy'] as const) {
          const result = fire(state, { roller, dir, kind });
          if (result?.changed) next.push(result.state);
        }
      }
    });
    const value = next.length === 0 ? 0 : next.reduce((sum, s) => sum + rate(s), 0) / next.length;
    memo.set(key, value);
    return value;
  };
  return rate(createState({ ...level, par }));
}

/**
 * 1つの候補で調べる盤面の数の上限。転師が押されて動くと盤面の数が急に増えるので、重すぎる候補は捨てる
 * （残ったステージは、テストでも短い時間で解ける）
 */
const MAX_STATES = 20000;
const CAP = { maxStates: MAX_STATES };

/** 面白いステージだけ通す。通ったら par を入れて返す */
function accept(level: Level, tier: Tier): Level | null {
  // 最初から狙える的が多いと、順に撃つだけになる。狙えるのは3つに1つまで
  if (openTargets(level) > Math.max(1, Math.floor(level.targets.length / 3))) return null;
  try {
    const best = solve(level, tier.par[1], CAP);
    if (!best || best.shots.length < tier.par[0]) return null;
    const par = best.shots.length;

    // 置いてある物が、どれも最少で解くのに要ること（無くても同じ数で解けるなら、飾りになる）
    // 重いタイヤ
    if (level.heavy > 0 && solve({ ...level, heavy: 0 }, par, CAP)) return null;
    // 転師を押すこと
    if (tier.needPush && solve(level, par, { push: false, ...CAP })) return null;
    // 板
    if (tier.needPlate && solve({ ...level, plates: [] }, par, CAP)) return null;
    // 転師の1人1人（撃つ役でも、押されて止める役でもよい）
    if (level.rollers.length > 1) {
      for (const roller of level.rollers) {
        if (solve({ ...level, rollers: level.rollers.filter((r) => r !== roller) }, par, CAP)) return null;
      }
    }
    // 当たるものをでたらめに撃っても解けるステージは外す。壁を崩す場所・重いタイヤの使い所・どの転師で撃つかを
    // 間違えると発射数が足りなくなる、というステージだけが残る
    if (luckyRate(level, par) > tier.maxLucky) return null;
    return { ...level, par };
  } catch (error) {
    if (error instanceof TooManyStates) return null;
    throw error;
  }
}

const levels: Level[] = [];
TIERS.forEach((tier, t) => {
  const rng = createRng(1000 + t);
  let found = 0;
  const began = performance.now();
  for (let tries = 0; found < tier.count && tries < 400000; tries++) {
    const candidate = randomLevel(rng, tier);
    const level = candidate && accept(candidate, tier);
    if (!level) continue;
    levels.push(level);
    found++;
    const lucky = Math.round(luckyRate(level, level.par) * 100);
    console.log(`  段階 ${t + 1}: 的 ${level.targets.length}（最初から狙える ${openTargets(level)}）・壁 ${level.walls.length}・板 ${level.plates?.length ?? 0}・par ${level.par}・でたらめで解ける ${lucky}%・${tries + 1} 回目`);
  }
  console.log(`段階 ${t + 1}: ${found} / ${tier.count}（${((performance.now() - began) / 1000).toFixed(0)} 秒）`);
});

const lines = levels.map((l) => `  ${JSON.stringify(l)},`);
writeFileSync(
  new URL('../src/game/levels.gen.ts', import.meta.url),
  `// scripts/gen.ts が書き出したステージ。手で直さない（直したい時は scripts/gen.ts を変えて npm run gen）。\nimport type { Level } from './rules';\n\nexport const GENERATED: Level[] = [\n${lines.join('\n')}\n];\n`,
);
console.log(`${levels.length} ステージを書き出した: src/game/levels.gen.ts`);
