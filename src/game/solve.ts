// 総当たりで最少の発射数を求める。ステージの確認と、ステージ作りに使う。
import { createState, fire, type Level, type Shot, type State } from './rules';

export interface Solution {
  /** 最少の発射数で倒しきる撃ち方の1つ */
  shots: Shot[];
  /** 最少の発射数で倒しきる撃ち方の数（順番が違えば別に数える） */
  ways: number;
}

const stateKey = (s: State): string =>
  `${s.targets.join(';')}|${Object.keys(s.walls).sort().map((k) => `${k}=${s.walls[k]}`).join(';')}|${s.heavyLeft}`;

/** maxShots 発までで倒しきれなければ null */
export function solve(level: Level, maxShots: number = 8): Solution | null {
  const start = createState(level, Infinity);
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
            const result = fire(node.state, shot);
            // 何にも当たらない発射は、最少の撃ち方には入らない
            if (!result || (result.hitAt.length === 0 && result.end !== 'wall')) continue;
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
    layer = next;
    if (layer.size === 0) return null;
  }
  return null;
}
