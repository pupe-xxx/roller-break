// 見本のルール（三目並べ）。新しいゲームを作る時は、このファイルを書き換える。
// このフォルダ（src/game）は画面の処理に触れない。document・Canvas・Math.random は使わない。

export type Player = 'p1' | 'p2';
export type Cell = Player | null;

export interface State {
  board: Cell[]; // 9 マス。左上から右へ
  turn: Player;
  winner: Player | 'draw' | null;
}

export const SIZE = 3;

const LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

export function createInitialState(): State {
  return { board: Array<Cell>(SIZE * SIZE).fill(null), turn: 'p1', winner: null };
}

export function legalMoves(state: State): number[] {
  if (state.winner) return [];
  return state.board.flatMap((cell, i) => (cell === null ? [i] : []));
}

export function winnerOf(board: readonly Cell[]): Player | 'draw' | null {
  for (const [a, b, c] of LINES) {
    const v = board[a];
    if (v && v === board[b] && v === board[c]) return v;
  }
  return board.every((cell) => cell !== null) ? 'draw' : null;
}

/** 手を打った後の状態を新しく返す（元の状態は変えない） */
export function applyMove(state: State, index: number): State {
  if (state.winner || state.board[index] !== null) return state;
  const board = state.board.slice();
  board[index] = state.turn;
  return { board, turn: state.turn === 'p1' ? 'p2' : 'p1', winner: winnerOf(board) };
}
