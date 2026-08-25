#!/usr/bin/env node
// The JavaScript half of the conformance suite.
//
// Prints one "<algo> <step> <hash>" line per step, exactly as
// `orrery hash --all-steps` does. scripts/conformance.sh diffs the two streams.
// If the Go and JS players ever disagree about state at step 42, that is the
// line that changes.
//
// This duplication is the POINT, not an accident: a format specified by one
// implementation is a format specified by nothing.

import { readFileSync } from 'node:fs';
import { State } from '../src/player/state.js';
import { buildSteps } from '../src/player/steps.js';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: hash.mjs FILE...');
  process.exit(2);
}

for (const path of files) {
  const trace = JSON.parse(readFileSync(path, 'utf8'));
  const name = trace.meta?.algo ?? path;
  const state = new State(trace);
  const steps = buildSteps(trace.events, 0);

  const hex = (h) => h.toString(16).padStart(16, '0');
  console.log(`${name} 0 ${hex(state.hash())}`);
  for (let k = 0; k < steps.length; k++) {
    const { e0, e1 } = steps[k];
    for (let i = e0; i < e1; i++) state.forward(i, trace.events[i], null);
    console.log(`${name} ${k + 1} ${hex(state.hash())}`);
  }

  // Also assert invariant I1 here, cheaply: rewinding the whole trace must
  // return to the starting hash. A JS-only regression in `backward` would
  // otherwise be invisible to the diff, because the diff only compares the
  // forward pass.
  const start = new State(trace).hash();
  for (let k = steps.length - 1; k >= 0; k--) {
    const { e0, e1 } = steps[k];
    for (let i = e1 - 1; i >= e0; i--) state.backward(i, trace.events[i], null);
  }
  if (state.hash() !== start) {
    console.error(`${name}: JS rewind does not return to the initial state`);
    process.exit(1);
  }
}
