/**
 * A chart is a table of numbers a store typed, and the two kinds of table cannot
 * be told apart by their labels: one is a tape round a body, the other is a tape
 * across a garment lying flat. Reading a flat table as a body table puts every
 * shopper above the largest row, which is how a 38" chest was answered XXL by a
 * chart whose whole chest column runs 22.75 to 27.75.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { bestSize, chartFromInput } from '../src/lib/sizing.js';

const FLAT = {
  name: 'Mil Spec Crew',
  sex: 'male',
  unit: 'in',
  columns: [
    { id: 'col1', label: 'Chest', measure: 'chest' },
    { id: 'col2', label: 'Arm Length', measure: null },
  ],
  rows: [
    { key: 'S', col1: 22.75, col2: 26.75 },
    { key: 'M', col1: 23.75, col2: 27.25 },
    { key: 'L', col1: 24.75, col2: 27.75 },
    { key: 'XL', col1: 25.75, col2: 28.25 },
    { key: 'XXL', col1: 27.75, col2: 28.75 },
  ],
};

const GIRTH = {
  name: 'Body chart',
  sex: 'male',
  unit: 'in',
  columns: [{ id: 'c1', label: 'Chest', measure: 'chest' }],
  rows: [
    { key: 'S', c1: 36 },
    { key: 'M', c1: 40 },
    { key: 'L', c1: 44 },
    { key: 'XL', c1: 48 },
  ],
};

test('a garment measured flat is compared with half the body, not the whole', () => {
  const chart = chartFromInput(FLAT);
  assert.ok(chart);
  assert.equal(chart.columns[0].flat, true, 'a chest column topping out at 27.75" is flat');

  const size = bestSize('male', { chest: 38, waist: 32, hips: 36 }, chart.rows, chart.columns);
  assert.ok(size);
  // 38" round is 19" across. Every row of this table is wider than that, so the
  // smallest row is the one that covers the body - not the largest, which is what
  // comparing 38 with 27.75 used to answer.
  assert.equal(size.sizeKey, 'S');
  assert.equal(size.flat, true);
});

test('a tie between two sizes goes to the larger one', () => {
  // 38" is two inches from a 36" row and two from a 40" one. The 40" garment is
  // the one that closes.
  const chart = chartFromInput(GIRTH);
  assert.ok(chart);
  const size = bestSize('male', { chest: 38 }, chart.rows, chart.columns);
  assert.equal(size.sizeKey, 'M');
});

test('a chart of real girths is left alone', () => {
  const chart = chartFromInput(GIRTH);
  assert.ok(chart);
  assert.ok(!chart.columns[0].flat, 'a chest column reaching 48" is a body chart');
  const size = bestSize('male', { chest: 37.5 }, chart.rows, chart.columns);
  assert.equal(size.sizeKey, 'S'); // 37.5 is nearer 36 than 40
  assert.equal(size.flat, false);
});

test('centimetres are still inches by the time a size is chosen', () => {
  const cm = {
    unit: 'cm',
    columns: [{ id: 'c1', label: 'Chest', measure: 'chest' }],
    rows: [
      { key: 'S', c1: 96 }, // 37.8"
      { key: 'M', c1: 102 }, // 40.2"
    ],
  };
  const chart = chartFromInput(cm);
  assert.ok(chart);
  assert.ok(!chart.columns[0].flat, '37.8" is a body chest, not a flat one');
  assert.equal(bestSize('male', { chest: 40 }, chart.rows, chart.columns).sizeKey, 'M');
});

test('a column with no measure is never reinterpreted', () => {
  const odd = {
    unit: 'in',
    columns: [
      { id: 'c1', label: 'Chest', measure: 'chest' },
      { id: 'c2', label: 'Length', measure: null },
    ],
    rows: [{ key: 'S', c1: 36, c2: 20 }, { key: 'M', c1: 40, c2: 24 }],
  };
  const chart = chartFromInput(odd);
  assert.ok(chart);
  assert.ok(!chart.columns[0].flat, '36" is a body chest');
  assert.ok(!chart.columns[1].flat, 'an unmeasured 20" length is not someone\'s chest');
});
