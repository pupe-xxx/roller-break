import { createRng } from '../kit/rng';
import { chooseMove } from './cpu';
import { applyMove, createInitialState, type State } from './rules';

export interface GameResult {
  seed: number;
  winner: NonNullable<State['winner']>;
  moves: number[];
}

/** 画面なしで CPU 同士を1試合対戦させる。同じ種なら同じ試合になる */
export function playGame(seed: number): GameResult {
  const rng = createRng(seed);
  let state = createInitialState();
  const moves: number[] = [];
  while (!state.winner) {
    const move = chooseMove(state, rng);
    moves.push(move);
    state = applyMove(state, move);
  }
  return { seed, winner: state.winner, moves };
}

export function playMany(games: number, firstSeed = 1): Record<GameResult['winner'], number> {
  const tally = { p1: 0, p2: 0, draw: 0 };
  for (let i = 0; i < games; i++) tally[playGame(firstSeed + i).winner]++;
  return tally;
}
