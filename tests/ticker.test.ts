import { expect, test } from "bun:test";
import { Ticker } from "../apps/server/src/ticker";

test("delayed room callbacks retain 20 Hz rather than accumulating interval drift", () => {
  const ticker = new Ticker(0);
  let ticks = 0;
  for (let time = 75; time <= 6000; time += 75) ticker.advance(time, () => ticks++);
  expect(ticks).toBe(120);
  expect(ticker.advance(6001, () => ticks++)).toBe(0);
});

test("catch-up yields after four ticks and retains the remaining debt", () => {
  const ticker = new Ticker(0);
  let ticks = 0;
  expect(ticker.advance(1000, () => ticks++)).toBe(4);
  for (let i = 0; i < 4; i++) ticker.advance(1000, () => ticks++);
  expect(ticks).toBe(20);
  expect(ticker.advance(1000, () => ticks++)).toBe(0);
});
