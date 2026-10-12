import { describe, expect, it } from 'vitest';
import { boardCells, dirTo, hexDist } from '../src/game/hex';
import { LEVELS, PUSH_INTRO_AT } from '../src/game/levels';
import { createState, fire, lightLeft, starsOf, type Level } from '../src/game/rules';
import { solve, solveFrom } from '../src/game/solve';

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

  it('重いタイヤは、的を倒しながら進み、3つ倒すと止まる', () => {
    const s = createState(level({ rollers: [[-2, 0]], targets: [[-1, 0], [0, 0], [1, 0], [2, 0]], heavy: 1 }));
    const result = fire(s, { roller: 0, dir: EAST, kind: 'heavy' })!;
    expect(result.state.targets).toEqual(['2,0']);
    expect(result.state.heavyLeft).toBe(0);
    expect(result.end).toBe('target');
    const few = fire(createState(level({ targets: [[-1, 0], [1, 0]], heavy: 1 })), { roller: 0, dir: EAST, kind: 'heavy' })!;
    expect(few.end).toBe('out');
    expect(few.state.status).toBe('cleared');
  });

  it('重いタイヤが残っていなければ撃てない', () => {
    const s = createState(level({ targets: [[1, 0]] }));
    expect(fire(s, { roller: 0, dir: EAST, kind: 'heavy' })).toBeNull();
  });

  it('軽いタイヤは、壁に当たると1段削って止まる。2段の壁は2発で無くなる', () => {
    const s = createState(level({ targets: [[1, 0]], walls: [[0, 0, 2]], heavy: 1, par: 3 }));
    const first = fire(s, { roller: 0, dir: EAST, kind: 'light' })!;
    expect(first.end).toBe('wall');
    expect(first.state.walls).toEqual({ '0,0': 1 });
    expect(first.state.targets).toEqual(['1,0']);
    const second = fire(first.state, { roller: 0, dir: EAST, kind: 'light' })!;
    expect(second.state.walls).toEqual({});
    const third = fire(second.state, { roller: 0, dir: EAST, kind: 'light' })!;
    expect(third.state.status).toBe('cleared');
  });

  it('重いタイヤは、壁を1段で1つと数えて、合わせて3つまで壊す', () => {
    // 2段の壁（2つ）と的（1つ）で3つ。後ろの壁は残る
    const s = createState(level({ targets: [[0, 0]], walls: [[-1, 0, 2], [1, 0, 1]], heavy: 1 }), 9);
    const result = fire(s, { roller: 0, dir: EAST, kind: 'heavy' })!;
    expect(result.end).toBe('target');
    expect(result.state.walls).toEqual({ '1,0': 1 });
    expect(result.state.status).toBe('cleared');
    // 的（1つ）と2段の壁（2つ）で3つ。壁を壊しきった所で止まり、その後ろの壁には届かない
    const t = createState(level({ targets: [[-1, 0], [2, 0]], walls: [[0, 0, 2], [1, 0, 2]], heavy: 1 }), 9);
    const second = fire(t, { roller: 0, dir: EAST, kind: 'heavy' })!;
    expect(second.end).toBe('wall');
    expect(second.state.walls).toEqual({ '1,0': 2 });
    expect(second.state.targets).toEqual(['2,0']);
  });

  it('重いタイヤも、転師に当たると止まる（転師の後ろは壊さない）', () => {
    const s = createState(level({ rollers: [[-2, 0], [0, 0]], targets: [[2, 0]], walls: [[-1, 0, 2], [1, 0, 1]], heavy: 1 }), 9);
    const result = fire(s, { roller: 0, dir: EAST, kind: 'heavy' })!;
    expect(result.end).toBe('roller');
    expect(result.state.walls).toEqual({ '1,0': 1 });
    expect(result.state.rollers).toEqual(['-2,0', '0,0']);
  });

  it('ほかの転師に当たると止まる', () => {
    const s = createState(level({ rollers: [[-2, 0], [0, 0]], targets: [[1, 0]] }));
    const result = fire(s, { roller: 0, dir: EAST, kind: 'light' })!;
    expect(result.end).toBe('roller');
    expect(result.state.targets).toEqual(['1,0']);
  });

  it('転師に当たると、その転師が1マス押される。先がふさがっていれば動かない', () => {
    const s = createState(level({ rollers: [[-2, 0], [0, 0]], targets: [[1, -2]] }), 9);
    const pushed = fire(s, { roller: 0, dir: EAST, kind: 'light' })!;
    expect(pushed.state.rollers).toEqual(['-2,0', '1,0']);
    expect(pushed.pushed).toBe(1);
    expect(pushed.changed).toBe(true);
    // 押された先からは、前は狙えなかった的が狙える
    const hit = fire(pushed.state, { roller: 1, dir: 2, kind: 'light' })!;
    expect(hit.state.status).toBe('cleared');

    const blocked = createState(level({ rollers: [[-2, 0], [0, 0]], targets: [[2, -2]], walls: [[1, 0, 1]] }), 9);
    const stay = fire(blocked, { roller: 0, dir: EAST, kind: 'light' })!;
    expect(stay.state.rollers).toEqual(['-2,0', '0,0']);
    expect(stay.changed).toBe(false);
    // 盤の端にいる転師は、外へは押されない
    const edge = createState(level({ rollers: [[0, 0], [2, 0]], targets: [[2, -2]] }), 9);
    expect(fire(edge, { roller: 0, dir: EAST, kind: 'light' })!.state.rollers).toEqual(['0,0', '2,0']);
  });

  it('push: false のステージでは、転師に当たっても押されない', () => {
    const s = createState(level({ rollers: [[-2, 0], [0, 0]], targets: [[1, -2]], push: false }), 9);
    const result = fire(s, { roller: 0, dir: EAST, kind: 'light' })!;
    expect(result.end).toBe('roller');
    expect(result.state.rollers).toEqual(['-2,0', '0,0']);
    expect(result.changed).toBe(false);
  });

    it('板に当たると 60° 曲がって進み、板は逆向きに切り替わる', () => {
    const s = createState(level({ targets: [[2, -2], [0, 2]], plates: [[0, 0, 1]] }), 9);
    const left = fire(s, { roller: 0, dir: EAST, kind: 'light' })!;
    expect(left.state.targets).toEqual(['0,2']);
    expect(left.state.plates).toEqual({ '0,0': -1 });
    expect(left.path).toEqual([[-1, 0], [0, 0], [1, -1], [2, -2]]);
    const right = fire(left.state, { roller: 0, dir: EAST, kind: 'light' })!;
    expect(right.state.status).toBe('cleared');
    expect(right.state.plates).toEqual({ '0,0': 1 });
  });

  it('板で曲がったタイヤでも、転師は曲がった先の向きへ押される', () => {
    // 南へ撃ち、板で東へ曲がって、仲間を東へ1マス押す
    const l = level({ rollers: [[0, -2], [1, -1]], targets: [[0, 1]], plates: [[0, -1, 1]] });
    const pushed = fire(createState(l, 9), { roller: 0, dir: 5, kind: 'light' })!;
    expect(pushed.state.rollers).toEqual(['0,-2', '2,-1']);
    // 調べるための bentPush: false では、押されない
    expect(fire(createState(l, 9), { roller: 0, dir: 5, kind: 'light' }, { bentPush: false })!.state.rollers).toEqual(['0,-2', '1,-1']);
  });

    it('鉄の壁は、どのタイヤでも壊れず、そこで止まる。転師も鉄の壁へは押されない', () => {
    const s = createState(level({ targets: [[1, 0]], iron: [[0, 0]], heavy: 1 }), 9);
    for (const kind of ['light', 'heavy'] as const) {
      const result = fire(s, { roller: 0, dir: EAST, kind })!;
      expect(result.end).toBe('iron');
      expect(result.changed).toBe(false);
    }
    const blocked = createState(level({ rollers: [[-2, 0], [-1, 0]], targets: [[2, -2]], iron: [[0, 0]] }), 9);
    expect(fire(blocked, { roller: 0, dir: EAST, kind: 'light' })!.state.rollers).toEqual(['-2,0', '-1,0']);
  });

  it('爆弾の的が倒れると、周りの的を倒し、壁を1段削る。巻き込んだ爆弾も続けて爆ぜる', () => {
    // (0,0) の爆弾の隣に (1,-1) の爆弾、その隣に (2,-2) の的。(0,1) の2段の壁は1段になる。(-1,1) の鉄の壁は残る
    const s = createState(
      level({ targets: [[0, 0], [1, -1], [2, -2]], bombs: [[0, 0], [1, -1]], walls: [[0, 1, 2]], iron: [[-1, 1]] }),
      9,
    );
    const result = fire(s, { roller: 0, dir: EAST, kind: 'light' })!;
    expect(result.end).toBe('target');
    expect(result.state.status).toBe('cleared');
    expect(result.state.walls).toEqual({ '0,1': 1 });
    expect(result.blasts).toHaveLength(1);
    expect(result.blasts[0].at).toBe(1);
  });

  it('盾付きの的は、軽いタイヤでは倒れずに止まる。重いタイヤと爆弾では倒れる', () => {
    const l = level({ targets: [[0, 0], [1, 0]], shields: [[0, 0]], heavy: 1 });
    const light = fire(createState(l, 9), { roller: 0, dir: EAST, kind: 'light' })!;
    expect(light.end).toBe('shield');
    expect(light.changed).toBe(false);
    const heavy = fire(createState(l, 9), { roller: 0, dir: EAST, kind: 'heavy' })!;
    expect(heavy.state.status).toBe('cleared');
    const bombed = createState(level({ targets: [[-1, 0], [0, 0]], bombs: [[-1, 0]], shields: [[0, 0]] }), 9);
    expect(fire(bombed, { roller: 0, dir: EAST, kind: 'light' })!.state.status).toBe('cleared');
  });

  it('ワープ穴に入ると、もう片方の穴から同じ向きで出る（どちらからでも入れる）', () => {
    // 東へ撃つと (-1,0) の穴から (-1,-1) の穴へ出て、東へ進んで (1,-1) の的に当たる
    const l = level({ targets: [[1, -1]], warps: [[-1, 0, -1, -1]] });
    const result = fire(createState(l, 9), { roller: 0, dir: EAST, kind: 'light' })!;
    expect(result.path).toEqual([[-1, 0], [-1, -1], [0, -1], [1, -1]]);
    expect(result.state.status).toBe('cleared');
  });

  it('跳ね返す板では、来た向きへ戻る。戻ったタイヤは、撃った転師も押す', () => {
    const s = createState(level({ rollers: [[-1, 0]], targets: [[2, -2]], mirrors: [[1, 0]] }), 9);
    const result = fire(s, { roller: 0, dir: EAST, kind: 'light' })!;
    expect(result.path).toEqual([[0, 0], [1, 0], [0, 0], [-1, 0]]);
    expect(result.end).toBe('roller');
    expect(result.state.rollers).toEqual(['-2,0']);
  });

    it('板が輪になっていても、タイヤは止まる', () => {
    const ring: Level['plates'] = [[1, 0, 1], [1, -1, 1], [0, -1, 1], [-1, 0, 1], [-1, 1, 1], [0, 1, 1]];
    const s = createState({ radius: 2, rollers: [[1, 1]], targets: [[2, -2]], walls: [], plates: ring, heavy: 0, par: 1 }, 9);
    expect(fire(s, { roller: 0, dir: 2, kind: 'light' })).not.toBeNull();
  });

  it('軽いタイヤと重いタイヤは、数が別々。軽いタイヤが無くなると、重いタイヤしか撃てない', () => {
    // 全部で3個。そのうち重いタイヤが2個なので、軽いタイヤは1個
    let s = createState(level({ targets: [[2, 0]], walls: [[0, 0, 2], [1, 0, 2]], heavy: 2 }), 3);
    expect(lightLeft(s)).toBe(1);
    s = fire(s, { roller: 0, dir: 2, kind: 'light' })!.state;
    expect(lightLeft(s)).toBe(0);
    expect(fire(s, { roller: 0, dir: EAST, kind: 'light' })).toBeNull();
    expect(fire(s, { roller: 0, dir: EAST, kind: 'heavy' })).not.toBeNull();
  });

  it('発射数を使い切ると失敗になり、それ以上撃てない', () => {
    let s = createState(level({ targets: [[1, 0]], par: 1 }), 2);
    s = fire(s, { roller: 0, dir: 3, kind: 'light' })!.state;
    expect(s.status).toBe('playing');
    s = fire(s, { roller: 0, dir: 3, kind: 'light' })!.state;
    expect(s.status).toBe('failed');
    expect(fire(s, { roller: 0, dir: EAST, kind: 'light' })).toBeNull();
  });

  it('最少の発射数なら星3つ、1発多いと2つ、それより多いと1つ。撃てるのは最少より3発多くまで', () => {
    const cleared = createState(level({ par: 3 }));
    expect(cleared.limit).toBe(6);
    expect(starsOf({ ...cleared, status: 'cleared', shots: 3 })).toBe(3);
    expect(starsOf({ ...cleared, status: 'cleared', shots: 4 })).toBe(2);
    expect(starsOf({ ...cleared, status: 'cleared', shots: 5 })).toBe(1);
    expect(starsOf({ ...cleared, status: 'cleared', shots: 6 })).toBe(1);
    expect(starsOf({ ...cleared, status: 'failed', shots: 6 })).toBe(0);
  });
});

describe('ステージ', () => {
  it('100 ステージある', () => {
    expect(LEVELS.length).toBe(100);
  });

  it('1つのマスに置く物は1つだけ（転師・的・壁・板・鉄の壁・跳ね返す板・ワープ穴が重ならない）', () => {
    LEVELS.forEach((l, i) => {
      const cells = [
        ...l.rollers, ...l.targets, ...l.walls, ...(l.plates ?? []), ...(l.iron ?? []), ...(l.mirrors ?? []),
        ...(l.warps ?? []).flatMap(([q1, r1, q2, r2]) => [[q1, r1], [q2, r2]]),
      ].map(([q, r]) => `${q},${r}`);
      expect(new Set(cells).size, `ステージ ${i + 1}`).toBe(cells.length);
    });
  });

  it('押すのを覚えるステージより前は、どのステージも押せない', () => {
    LEVELS.forEach((l, i) => expect(l.push !== false, `ステージ ${i + 1}`).toBe(i >= PUSH_INTRO_AT));
  });

  it('どのステージも解けて、par が最少の発射数と合っている', () => {
    LEVELS.forEach((l, i) => {
      const best = solve(l, l.par);
      expect(best?.shots.length, `ステージ ${i + 1}`).toBe(l.par);
    });
  }, 600000); // 全ステージを総当たりで解くので、時間がかかる

  it('重いタイヤは、1つ減らすと最少の発射数では解けない（余る重いタイヤが無い）', () => {
    LEVELS.forEach((l, i) => {
      if (l.heavy > 0) expect(solve({ ...l, heavy: l.heavy - 1 }, l.par), `ステージ ${i + 1}`).toBeNull();
    });
  }, 600000);

  it('ヒントの通りに撃ち続けると、どのステージも最少の発射数でクリアできる', () => {
    LEVELS.forEach((l, i) => {
      let s = createState(l);
      while (s.status === 'playing') {
        const best = solveFrom(s, s.limit - s.shots);
        expect(best, `ステージ ${i + 1}`).not.toBeNull();
        s = fire(s, best!.shots[0])!.state;
      }
      expect(s.status, `ステージ ${i + 1}`).toBe('cleared');
      expect(s.shots, `ステージ ${i + 1}`).toBe(l.par);
    });
  }, 600000);

  it('残りのタイヤでは倒しきれない盤面では、ヒントは「無い」を返す', () => {
    // 的は右に2つ。タイヤは2個あるが、1発を何も無い向きに撃つと、残り1個では倒しきれない
    const s = createState(level({ targets: [[0, 0], [2, 0]] }), 2);
    const wasted = fire(s, { roller: 0, dir: 2, kind: 'light' })!.state;
    expect(solveFrom(wasted, 1)).toBeNull();
  });

  it('転師・的・壁・板が同じマスに重なっていない', () => {
    LEVELS.forEach((l, i) => {
      const keys = [...l.rollers, ...l.targets, ...l.walls, ...(l.plates ?? [])].map(([q, r]) => `${q},${r}`);
      expect(new Set(keys).size, `ステージ ${i + 1}`).toBe(keys.length);
    });
  });
});
