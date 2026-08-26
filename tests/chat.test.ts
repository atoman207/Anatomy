import test from "node:test";
import assert from "node:assert/strict";

import { sortDmPair, shouldInitiateOffer } from "../src/lib/chat/shared";

test("sortDmPair returns the same order regardless of call order", () => {
  const a = "11111111-1111-1111-1111-111111111111";
  const b = "22222222-2222-2222-2222-222222222222";
  assert.deepEqual(sortDmPair(a, b), [a, b]);
  assert.deepEqual(sortDmPair(b, a), [a, b]);
});

test("sortDmPair is stable for equal ids (defensive, should never happen in practice)", () => {
  const a = "33333333-3333-3333-3333-333333333333";
  assert.deepEqual(sortDmPair(a, a), [a, a]);
});

test("shouldInitiateOffer: exactly one side of a pair initiates", () => {
  const a = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const b = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  assert.notEqual(shouldInitiateOffer(a, b), shouldInitiateOffer(b, a));
});

test("shouldInitiateOffer: the lexicographically lower id initiates", () => {
  const low = "10000000-0000-0000-0000-000000000000";
  const high = "90000000-0000-0000-0000-000000000000";
  assert.equal(shouldInitiateOffer(low, high), true);
  assert.equal(shouldInitiateOffer(high, low), false);
});

test("shouldInitiateOffer never has both sides initiate for the same pair, across many ids", () => {
  const ids = Array.from({ length: 20 }, (_, i) => `id-${i}-${Math.random().toString(36).slice(2)}`);
  for (const a of ids) {
    for (const b of ids) {
      if (a === b) continue;
      assert.notEqual(
        shouldInitiateOffer(a, b),
        shouldInitiateOffer(b, a),
        `both or neither initiated for (${a}, ${b})`,
      );
    }
  }
});
