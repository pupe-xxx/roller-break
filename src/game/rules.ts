// ルール。タイヤを転がして、的を全部倒す。
// このフォルダ（src/game）は画面の処理に触れない。document・Canvas・Math.random は使わない。
import { DIRS, hexOf, inBoard, keyOf, type Hex } from './hex';

export type TireKind = 'light' | 'heavy';
export type Status = 'playing' | 'cleared' | 'failed';

export interface Level {
  radius: number;
  rollers: Hex[];
  targets: Hex[];
  /** [q, r, 段数]。段数は 1 か 2 */
  walls: (readonly [q: number, r: number, stage: number])[];
  /** 向きを変える板。[q, r, 曲げる向き]。曲げる向きは 1（左へ 60°）か -1（右へ 60°） */
  plates?: (readonly [q: number, r: number, turn: number])[];
  /** 重いタイヤを撃てる回数 */
  heavy: number;
  /** ★3 になる発射数（最少の発射数） */
  par: number;
  /** false なら、転師は押されても動かない（押すルールを覚える前のステージ） */
  push?: boolean;
  /** 鉄の壁。どのタイヤでも壊れず、タイヤはそこで止まる */
  iron?: Hex[];
  /**
   * 爆弾。的とは別のマスに置き、倒さなくてもクリアできる。タイヤが当たると爆ぜて、タイヤはそこで止まる。
   * 周りの6マスの的を倒し、壁を1段削り、板と跳ね返す板を壊す（鉄の壁・ワープ穴・転師はそのまま）。巻き込んだ爆弾も続けて爆ぜる
   */
  bombs?: Hex[];
  /** 盾付きの的（targets にも入れる）。軽いタイヤでは倒れない（当たると止まる）。重いタイヤか爆弾で倒れる */
  shields?: Hex[];
  /** ワープ穴。[q1, r1, q2, r2] で1組。片方に入ったタイヤは、もう片方から同じ向きで出る */
  warps?: (readonly [q1: number, r1: number, q2: number, r2: number])[];
  /** 跳ね返す板。タイヤは来た向きへまっすぐ戻る */
  mirrors?: Hex[];
}

export interface State {
  radius: number;
  rollers: string[];
  /** 残っている的。並びはいつも同じ順 */
  targets: string[];
  /** 残っている壁の段数 */
  walls: Record<string, number>;
  /** 板が今どちらへ曲げるか。1 は左へ 60°、-1 は右へ 60° */
  plates: Record<string, number>;
  /** false なら、転師は押されても動かない */
  push: boolean;
  /** 残っている爆弾 */
  bombs: string[];
  /** 残っている跳ね返す板（爆弾で壊れる） */
  mirrors: string[];
  // ここから下の3つは、ステージの間ずっと変わらない（的が倒れても、盾の印は残るが、その的はもう無い）
  iron: string[];
  shields: string[];
  /** ワープ穴の行き先。入口 → 出口（両向きに入れる） */
  warps: Record<string, string>;
  heavyLeft: number;
  shots: number;
  par: number;
  /** この発射数までに倒しきれなければ失敗。持っているタイヤの数（軽い + 重い）でもある */
  limit: number;
  status: Status;
}

export interface Shot {
  roller: number;
  dir: number;
  kind: TireKind;
}

export interface ShotResult {
  state: State;
  /** タイヤが通ったマス。止まったマス（壁・的・転師）や、盤の外に出た最初のマスも含む。板で曲がった後のマスも続けて入る */
  path: Hex[];
  /** 倒した的が path の何番目にあるか */
  hitAt: number[];
  /** iron は鉄の壁、shield は軽いタイヤが盾付きの的に当たって止まった、bomb は爆弾に当たって爆ぜた */
  end: 'out' | 'wall' | 'target' | 'roller' | 'iron' | 'shield' | 'bomb';
  /** 爆弾が爆ぜた所。at は path の何番目で爆ぜたか、cells は爆弾と、巻き込んだ物（爆弾・的・壁・板・跳ね返す板） */
  blasts: { at: number; cells: Hex[] }[];
  /** 押されて動いた転師の番号。動かなかった時は -1 */
  pushed: number;
  /** 盤が変わったか（的が倒れた・壁が削れた・転師が動いた・板の向きが変わった）。変わらない発射は、撃つ意味が無い */
  changed: boolean;
}

export interface FireOptions {
  /** false にすると、転師は押されても動かない（ステージ作りで「押すのが要るか」を調べるのに使う） */
  push?: boolean;
  /** false にすると、板で曲がった後のタイヤでは、転師は押されない（ステージ作りで「板で曲げて押すのが要るか」を調べるのに使う） */
  bentPush?: boolean;
}

/**
 * 残っている軽いタイヤの数。持っているタイヤは全部で limit 個で、そのうち重いタイヤを除いた残りが軽いタイヤ。
 * 重いタイヤの代わりに軽いタイヤを撃つことはできない（数が別々に決まっている）
 */
export const lightLeft = (state: State): number => state.limit - state.shots - state.heavyLeft;

/** ★3 の発射数より、何発多く撃てるか。星は、最少で ★3、1発多いと ★2、それより多いと ★1 */
export const EXTRA_SHOTS = 3;

/** 重いタイヤが壊せる数。的1つで1、壁1段で1と数え、壊しきったらそこで止まる */
export const HEAVY_POWER = 3;

export function createState(level: Level, limit: number = level.par + EXTRA_SHOTS): State {
  return {
    radius: level.radius,
    rollers: level.rollers.map(([q, r]) => keyOf(q, r)),
    targets: level.targets.map(([q, r]) => keyOf(q, r)).sort(),
    walls: Object.fromEntries(level.walls.map(([q, r, stage]) => [keyOf(q, r), stage])),
    plates: Object.fromEntries((level.plates ?? []).map(([q, r, turn]) => [keyOf(q, r), turn])),
    push: level.push !== false,
    iron: (level.iron ?? []).map(([q, r]) => keyOf(q, r)),
    bombs: (level.bombs ?? []).map(([q, r]) => keyOf(q, r)),
    shields: (level.shields ?? []).map(([q, r]) => keyOf(q, r)),
    warps: Object.fromEntries((level.warps ?? []).flatMap(([q1, r1, q2, r2]) => [[keyOf(q1, r1), keyOf(q2, r2)], [keyOf(q2, r2), keyOf(q1, r1)]])),
    mirrors: (level.mirrors ?? []).map(([q, r]) => keyOf(q, r)),
    heavyLeft: level.heavy,
    shots: 0,
    par: level.par,
    limit,
    status: 'playing',
  };
}

/** タイヤが進めるマスの数の上限。板で回り続けることが無いように止める */
const MAX_STEPS = 200;

/**
 * 1発撃った後の状態を新しく返す（元の状態は変えない）。撃てない時は null。
 * タイヤはまっすぐ進む。軽いタイヤは、壁に当たると1段削って止まり、的に当たると1つ倒して止まる。
 * 重いタイヤは、的と壁を合わせて HEAVY_POWER 個まで壊しながら進み、壊しきったところで止まる（的1つで1、壁1段で1）。
 * 板に当たると、板の向きへ 60° 曲がって進み続け、板は逆向きに切り替わる。
 * 転師に当たると止まり、当たった転師は、先のマスが空いていれば1マス押される。
 * 鉄の壁では止まる（壊れない）。盾付きの的は、軽いタイヤでは倒れず、そこで止まる。
 * 爆弾に当たると、タイヤはそこで止まり、爆弾が爆ぜる。周りの6マスの的を倒し、壁を1段削り、板と跳ね返す板を壊す（鉄の壁・ワープ穴・転師はそのまま）。
 * 巻き込んだ爆弾も続けて爆ぜる。
 * ワープ穴に入ると、組になったもう片方の穴から、同じ向きで出て進み続ける。跳ね返す板では、来た向きへ戻る。
 */
export function fire(state: State, shot: Shot, options: FireOptions = {}): ShotResult | null {
  if (state.status !== 'playing') return null;
  if (shot.kind === 'heavy' && state.heavyLeft <= 0) return null;
  if (shot.kind === 'light' && lightLeft(state) <= 0) return null;
  const from = state.rollers[shot.roller];
  if (from === undefined || DIRS[shot.dir] === undefined) return null;

  const walls = { ...state.walls };
  const plates = { ...state.plates };
  let rollers = state.rollers;
  let targets = state.targets;
  let bombs = state.bombs;
  let mirrors = state.mirrors;
  const path: Hex[] = [];
  const hitAt: number[] = [];
  let end: ShotResult['end'] = 'out';
  let pushed = -1;
  let changed = false;
  let dir = shot.dir;
  /** あと幾つ壊せるか */
  let power = shot.kind === 'heavy' ? HEAVY_POWER : 1;
  /** 板で曲がった後か */
  let bent = false;
  const blasts: ShotResult['blasts'] = [];
  /** 爆弾を爆ぜさせる。周りの6マスを巻き込み、巻き込んだ爆弾も続けて爆ぜる（1つのマスに置く物は1つなので、マスごとに1つだけ見る） */
  const explode = (key: string) => {
    bombs = bombs.filter((b) => b !== key);
    changed = true;
    const cells = [key];
    const queue = [key];
    while (queue.length > 0) {
      const [cq, cr] = hexOf(queue.shift()!);
      for (const [dq, dr] of DIRS) {
        const near = keyOf(cq + dq, cr + dr);
        if (bombs.includes(near)) {
          bombs = bombs.filter((b) => b !== near);
          queue.push(near);
        } else if (targets.includes(near)) {
          targets = targets.filter((t) => t !== near);
        } else if (walls[near]) {
          if (walls[near] > 1) walls[near] -= 1;
          else delete walls[near];
        } else if (plates[near]) {
          delete plates[near];
        } else if (mirrors.includes(near)) {
          mirrors = mirrors.filter((m) => m !== near);
        } else {
          continue;
        }
        cells.push(near);
      }
    }
    blasts.push({ at: path.length - 1, cells: cells.map(hexOf) });
  };
  let [q, r] = from.split(',').map(Number);

  while (path.length < MAX_STEPS) {
    q += DIRS[dir][0];
    r += DIRS[dir][1];
    path.push([q, r]);
    if (!inBoard(q, r, state.radius)) break;
    const key = keyOf(q, r);
    const hitRoller = rollers.indexOf(key);
    if (hitRoller >= 0) {
      end = 'roller';
      const [tq, tr] = [q + DIRS[dir][0], r + DIRS[dir][1]];
      const to = keyOf(tq, tr);
      const free =
        inBoard(tq, tr, state.radius) &&
        !walls[to] && !plates[to] && !targets.includes(to) && !rollers.includes(to) &&
        !state.iron.includes(to) && !state.warps[to] && !mirrors.includes(to) && !bombs.includes(to);
      if (free && state.push && options.push !== false && !(bent && options.bentPush === false)) {
        rollers = rollers.map((cell, i) => (i === hitRoller ? to : cell));
        pushed = hitRoller;
        changed = true;
      }
      break;
    }
    if (state.iron.includes(key)) {
      end = 'iron';
      break;
    }
    if (bombs.includes(key)) {
      explode(key);
      end = 'bomb';
      break;
    }
    if (mirrors.includes(key)) {
      dir = (dir + 3) % 6;
      continue;
    }
    const exit = state.warps[key];
    if (exit) {
      [q, r] = hexOf(exit);
      path.push([q, r]);
      continue;
    }
    const stage = walls[key];
    if (stage) {
      changed = true;
      const broken = Math.min(stage, power);
      power -= broken;
      if (stage > broken) walls[key] = stage - broken;
      else delete walls[key];
      if (power > 0) continue;
      end = 'wall';
      break;
    }
    const turn = plates[key];
    if (turn) {
      dir = (dir + turn + 6) % 6;
      plates[key] = -turn;
      bent = true;
      changed = true;
      continue;
    }
    if (targets.includes(key)) {
      if (shot.kind === 'light' && state.shields.includes(key)) {
        end = 'shield';
        break;
      }
      hitAt.push(path.length - 1);
      targets = targets.filter((t) => t !== key);
      changed = true;
      power -= 1;
      if (power === 0) {
        end = 'target';
        break;
      }
    }
  }

  const shots = state.shots + 1;
  const status: Status = targets.length === 0 ? 'cleared' : shots >= state.limit ? 'failed' : 'playing';
  return {
    state: {
      ...state,
      rollers,
      targets,
      walls,
      plates,
      bombs,
      mirrors,
      heavyLeft: state.heavyLeft - (shot.kind === 'heavy' ? 1 : 0),
      shots,
      status,
    },
    path,
    hitAt,
    blasts,
    end,
    pushed,
    changed,
  };
}

/** クリアした時の星の数。最少の発射数なら3つ、1発多いと2つ、それより多いと1つ */
export function starsOf(state: State): number {
  if (state.status !== 'cleared') return 0;
  return state.shots <= state.par ? 3 : state.shots === state.par + 1 ? 2 : 1;
}
