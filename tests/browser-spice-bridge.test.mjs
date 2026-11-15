import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpiceBridge } from '../public/runtime/cspice-bridge.js';

function runtime(failures = 0) {
  let next = 8;
  let error;
  const strings = new Map();
  const freed = [];
  const epochs = [];
  const module = {
    HEAPF64: new Float64Array(4096),
    _malloc(size) { const pointer = next; next += Math.ceil(size / 8) * 8; return pointer; },
    _free(pointer) { freed.push(pointer); },
    stringToNewUTF8(value) { const pointer = this._malloc(value.length + 1); strings.set(pointer, value); return pointer; },
    _str2et_c(value, output) { assert.equal(strings.get(value), '2029-01-10T12:00:00Z'); this.HEAPF64[output / 8] = 916012869.184; },
    _spkpos_c(target, epoch, frame, correction, observer, output, light) {
      epochs.push(epoch);
      assert.equal(strings.get(target), 'SUN');
      assert.equal(strings.get(frame), 'MOON_ME_DE421');
      assert.equal(strings.get(correction), 'LT+S');
      assert.equal(strings.get(observer), 'MOON');
      if (failures-- > 0) { error = new Error('SPICE(SPKINSUFFDATA)'); return; }
      this.HEAPF64.set([1.5e8, epoch, -3e7], output / 8);
      this.HEAPF64[light / 8] = 499.123456789;
    },
    naifCheckErrors() { const previous = error; error = undefined; if (previous) throw previous; },
  };
  return { module, freed, epochs };
}

const query = { operation: 'spkpos', target: 'SUN', epochs: [916012869.184, 916013109.184], frame: 'MOON_ME_DE421', correction: 'LT+S', observer: 'MOON' };

test('UTC conversion and epoch batches retain double precision across the JSON boundary', () => {
  const state = runtime();
  const bridge = createSpiceBridge(state.module, () => assert.fail('Unexpected reset'));
  assert.equal(JSON.parse(bridge.request(JSON.stringify({ operation: 'str2et', value: '2029-01-10T12:00:00Z' }))), 916012869.184);
  const result = JSON.parse(bridge.request(JSON.stringify(query)));
  assert.deepEqual(result.map(row => row.ptarg[1]), query.epochs);
  assert.equal(result[0].lt, 499.123456789);
  assert.ok(state.freed.length > 0);
});

test('insufficient-data state reloads kernels once and retries the identical epoch', () => {
  const state = runtime(1);
  let resets = 0;
  const bridge = createSpiceBridge(state.module, () => resets++);
  const result = JSON.parse(bridge.request(JSON.stringify(query)));
  assert.equal(resets, 1);
  assert.deepEqual(state.epochs, [query.epochs[0], ...query.epochs]);
  assert.equal(result.length, 2);
});

test('persistent kernel errors remain errors instead of returning fabricated positions', () => {
  const state = runtime(2);
  let resets = 0;
  const bridge = createSpiceBridge(state.module, () => resets++);
  assert.throws(() => bridge.request(JSON.stringify(query)), /SPKINSUFFDATA/);
  assert.equal(resets, 1);
  assert.equal(state.epochs.length, 2);
});
