// 動作記録に入れる場面。ゲームごとに書き換える。
// 対戦ゲームなら「種を固定した CPU 同士の試合の、1手ごとの盤面」、
// 1人用なら「決まった入力に対する結果」を並べる。
import { chooseMove } from '../../src/game/cpu';
import { applyMove, createInitialState } from '../../src/game/rules';
import { fingerprint, type Trace } from '../../src/kit/golden';
import { createRng } from '../../src/kit/rng';

const GAMES = 50;

function traceGame(seed: number): Trace {
  const rng = createRng(seed);
  let state = createInitialState();
  const trace = [fingerprint(state)];
  while (!state.winner) {
    state = applyMove(state, chooseMove(state, rng));
    trace.push(fingerprint(state));
  }
  return trace;
}

export function goldenCases(): Record<string, Trace> {
  return Object.fromEntries(Array.from({ length: GAMES }, (_, i) => [`seed ${i + 1}`, traceGame(i + 1)]));
}
