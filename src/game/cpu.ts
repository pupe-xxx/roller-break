import type { Rng } from '../kit/rng';
import { applyMove, legalMoves, type State } from './rules';

/** CPU の手。どちらの番でも指せる（CPU 同士の対戦に使うため） */
export function chooseMove(state: State, rng: Rng): number {
  const moves = legalMoves(state);
  const me = state.turn;
  const opponent = me === 'p1' ? 'p2' : 'p1';

  // 勝てる手があれば打つ
  const winning = moves.find((m) => applyMove(state, m).winner === me);
  if (winning !== undefined) return winning;

  // 相手が次に勝つ手をふさぐ
  const blocking = moves.find((m) => applyMove({ ...state, turn: opponent }, m).winner === opponent);
  if (blocking !== undefined) return blocking;

  return rng.pick(moves);
}
