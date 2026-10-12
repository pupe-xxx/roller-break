// ステージを作って src/game/levels.gen.ts に書き出す。
// 使い方: npm run gen（全部作り直す）/ npm run gen -- 1 2 3（その段階だけ作り直し、ほかの段階は今のファイルのまま残す）
// 乱数の種は固定なので、何度実行しても同じステージができる。段階（TIERS）を変えた時だけ中身が変わる。
import { writeFileSync } from 'node:fs';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
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
  // 41 より後に出てくる要素の数。書かなければ置かない（書かない段階は、乱数の使い方も前と同じ）
  iron?: Range;
  /** 的のうち、爆弾にする数 */
  bombs?: Range;
  /** 的のうち、盾付きにする数 */
  shields?: Range;
  /** ワープ穴の組の数 */
  warps?: Range;
  mirrors?: Range;
  /** その段階で覚えた要素。これが無いと（ふつうの的・ふつうの盤にすると）、同じ発射数では解けないステージだけ残す */
  need?: 'iron' | 'bombs' | 'shields' | 'warps' | 'mirrors';
  /** 最初から狙える的の数の上限。書かなければ、的3つに1つまで */
  maxOpen?: number;
  /** 押すのを覚える前の段階。転師は押されても動かない */
  noPush?: boolean;
  /** 板が無いと、最少の発射数では解けないステージだけ残す */
  needPlate?: boolean;
  /**
   * 半分のステージは、板で曲げたタイヤで転師を押さないと、最少の発射数では解けないものにする。
   * 残りの半分は、それを使わずに解ける（別の難しさのステージ）。仕事の番号の偶数・奇数で分ける
   */
  bentPushHalf?: boolean;
  /** 1つの候補で調べる盤面の数の上限。書かなければ MAX_STATES。発射数の多い段階は増やす */
  maxStates?: number;
  /** 当たるものをでたらめに撃って解ける割合が、これより高いステージは外す */
  maxLucky: number;
  /** 最初の1発で、盤が変わる撃ち方（撃った後の盤面が違うもの）がこれより少ないステージは外す。選べる手が少ないと、迷わずに解ける */
  minChoices?: number;
  count: number;
}

// 後ろの段階ほど、盤が広く、でたらめに撃って解ける割合が低い。
// 並びは src/game/levels.ts が決める（段階の間に、新しいルールを覚える手作りのステージが入る）ので、数を変えたらそちらも直す
const TIERS: Tier[] = [
  // 1〜20。軽いタイヤだけ（1。壁も押すことも無いと、どの発射も的を1つ倒すので、でたらめに撃っても解ける。練習なので、それでよい）→ 壁（1）→ 壁と重いタイヤ（5）→ 転師を押す（8）
  { radius: 2, rollers: [2, 2], targets: [3, 4], walls: [0, 0], heavy: [0, 0], plates: [0, 0], par: [3, 4], maxLucky: 1, minChoices: 2, maxOpen: 2, noPush: true, count: 1 },
  { radius: 2, rollers: [2, 2], targets: [3, 4], walls: [2, 4], heavy: [0, 0], plates: [0, 0], par: [4, 5], maxLucky: 0.2, minChoices: 4, noPush: true, count: 1 },
  { radius: 3, rollers: [2, 2], targets: [4, 5], walls: [4, 7], heavy: [1, 1], plates: [0, 0], par: [5, 6], maxLucky: 0.15, minChoices: 6, noPush: true, count: 5 },
  { radius: 3, rollers: [2, 2], targets: [4, 5], walls: [4, 7], heavy: [0, 1], plates: [0, 0], par: [5, 7], maxLucky: 0.08, minChoices: 6, needPush: true, count: 8 },
  // 21〜40。板で曲げる（8）→ 押すと板の両方（12）
  { radius: 3, rollers: [1, 2], targets: [4, 5], walls: [4, 7], heavy: [0, 1], plates: [1, 2], par: [5, 7], maxLucky: 0.08, minChoices: 6, needPlate: true, count: 8 },
  { radius: 3, rollers: [2, 2], targets: [4, 6], walls: [4, 8], heavy: [0, 1], plates: [1, 2], par: [6, 7], maxLucky: 0.05, minChoices: 6, needPush: true, needPlate: true, count: 12 },
  // 41〜50。盤が広くなる。半分は、41 で覚える「板で曲げて押す」を使わないと最少では解けない（9）
  { radius: 4, rollers: [2, 2], targets: [5, 7], walls: [6, 10], heavy: [1, 2], plates: [2, 3], par: [7, 9], maxLucky: 0.02, minChoices: 8, needPush: true, needPlate: true, bentPushHalf: true, maxStates: 60000, count: 9 },
  // 51〜60。鉄の壁（9）
  { radius: 4, rollers: [2, 2], targets: [5, 7], walls: [5, 8], heavy: [1, 2], plates: [1, 3], iron: [1, 3], par: [7, 9], maxLucky: 0.02, minChoices: 8, bentPushHalf: true, need: 'iron', maxStates: 60000, count: 9 },
  // 61〜70。爆弾の的（9）
  { radius: 4, rollers: [2, 3], targets: [6, 8], walls: [6, 9], heavy: [1, 2], plates: [1, 3], iron: [0, 2], bombs: [1, 2], par: [8, 10], maxLucky: 0.01, minChoices: 10, need: 'bombs', maxStates: 60000, count: 9 },
  // 71〜80。盾付きの的（9）
  { radius: 4, rollers: [2, 3], targets: [6, 8], walls: [6, 9], heavy: [1, 2], plates: [1, 3], iron: [0, 2], bombs: [0, 1], shields: [1, 2], par: [8, 10], maxLucky: 0.01, minChoices: 10, need: 'shields', maxStates: 60000, count: 9 },
  // 81〜90。ワープ穴（9）
  { radius: 4, rollers: [2, 3], targets: [6, 8], walls: [6, 10], heavy: [1, 2], plates: [1, 2], iron: [0, 2], bombs: [0, 1], shields: [0, 1], warps: [1, 2], par: [9, 11], maxLucky: 0.01, minChoices: 10, need: 'warps', maxStates: 60000, count: 9 },
  // 91〜100。跳ね返す板。転師が3人（9）
  { radius: 4, rollers: [3, 3], targets: [6, 8], walls: [6, 10], heavy: [1, 2], plates: [1, 2], iron: [0, 2], bombs: [0, 1], shields: [0, 1], warps: [0, 1], mirrors: [1, 2], par: [9, 11], maxLucky: 0.01, minChoices: 10, need: 'mirrors', maxStates: 60000, count: 9 },
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
  const level: Level = { radius: tier.radius, rollers, targets, walls, heavy: between(rng, tier.heavy), par: 0, ...(tier.noPush ? { push: false } : {}) };
  if (plates.length > 0) level.plates = plates;
  // 41 より後の要素。鉄の壁と跳ね返す板は、壁と同じく的の線の上に置く。ワープ穴は、空いているどこにでも置く
  const rest = spots.slice(walls.length);
  // ワープ穴は、転師・的・板・壁・鉄の壁・跳ね返す板のどれとも重ならないマスに置く（1つのマスに置ける物は1つ）
  const used = new Set([...plates, ...walls, ...rest].map(([q, r]) => keyOf(q, r)));
  const free = cells.filter(([q, r]) => !taken.has(keyOf(q, r)) && !used.has(keyOf(q, r)));
  const add = (range: Range | undefined, from: Hex[], per = 1) => (range ? from.splice(0, between(rng, range) * per) : []);
  const iron = add(tier.iron, rest);
  const mirrors = add(tier.mirrors, rest);
  const warpCells = add(tier.warps, free, 2);
  const marked = shuffle(rng, targets.slice());
  const bombs = add(tier.bombs, marked);
  const shields = add(tier.shields, marked);
  if (iron.length > 0) level.iron = iron;
  if (mirrors.length > 0) level.mirrors = mirrors;
  if (warpCells.length > 0) level.warps = Array.from({ length: warpCells.length / 2 }, (_, i) => [...warpCells[i * 2], ...warpCells[i * 2 + 1]] as const);
  if (bombs.length > 0) level.bombs = bombs;
  if (shields.length > 0) level.shields = shields;
  return level;
}

/** 最初の1発で、盤が変わる撃ち方の数（撃った後の盤面が同じものは1つと数える） */
function choices(level: Level): number {
  const start = createState(level, Infinity);
  const seen = new Set<string>();
  level.rollers.forEach((_, roller) => {
    for (let dir = 0; dir < 6; dir++) {
      for (const kind of ['light', 'heavy'] as const) {
        const result = fire(start, { roller, dir, kind });
        if (result?.changed) seen.add(JSON.stringify([result.state.targets, result.state.walls, result.state.rollers, result.state.plates, result.state.heavyLeft]));
      }
    }
  });
  return seen.size;
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
 * 「盤が変わる発射」の中から毎回でたらめに選んで撃った時に、★2 が取れる発射数までに倒しきれる割合。
 * これが高いステージは、当たるものを順に撃つだけで解けてしまう。
 */
function luckyRate(level: Level, par: number, maxStates = MAX_STATES): number {
  const memo = new Map<string, number>();
  const rate = (state: State): number => {
    if (memo.size > maxStates * 4) throw new TooManyStates();
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
  // 撃てる数は ★2 が取れる所まで（最少＋1発）で数える。全部（最少＋3発）で数えると、でたらめでもほとんど解けてしまう
  return rate(createState({ ...level, par }, par + 1));
}

/**
 * 1つの候補で調べる盤面の数の上限。転師が押されて動くと盤面の数が急に増えるので、重すぎる候補は捨てる
 * （残ったステージは、テストでも短い時間で解ける）
 */
const MAX_STATES = 20000;

/** 面白いステージだけ通す。通ったら par を入れて返す */
function accept(level: Level, tier: Tier, bentPush = false): Level | null {
  // 最初から狙える的が多いと、順に撃つだけになる。狙えるのは3つに1つまで
  if (openTargets(level) > (tier.maxOpen ?? Math.max(1, Math.floor(level.targets.length / 3)))) return null;
  if (tier.minChoices !== undefined && choices(level) < tier.minChoices) return null;
  const CAP = { maxStates: tier.maxStates ?? MAX_STATES };
  try {
    const best = solve(level, tier.par[1], CAP);
    if (!best || best.shots.length < tier.par[0]) return null;
    const par = best.shots.length;

    // 置いてある物が、どれも最少で解くのに要ること（無くても同じ数で解けるなら、飾りになる）
    // 重いタイヤ。1つ減らすと最少では解けない数だけ持たせる（余る重いタイヤを置かない）
    if (level.heavy > 0 && solve({ ...level, heavy: level.heavy - 1 }, par, CAP)) return null;
    // 転師を押すこと
    if (tier.needPush && solve(level, par, { push: false, ...CAP })) return null;
    // 板
    if (tier.needPlate && solve({ ...level, plates: [] }, par, CAP)) return null;
    // 板で曲げて押すこと
    if (bentPush && solve(level, par, { bentPush: false, ...CAP })) return null;
    // その段階で覚えた要素。取り除くと、同じ数では解けないか、もっと少ない数で解ける（どちらでもなければ、飾りになる）
    if (tier.need) {
      const plain: Level = { ...level, [tier.need]: [] };
      if (solve(plain, par, CAP)?.shots.length === par) return null;
    }
    // 転師の1人1人（撃つ役でも、押されて止める役でもよい）
    if (level.rollers.length > 1) {
      for (const roller of level.rollers) {
        if (solve({ ...level, rollers: level.rollers.filter((r) => r !== roller) }, par, CAP)) return null;
      }
    }
    // 当たるものをでたらめに撃っても解けるステージは外す。壁を崩す場所・重いタイヤの使い所・どの転師で撃つかを
    // 間違えると発射数が足りなくなる、というステージだけが残る
    if (luckyRate(level, par, CAP.maxStates) > tier.maxLucky) return null;
    return { ...level, par };
  } catch (error) {
    if (error instanceof TooManyStates) return null;
    throw error;
  }
}

/** 1つの仕事で作るステージの数。段階をこの数ずつの仕事に分けて、別々のスレッドで作る（重い段階が速くなる） */
const PER_JOB = 2;

interface Job {
  tier: number;
  /** 段階の中の何番目の仕事か。乱数の種はこれで決まる */
  part: number;
  count: number;
  /** 板で曲げて押さないと解けないステージを作る仕事か */
  bentPush: boolean;
}

/** 作り直す段階（0 から数える）。番号を渡さなければ全部 */
const only = process.argv.slice(2).map((n) => Number(n) - 1);
const redo = (t: number) => only.length === 0 || only.includes(t);

const jobs: Job[] = TIERS.flatMap((tier, t) =>
  !redo(t)
    ? []
    : Array.from({ length: Math.ceil(tier.count / PER_JOB) }, (_, part) => ({
        tier: t,
        part,
        count: Math.min(PER_JOB, tier.count - part * PER_JOB),
        bentPush: !!tier.bentPushHalf && part % 2 === 0,
      })),
);

/** 1つの仕事の分のステージを作る */
function makeJob({ tier: t, part, count, bentPush }: Job): Level[] {
  const tier = TIERS[t];
  const rng = createRng(1000 + t * 100 + part);
  const found: Level[] = [];
  const began = performance.now();
  for (let tries = 0; found.length < count && tries < 400000; tries++) {
    const candidate = randomLevel(rng, tier);
    const level = candidate && accept(candidate, tier, bentPush);
    if (!level) continue;
    found.push(level);
    const lucky = Math.round(luckyRate(level, level.par, tier.maxStates) * 100);
    console.log(`  段階 ${t + 1}-${part + 1}（${found.length}/${count}）: 的 ${level.targets.length}（最初から狙える ${openTargets(level)}）・壁 ${level.walls.length}・板 ${level.plates?.length ?? 0}・選べる手 ${choices(level)}・par ${level.par}・でたらめで解ける ${lucky}%${bentPush ? '・板で曲げて押す' : ''}・${tries + 1} 回目`);
  }
  console.log(`段階 ${t + 1}-${part + 1}: ${found.length} / ${count}（${((performance.now() - began) / 1000).toFixed(0)} 秒）`);
  return found;
}

// 仕事ごとに別のスレッドで作る（仕事ごとに乱数の種が決まっているので、並べて作っても結果は同じ）
if (!isMainThread) {
  parentPort!.postMessage(makeJob(workerData as Job));
  process.exit(0);
}
const done = await Promise.all(
  jobs.map(
    (job) =>
      new Promise<Level[]>((resolve, reject) => {
        const worker = new Worker(new URL(import.meta.url), { workerData: job });
        worker.once('message', resolve);
        worker.once('error', reject);
      }),
  ),
);
// 段階ごとにまとめて、段階の中は par の小さい順に並べる（同じ段階の中でも、だんだん難しくなるように）
// 作り直さない段階は、今のファイルから段階の数ずつ切り出して、そのまま使う
const { GENERATED } = await import('../src/game/levels.gen');
const starts = TIERS.map((_, t) => TIERS.slice(0, t).reduce((sum, tier) => sum + tier.count, 0));
const parts = TIERS.map((tier, t) =>
  redo(t) ? done.filter((_, j) => jobs[j].tier === t).flat().sort((a, b) => a.par - b.par) : GENERATED.slice(starts[t], starts[t] + tier.count),
);
const levels = parts.flat();
const missing = TIERS.reduce((sum, tier, t) => sum + tier.count - parts[t].length, 0);
// 足りないまま書き出すと、段階の切れ目がずれて、次に一部だけ作り直す時に壊れる
if (missing > 0) {
  console.log(`足りない: ${missing} ステージ。TIERS の条件をゆるめる（ファイルは書き換えていない）`);
  process.exit(1);
}

const lines = levels.map((l) => `  ${JSON.stringify(l)},`);
writeFileSync(
  new URL('../src/game/levels.gen.ts', import.meta.url),
  `// scripts/gen.ts が書き出したステージ。手で直さない（直したい時は scripts/gen.ts を変えて npm run gen）。\nimport type { Level } from './rules';\n\nexport const GENERATED: Level[] = [\n${lines.join('\n')}\n];\n`,
);
console.log(`${levels.length} ステージを書き出した: src/game/levels.gen.ts`);
