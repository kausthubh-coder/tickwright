/** Absolute deadlines prevent generation work from making setInterval drift.
 * Catch-up is bounded per event-loop turn; the remaining debt is retained. */
export class Ticker {
  next: number;
  constructor(now: number) { this.next = now + 50; }
  advance(now: number, tick: () => void) {
    let count = 0;
    while (now >= this.next && count < 4) {
      this.next += 50;
      count++;
      tick();
    }
    return count;
  }
}
