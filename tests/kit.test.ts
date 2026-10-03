import { describe, expect, it } from 'vitest';
import { canonical, diffTraces, fingerprint } from '../src/kit/golden';
import { createStepper } from '../src/kit/loop';
import { createRng } from '../src/kit/rng';
import { createSave, type StorageLike } from '../src/kit/save';

function fakeStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe('乱数', () => {
  it('同じ種なら同じ並びになる', () => {
    const a = createRng(7), b = createRng(7);
    expect(Array.from({ length: 20 }, () => a.next())).toEqual(Array.from({ length: 20 }, () => b.next()));
  });

  it('種が違えば並びが違う', () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next());
  });

  it('int は範囲内の整数、pick は配列の要素を返す', () => {
    const rng = createRng(3);
    for (let i = 0; i < 500; i++) {
      const n = rng.int(6);
      expect(Number.isInteger(n) && n >= 0 && n < 6).toBe(true);
      expect(['a', 'b', 'c']).toContain(rng.pick(['a', 'b', 'c']));
    }
  });
});

describe('セーブ', () => {
  it('保存した内容を読み戻せる', () => {
    const storage = fakeStorage();
    createSave('k', { wins: 0 }, storage).save({ wins: 3 });
    expect(createSave('k', { wins: 0 }, storage).load()).toEqual({ wins: 3 });
  });

  it('保存が無ければ既定値、後から足した項目も既定値で埋まる', () => {
    const storage = fakeStorage();
    expect(createSave('k', { wins: 0 }, storage).load()).toEqual({ wins: 0 });
    storage.setItem('k', JSON.stringify({ wins: 2 }));
    expect(createSave('k', { wins: 0, muted: false }, storage).load()).toEqual({ wins: 2, muted: false });
  });

  it('壊れたデータでも既定値で動く', () => {
    const storage = fakeStorage();
    storage.setItem('k', '{こわれた');
    expect(createSave('k', { wins: 0 }, storage).load()).toEqual({ wins: 0 });
  });

  it('保存できない環境でもエラーにならない', () => {
    const broken: StorageLike = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    };
    const save = createSave('k', { wins: 0 }, broken);
    expect(() => save.save({ wins: 1 })).not.toThrow();
    expect(save.load()).toEqual({ wins: 0 });
    expect(() => save.clear()).not.toThrow();
  });
});

describe('毎フレーム進める仕組み', () => {
  it('経過時間を刻みの回数に直し、余りは次へ持ち越す', () => {
    const stepper = createStepper(10);
    expect(stepper.advance(25)).toEqual({ steps: 2, alpha: 0.5 });
    expect(stepper.advance(5)).toEqual({ steps: 1, alpha: 0 });
    expect(stepper.advance(4)).toEqual({ steps: 0, alpha: 0.4 });
  });

  it('画面の更新間隔が違っても、同じ時間なら同じ回数だけ進む', () => {
    const count = (frameMs: number) => {
      const stepper = createStepper(10);
      let steps = 0;
      for (let t = 0; t < 1200; t += frameMs) steps += stepper.advance(frameMs).steps;
      return steps;
    };
    expect(count(8)).toBe(120);
    expect(count(16)).toBe(120);
    expect(count(30)).toBe(120);
  });

  it('長く止まった後は上限までしか進めず、溜まった時間は捨てる', () => {
    const stepper = createStepper(10, 5);
    expect(stepper.advance(60_000)).toEqual({ steps: 5, alpha: 0 });
    expect(stepper.advance(10)).toEqual({ steps: 1, alpha: 0 });
  });

  it('reset で持ち越しを消す。負の経過時間は 0 として扱う', () => {
    const stepper = createStepper(10);
    stepper.advance(9);
    stepper.reset();
    expect(stepper.advance(1).steps).toBe(0);
    expect(stepper.advance(-50).steps).toBe(0);
  });
});

describe('動作記録との照合', () => {
  it('キーの並び順が違っても、同じ状態なら同じ文字列になる', () => {
    expect(canonical({ a: 1, b: [1, { y: 2, x: 1 }] })).toBe(canonical({ b: [1, { x: 1, y: 2 }], a: 1 }));
    expect(fingerprint({ a: 1, b: 2 })).toBe(fingerprint({ b: 2, a: 1 }));
    expect(canonical({ a: undefined, b: null })).toBe('{"b":null}');
  });

  it('状態が少しでも違えば、別の文字列になる', () => {
    expect(fingerprint({ board: [1, 2, 3] })).not.toBe(fingerprint({ board: [1, 3, 2] }));
    expect(fingerprint({ n: 1 })).not.toBe(fingerprint({ n: '1' }));
    expect(fingerprint({ n: 1 })).toMatch(/^[0-9a-f]{16}$/);
  });

  it('一致すれば空、食い違えば場面の名前と位置を返す', () => {
    const recorded = { a: ['x', 'y', 'z'], b: ['p', 'q'], gone: ['q'] };
    expect(diffTraces(recorded, recorded)).toEqual([]);
    const problems = diffTraces(recorded, { a: ['x', 'Y', 'z'], b: ['p'], added: ['r'] });
    expect(problems).toHaveLength(4);
    expect(problems.find((p) => p.startsWith('a:'))).toContain('1 番目');
    expect(problems.find((p) => p.startsWith('b:'))).toContain('長さ');
    expect(problems.find((p) => p.startsWith('gone:'))).toContain('今は無い');
    expect(problems.find((p) => p.startsWith('added:'))).toContain('記録に無い');
  });
});
