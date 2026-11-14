import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = async (name) => JSON.parse(await readFile(new URL(`../src/data/${name}`, import.meta.url), "utf8"));

test("both comparison scenarios contain six computed 72-hour rows", async () => {
  for (const name of ["comparison.json", "comparison-delay48.json"]) {
    const payload = await read(name);
    assert.equal(payload.result.rows.length, 6);
    assert.equal(payload.result.period.mission_duration_hours, 72);
    assert.equal(payload.result.data_status, "computed");
    assert.equal(payload.result.is_demo_data, false);
  }
});

test("all published metrics obey duration invariants", async () => {
  for (const name of ["comparison.json", "comparison-delay48.json"]) {
    const payload = await read(name);
    for (const row of payload.result.rows) {
      const m = row.metrics;
      assert.ok(m.sun_visible_hours >= 0 && m.sun_visible_hours <= 72);
      assert.ok(m.earth_visible_hours >= 0 && m.earth_visible_hours <= 72);
      assert.ok(m.sun_and_earth_visible_hours <= Math.min(m.sun_visible_hours, m.earth_visible_hours));
      assert.ok(Math.abs(m.sun_visible_hours + m.sun_not_visible_hours + m.sun_unknown_hours - 72) < 0.001);
      assert.ok(Math.abs(m.earth_visible_hours + m.earth_not_visible_hours + m.earth_unknown_hours - 72) < 0.001);
    }
  }
});

test("the +48 hour scenario exposes the documented mission shift", async () => {
  const base = await read("comparison.json");
  const delay = await read("comparison-delay48.json");
  const byName = (payload, name) => payload.result.rows.find((row) => row.name === name);
  assert.equal(byName(base, "Connecting Ridge").earth_visible_hours, 25.8793);
  assert.equal(byName(delay, "Connecting Ridge").earth_visible_hours, 72);
  assert.equal(byName(base, "Malapert Massif").sun_visible_hours, 47.6327);
  assert.equal(byName(delay, "Malapert Massif").sun_visible_hours, 0);
});

test("Malapert detailed series spans 72 hours at 240-second cadence", async () => {
  const series = await read("malapert-timeseries.json");
  assert.equal(series.period.step_s, 240);
  assert.equal(series.samples.length, 1081);
  assert.equal(series.samples[0].time_utc, series.period.start_utc);
  assert.equal(series.samples.at(-1).time_utc, series.period.end_utc);
});
