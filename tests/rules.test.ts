import { describe, expect, it } from 'vitest';
import { boardCells, dirTo, hexDist } from '../src/game/hex';
import { LEVELS } from '../src/game/levels';
import { createState, fire, starsOf, type Level } from '../src/game/rules';
import { solve } from '../src/game/solve';

const level = (over: Partial<Level>): Level => ({ radius: 2, rollers: [[-2, 0]], targets: [], walls: [], heavy: 0, par: 1, ...over });
const EAST = 0;

describe('六角形の盤', () => {
  it('半径2の盤は19マス、半径3は37マス', () => {
    expect(boardCells(2)).toHaveLength(19);
    expect(boardCells(3)).toHaveLength(37);
  });

  it('まっすぐ先にあるマスだけ向きが決まる', () => {
    expect(dirTo([0, 0], [3, 0])).toBe(0);
    expect(dirTo([0, 0], [-2, 2])).toBe(4);
    expect(dirTo([0, 0], [1, 1])).toBe(-1);
    expect(dirTo([0, 0], [0, 0])).toBe(-1);
    expect(hexDist([0, 0], [2, -1])).toBe(2);
  });
});

describe('発射', () => {
  it('軽いタイヤは、最初の的を倒して止まる', () => {
    const s = createState(level({ targets: [[-1, 0], [1, 0]] }));
    const result = fire(s, { roller: 0, dir: EAST, kind: 'light' })!;
    expect(result.state.targets).toEqual(['1,0']);
    expect(result.end).toBe('target');
    expect(s.targets).toHaveLength(2); // 元の状態は変わらない
  });

  it('重いタイヤは、的を倒しながら盤の外まで進む', () => {
    const s = createState(level({ targets: [[-1, 0], [1, 0]], heavy: 1 }));
    const result = fire(s, { roller: 0, dir: EAST, kind: 'heavy' })!;
    expect(result.state.targets).toEqual([]);
    expect(result.state.heavyLeft).toBe(0);
    expect(result.end).toBe('out');
    expect(result.state.status).toBe('cleared');
  });

  it('重いタイヤが残っていなければ撃てない', () => {
    const s = createState(level({ targets: [[1, 0]] }));
    expect(fire(s, { roller: 0, dir: EAST, kind: 'heavy' })).toBeNull();
  });

  it('壁に当たると1段削って止まる。2段の壁は2発で無くなる', () => {
    const s = createState(level({ targets: [[1, 0]], walls: [[0, 0, 2]], heavy: 1, par: 3 }));
    const first = fire(s, { roller: 0, dir: EAST, kind: 'heavy' })!;
    expect(first.end).toBe('wall');
    expect(first.state.walls).toEqual({ '0,0': 1 });
    expect(first.state.targets).toEqual(['1,0']);
    const second = fire(first.state, { roller: 0, dir: EAST, kind: 'light' })!;
    expect(second.state.walls).toEqual({});
    const third = fire(second.state, { roller: 0, dir: EAST, kind: 'light' })!;
    expect(third.state.status).toBe('cleared');
  });

  it('ほかの転師に当たると止まる', () => {
    const s = createState(level({ rollers: [[-2, 0], [0, 0]], targets: [[1, 0]] }));
    const result = fire(s, { roller: 0, dir: EAST, kind: 'light' })!;
    expect(result.end).toBe('roller');
    expect(result.state.targets).toEqual(['1,0']);
  });

  it('発射数を使い切ると失敗になり、それ以上撃てない', () => {
    let s = createState(level({ targets: [[1, 0]], par: 1 }), 2);
    s = fire(s, { roller: 0, dir: 3, kind: 'light' })!.state;
    expect(s.status).toBe('playing');
    s = fire(s, { roller: 0, dir: 3, kind: 'light' })!.state;
    expect(s.status).toBe('failed');
    expect(fire(s, { roller: 0, dir: EAST, kind: 'light' })).toBeNull();
  });

  it('最少の発射数なら星3つ、1発多いと2つ、それより多いと1つ', () => {
    const cleared = createState(level({ par: 3 }));
    expect(starsOf({ ...cleared, status: 'cleared', shots: 3 })).toBe(3);
    expect(starsOf({ ...cleared, status: 'cleared', shots: 4 })).toBe(2);
    expect(starsOf({ ...cleared, status: 'cleared', shots: 5 })).toBe(1);
    expect(starsOf({ ...cleared, status: 'failed', shots: 5 })).toBe(0);
  });
});

describe('ステージ', () => {
  it('20 ステージ以上ある', () => {
    expect(LEVELS.length).toBeGreaterThanOrEqual(20);
  });

  it('どのステージも解けて、par が最少の発射数と合っている', () => {
    LEVELS.forEach((l, i) => {
      const best = solve(l, l.par);
      expect(best?.shots.length, `ステージ ${i + 1}`).toBe(l.par);
    });
  });

  it('転師・的・壁が同じマスに重なっていない', () => {
    LEVELS.forEach((l, i) => {
      const keys = [...l.rollers, ...l.targets, ...l.walls].map(([q, r]) => `${q},${r}`);
      expect(new Set(keys).size, `ステージ ${i + 1}`).toBe(keys.length);
    });
  });
});
