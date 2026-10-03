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
  heavyLeft: number;
  shots: number;
  par: number;
  /** この発射数までに倒しきれなければ失敗 */
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
  /** タイヤが通ったマス。止まったマス（壁・的・転師）や、盤の外に出た最初のマスも含む */
  path: Hex[];
  /** 倒した的が path の何番目にあるか */
  hitAt: number[];
  end: 'out' | 'wall' | 'target' | 'roller';
}

/** ★3 の発射数より、何発多く撃てるか */
export const EXTRA_SHOTS = 2;

export function createState(level: Level, limit: number = level.par + EXTRA_SHOTS): State {
  return {
    radius: level.radius,
    rollers: level.rollers.map(([q, r]) => keyOf(q, r)),
    targets: level.targets.map(([q, r]) => keyOf(q, r)).sort(),
    walls: Object.fromEntries(level.walls.map(([q, r, stage]) => [keyOf(q, r), stage])),
    heavyLeft: level.heavy,
    shots: 0,
    par: level.par,
    limit,
    status: 'playing',
  };
}

/**
 * 1発撃った後の状態を新しく返す（元の状態は変えない）。撃てない時は null。
 * タイヤはまっすぐ進む。壁に当たると1段削って止まる。
 * 軽いタイヤは的を1つ倒して止まり、重いタイヤは的を倒しながら進み続ける。
 */
export function fire(state: State, shot: Shot): ShotResult | null {
  if (state.status !== 'playing') return null;
  if (shot.kind === 'heavy' && state.heavyLeft <= 0) return null;
  const from = state.rollers[shot.roller];
  const step = DIRS[shot.dir];
  if (from === undefined || step === undefined) return null;

  const walls = { ...state.walls };
  let targets = state.targets;
  const path: Hex[] = [];
  const hitAt: number[] = [];
  let end: ShotResult['end'] = 'out';
  let [q, r] = from.split(',').map(Number);

  for (;;) {
    q += step[0];
    r += step[1];
    path.push([q, r]);
    if (!inBoard(q, r, state.radius)) break;
    const key = keyOf(q, r);
    if (state.rollers.includes(key)) {
      end = 'roller';
      break;
    }
    const stage = walls[key];
    if (stage) {
      if (stage > 1) walls[key] = stage - 1;
      else delete walls[key];
      end = 'wall';
      break;
    }
    if (targets.includes(key)) {
      targets = targets.filter((t) => t !== key);
      hitAt.push(path.length - 1);
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
      targets,
      walls,
      heavyLeft: state.heavyLeft - (shot.kind === 'heavy' ? 1 : 0),
      shots,
      status,
    },
    path,
    hitAt,
    end,
  };
}

/** クリアした時の星の数 */
export function starsOf(state: State): number {
  if (state.status !== 'cleared') return 0;
  if (state.shots <= state.par) return 3;
  if (state.shots === state.par + 1) return 2;
  return 1;
}
