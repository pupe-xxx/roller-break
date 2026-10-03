import { describe, expect, it } from 'vitest';
import { applyMove, createInitialState, legalMoves, winnerOf } from '../src/game/rules';
import { playGame, playMany } from '../src/game/sim';

describe('ルール', () => {
  it('最初は9マスすべてに打てて、先手の番', () => {
    const s = createInitialState();
    expect(legalMoves(s)).toHaveLength(9);
    expect(s.turn).toBe('p1');
  });

  it('打つと番が替わり、元の状態は変わらない', () => {
    const s = createInitialState();
    const next = applyMove(s, 4);
    expect(next.board[4]).toBe('p1');
    expect(next.turn).toBe('p2');
    expect(s.board[4]).toBeNull();
  });

  it('埋まっているマスには打てない', () => {
    const s = applyMove(createInitialState(), 4);
    expect(applyMove(s, 4)).toBe(s);
  });

  it('1列そろうと勝ち、全部埋まると引き分け', () => {
    expect(winnerOf(['p1', 'p1', 'p1', null, 'p2', 'p2', null, null, null])).toBe('p1');
    expect(winnerOf(['p1', 'p2', 'p1', 'p1', 'p2', 'p2', 'p2', 'p1', 'p1'])).toBe('draw');
    expect(winnerOf(['p1', null, null, null, null, null, null, null, null])).toBeNull();
  });
});

describe('画面なしの CPU 対戦', () => {
  it('同じ種なら同じ試合になる', () => {
    expect(playGame(42)).toEqual(playGame(42));
  });

  it('どの試合も決着まで進み、打った手はすべて別のマス', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { winner, moves } = playGame(seed);
      expect(['p1', 'p2', 'draw']).toContain(winner);
      expect(new Set(moves).size).toBe(moves.length);
    }
  });

  it('勝敗の合計が試合数と合う', () => {
    const tally = playMany(100);
    expect(tally.p1 + tally.p2 + tally.draw).toBe(100);
  });
});
