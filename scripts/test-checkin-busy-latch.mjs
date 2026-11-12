/**
 * F1 regression — the check-in button must survive a device-token failure.
 *
 * Audit 2026-11-13, F1: `checkIn()` had two sibling `try` blocks. The first
 * (`getToken()`) had a `catch` that returned, and the `finally` that resets
 * `busy` belonged to the *second* try. A token failure therefore left
 * `busy === true` and `inflight === true` forever: the button stayed disabled
 * and the employee could never clock in again without reloading the page —
 * the shift is never recorded, so it is never paid.
 *
 * This test drives the real component (real outbox, clock, error helpers; the
 * backend adapter is stubbed by scripts/lib/tsx-stub-loader.mjs) and asserts:
 *   1. after a token failure the button is operable again, and
 *   2. a second tap actually submits — the latch is released, not just the
 *      `disabled` prop.
 *
 * Fails on the pre-fix component; passes after the single-reset-site refactor.
 */
import assert from "node:assert/strict";

import React from "react";
import TestRenderer from "react-test-renderer";

/* ------------------------------------------------------------ browser-ish -- */

const listeners = { addEventListener() {}, removeEventListener() {} };
globalThis.window = listeners;
globalThis.document = { ...listeners, visibilityState: "visible" };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    userAgent: "jpay-test",
    onLine: true,
    geolocation: {
      getCurrentPosition: (ok) =>
        ok({ coords: { latitude: -26.2041, longitude: 28.0473, accuracy: 12 } }),
    },
  },
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/* --------------------------------------------------------------- backend --- */

let tokenAttempts = 0;
let createLogCalls = 0;

globalThis.__mockMutations = {
  issueMyDeviceToken: async () => {
    tokenAttempts += 1;
    if (tokenAttempts === 1) throw new Error("DEVICE_ALREADY_ACTIVE");
    return "device-token-ok";
  },
  createLog: async () => {
    createLogCalls += 1;
    return { duplicate: false };
  },
};

const { LiveSubmit } = await import("../src/app/check-in/live-submit.tsx");

/* ----------------------------------------------------------------- render -- */

let lastMessage = null;
function Parent() {
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState(null);
  lastMessage = message;
  return React.createElement(LiveSubmit, {
    phase: "off",
    status: "arrived",
    siteId: "site-1",
    sitesLoading: false,
    sites: [{ _id: "site-1", name: "Alpha" }],
    sideMinutes: 15,
    label: "Start shift",
    busy,
    setBusy,
    setMessage,
  });
}

let renderer;
await TestRenderer.act(async () => {
  renderer = TestRenderer.create(React.createElement(Parent));
});

const button = () =>
  renderer.root.findByProps({ "data-testid": "checkin-submit" });

async function tap() {
  await TestRenderer.act(async () => {
    button().props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
}

/* ------------------------------------------------------------- assertions -- */

assert.equal(button().props.disabled, false, "button starts enabled");

await tap(); // token fails

assert.equal(tokenAttempts, 1, "first tap asked for a device token");
assert.match(
  String(lastMessage),
  /Device already activated/i,
  `token failure must explain itself, got: ${JSON.stringify(lastMessage)}`
);
assert.equal(
  button().props["data-loading"],
  false,
  "F1: busy must be reset after a token failure (button latched forever)"
);
assert.equal(button().props.disabled, false, "F1: button must be tappable again");

await tap(); // token succeeds, punch submits

assert.equal(tokenAttempts, 2, "second tap retried the token");
assert.equal(createLogCalls, 1, "second tap must actually submit the punch");
assert.equal(lastMessage, "Shift started.", "success message");
assert.equal(button().props["data-loading"], false, "busy resets after success");

// useOutbox() runs a 15 s refresh interval; unmount so the process can exit.
await TestRenderer.act(async () => {
  renderer.unmount();
});

console.log("check-in busy latch: all assertions passed");
