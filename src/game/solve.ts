// 総当たりで最少の発射数を求める。ステージの確認と、ステージ作りに使う。
import { createState, fire, type FireOptions, type Level, type Shot, type State } from './rules';

export interface SolveOptions extends FireOptions {
  /** 調べる盤面の数がこれを超えたら、あきらめて例外を投げる（ステージ作りで、重すぎる候補を捨てるのに使う） */
  maxStates?: number;
}

/** 調べる盤面が多すぎて、あきらめた */
export class TooManyStates extends Error {}

export interface Solution {
  /** 最少の発射数で倒しきる撃ち方の1つ */
  shots: Shot[];
  /** 最少の発射数で倒しきる撃ち方の数（順番が違えば別に数える） */
  ways: number;
}

const cellsKey = (cells: Record<string, number>): string => Object.keys(cells).sort().map((k) => `${k}=${cells[k]}`).join(';');

const stateKey = (s: State): string =>
  `${s.targets.join(';')}|${cellsKey(s.walls)}|${s.heavyLeft}|${s.rollers.join(';')}|${cellsKey(s.plates)}`;

/** maxShots 発までで倒しきれなければ null */
export function solve(level: Level, maxShots: number = 8, options: SolveOptions = {}): Solution | null {
  return solveFrom(createState(level, Infinity), maxShots, options);
}

/**
 * 途中の盤面から、最少の発射数で倒しきる撃ち方を探す（ヒントに使う）。
 * 盤面が持っているタイヤの数を守るので、残りのタイヤでは倒しきれない時は null になる。
 */
export function solveFrom(start: State, maxShots: number = 8, options: SolveOptions = {}): Solution | null {
  if (start.targets.length === 0) return { shots: [], ways: 1 };

  // 幅優先。同じ盤面は、最初に着いた時の撃ち方だけ覚える
  let layer = new Map<string, { state: State; shots: Shot[]; ways: number }>([[stateKey(start), { state: start, shots: [], ways: 1 }]]);
  const seen = new Set(layer.keys());

  for (let depth = 1; depth <= maxShots; depth++) {
    const next = new Map<string, { state: State; shots: Shot[]; ways: number }>();
    let solved: Solution | null = null;
    for (const node of layer.values()) {
      for (let roller = 0; roller < node.state.rollers.length; roller++) {
        for (let dir = 0; dir < 6; dir++) {
          for (const kind of ['light', 'heavy'] as const) {
            const shot: Shot = { roller, dir, kind };
            const result = fire(node.state, shot, options);
            // 盤が変わらない発射は、最少の撃ち方には入らない
            if (!result || !result.changed) continue;
            if (result.state.status === 'cleared') {
              if (solved) solved.ways += node.ways;
              else solved = { shots: [...node.shots, shot], ways: node.ways };
              continue;
            }
            const key = stateKey(result.state);
            const known = next.get(key);
            if (known) known.ways += node.ways;
            else if (!seen.has(key)) next.set(key, { state: result.state, shots: [...node.shots, shot], ways: node.ways });
          }
        }
      }
    }
    if (solved) return solved;
    for (const key of next.keys()) seen.add(key);
    if (options.maxStates !== undefined && seen.size > options.maxStates) throw new TooManyStates();
    layer = next;
    if (layer.size === 0) return null;
  }
  return null;
}
