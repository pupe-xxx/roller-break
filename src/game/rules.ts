// ルール。タイヤを転がして、的を全部倒す。
// このフォルダ（src/game）は画面の処理に触れない。document・Canvas・Math.random は使わない。
import { DIRS, inBoard, keyOf, type Hex } from './hex';

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
  end: 'out' | 'wall' | 'target' | 'roller';
  /** 押されて動いた転師の番号。動かなかった時は -1 */
  pushed: number;
  /** 盤が変わったか（的が倒れた・壁が削れた・転師が動いた・板の向きが変わった）。変わらない発射は、撃つ意味が無い */
  changed: boolean;
}

export interface FireOptions {
  /** false にすると、転師は押されても動かない（ステージ作りで「押すのが要るか」を調べるのに使う） */
  push?: boolean;
}

/**
 * 残っている軽いタイヤの数。持っているタイヤは全部で limit 個で、そのうち重いタイヤを除いた残りが軽いタイヤ。
 * 重いタイヤの代わりに軽いタイヤを撃つことはできない（数が別々に決まっている）
 */
export const lightLeft = (state: State): number => state.limit - state.shots - state.heavyLeft;

/** ★3 の発射数より、何発多く撃てるか。余裕が多いと、考えずに撃っても倒しきれてしまう */
export const EXTRA_SHOTS = 1;

export function createState(level: Level, limit: number = level.par + EXTRA_SHOTS): State {
  return {
    radius: level.radius,
    rollers: level.rollers.map(([q, r]) => keyOf(q, r)),
    targets: level.targets.map(([q, r]) => keyOf(q, r)).sort(),
    walls: Object.fromEntries(level.walls.map(([q, r, stage]) => [keyOf(q, r), stage])),
    plates: Object.fromEntries((level.plates ?? []).map(([q, r, turn]) => [keyOf(q, r), turn])),
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
 * タイヤはまっすぐ進む。壁に当たると止まる。軽いタイヤは壁を1段削り、重いタイヤは何段あっても1発で壊す。
 * 軽いタイヤは的を1つ倒して止まり、重いタイヤは的を倒しながら進み続ける。
 * 板に当たると、板の向きへ 60° 曲がって進み続け、板は逆向きに切り替わる。
 * 転師に当たると止まり、当たった転師は、先のマスが空いていれば1マス押される。
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
  const path: Hex[] = [];
  const hitAt: number[] = [];
  let end: ShotResult['end'] = 'out';
  let pushed = -1;
  let changed = false;
  let dir = shot.dir;
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
      const free = inBoard(tq, tr, state.radius) && !walls[to] && !plates[to] && !targets.includes(to) && !rollers.includes(to);
      if (free && options.push !== false) {
        rollers = rollers.map((cell, i) => (i === hitRoller ? to : cell));
        pushed = hitRoller;
        changed = true;
      }
      break;
    }
    const stage = walls[key];
    if (stage) {
      if (stage > 1 && shot.kind === 'light') walls[key] = stage - 1;
      else delete walls[key];
      end = 'wall';
      changed = true;
      break;
    }
    const turn = plates[key];
    if (turn) {
      dir = (dir + turn + 6) % 6;
      plates[key] = -turn;
      changed = true;
      continue;
    }
    if (targets.includes(key)) {
      targets = targets.filter((t) => t !== key);
      hitAt.push(path.length - 1);
      changed = true;
      if (shot.kind === 'light') {
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
      heavyLeft: state.heavyLeft - (shot.kind === 'heavy' ? 1 : 0),
      shots,
      status,
    },
    path,
    hitAt,
    end,
    pushed,
    changed,
  };
}

/** クリアした時の星の数。最少の発射数なら3つ、1発多いと2つ（それより多くは撃てない） */
export function starsOf(state: State): number {
  if (state.status !== 'cleared') return 0;
  return state.shots <= state.par ? 3 : 2;
}
