import { expect, test } from "bun:test";
import { nextRandom } from "../packages/sim/src/clock";

test("saved random state resumes the same simulation sequence", () => {
  const original = { seed: 42 };
  for (let index = 0; index < 100; index++) nextRandom(original);
  const restored = JSON.parse(JSON.stringify(original));
  for (let index = 0; index < 100; index++) {
    const value = nextRandom(original);
    expect(nextRandom(restored)).toBe(value);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(1);
  }
});
