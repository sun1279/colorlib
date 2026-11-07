'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../color-math.js');
const { gamuts } = require('../presets.js');
const patterns = require('../patterns.js');
const base = M.validateConfig({ gamut: gamuts.rec709, range: 'limited' });
const near = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected}, tolerance ${tolerance}`);
const vector = (a, b, tolerance) => a.forEach((v, i) => near(v, b[i], tolerance));
const pattern = id => patterns.find(p => p.id === id);

test('Rec.709 matrix agrees with published D65 0.3127/0.3290 coefficients', () => {
  const matrix = M.buildRgbXyzMatrix({ ...gamuts.rec709, white: [0.3127, 0.3290] });
  vector(matrix.flat(), [0.4123907993, 0.3575843394, 0.1804807884, 0.2126390059, 0.7151686788, 0.0721923154, 0.0193308187, 0.1191947798, 0.9505321522], 6e-11);
});
test('all presets sum to the selected reference white', () => {
  for (const gamut of Object.values(gamuts)) {
    vector(M.multiply(M.buildRgbXyzMatrix(gamut), [1, 1, 1]), M.xyYToXYZ({ x: gamut.white[0], y: gamut.white[1], Y: 1 }));
  }
});
test('power gray and white have expected absolute luminance', () => {
  near(M.calculateTarget([0.5, 0.5, 0.5], base).xyY.Y, 21.7637640824031);
  near(M.calculateTarget([1, 1, 1], base).xyY.Y, 100);
  const c = { ...base, black: 0.1, white: 120 };
  near(M.calculateTarget([0.5, 0.5, 0.5], c).xyY.Y, 0.1 + 119.9 * 0.5 ** 2.2);
});
test('sRGB and BT.1886 reference values and nonzero black endpoints', () => {
  near(M.eotf(0.5, { ...base, gamma: 'srgb' }), 0.21404114048223255);
  near(M.eotf(0.04045, { ...base, gamma: 'srgb' }), 0.04045 / 12.92);
  near(M.eotf(0.5, { ...base, gamma: 'bt1886' }), 0.18946457081379978);
  const c = { ...base, gamma: 'bt1886', black: 0.1 };
  near(M.eotf(0, c) * c.white, 0.1);
  near(M.eotf(1, c) * c.white, 100);
  // Independent closed-form BT.1886 gray luminance, L = (V*(Lw^1/2.4-Lb^1/2.4)+Lb^1/2.4)^2.4.
  near(M.calculateTarget([0.5, 0.5, 0.5], c).xyY.Y, (0.5 * (100 ** (1 / 2.4) - 0.1 ** (1 / 2.4)) + 0.1 ** (1 / 2.4)) ** 2.4);
});
test('black floor preserves the source convention and nonzero black is exact', () => {
  const zero = M.calculateTarget([0, 0, 0], base);
  near(zero.xyY.Y, 1e-9, 1e-20);
  near(zero.xyY.x, gamuts.rec709.white[0]);
  near(M.calculateTarget([0, 0, 0], { ...base, black: 0.03 }).xyY.Y, 0.03);
});
test('primary xy stays at the primary with nonzero black, rather than white contamination', () => {
  for (const gamma of ['power', 'srgb', 'bt1886']) {
    const result = M.calculateTarget([1, 0, 0], { ...base, black: 0.5, gamma });
    near(result.xyY.x, 0.64); near(result.xyY.y, 0.33);
  }
});
test('bankers rounding matches .NET and video range mappings', () => {
  vector([0.5, 1.5, 2.5, 3.5, -0.5, -1.5].map(M.roundEven), [0, 2, 2, 4, 0, -2]);
  assert.deepEqual(M.quantizeRgb([0, 0.5, 1], base).codes, [16, 126, 235]);
  assert.deepEqual(M.quantizeRgb([0, 0.5, 1], { ...base, range: 'full' }).codes, [0, 128, 255]);
  assert.deepEqual(M.quantizeRgb([0, 0.5, 1], { ...base, bitDepth: 10 }).codes, [64, 502, 940]);
  assert.deepEqual(M.quantizeRgb([0, 0.5, 1], { ...base, bitDepth: 10, range: 'full' }).codes, [0, 512, 1023]);
  assert.equal(M.quantizeRgb([0.345, 0, 0], base).rounded[0], 0.34);
});
test('signal gray and ColorChecker Gray 50 retain distinct definitions', () => {
  const c = { ...base, quantize: false };
  const signal = M.resolvePattern(pattern('gray-50'), c), relative = M.resolvePattern(pattern('cc-gray-50'), c);
  near(signal.target.xyY.Y, 21.7637640824031);
  near(relative.target.xyY.Y, 50);
  const quantized = M.resolvePattern(pattern('gray-50'), base);
  assert.equal(quantized.codes[0], 126);
  near(quantized.actual[0], 110 / 219);
});
test('built-in skin signals use fixed 2.2 encoding while targets follow chosen gamma', () => {
  const a = M.resolvePattern(pattern('cc-dark-skin'), base), b = M.resolvePattern(pattern('cc-dark-skin'), { ...base, exponent: 2.4 });
  assert.deepEqual(a.codes, b.codes);
  vector([a.nominalXyY.x, a.nominalXyY.y, a.nominalXyY.Y], [0.405119, 0.36253, 0.096774]);
  assert.ok(Math.abs(a.target.xyY.Y - b.target.xyY.Y) > 0.5);
  assert.notEqual(a.target.xyY.x, a.nominalXyY.x);
});
test('out-of-gamut patterns warn and produce legal codes', () => {
  const result = M.resolvePattern({ type: 'xyYn', x: 0.708, y: 0.292, Yn: 1 }, base);
  assert.ok(result.warnings.length > 0);
  assert.ok(result.codes.every(v => v >= 16 && v <= 235));
});
test('xyY conversion and known Lab white/black values', () => {
  vector(M.xyYToXYZ({ x: 0.4, y: 0.3, Y: 30 }), [40, 30, 30]);
  assert.deepEqual(M.xyzToXyY([0, 0, 0]), { x: null, y: null, Y: 0 });
  vector(M.xyzToLab([95.047, 100, 108.883], [95.047, 100, 108.883]), [100, 0, 0]);
  vector(M.xyzToLab([0, 0, 0], [95.047, 100, 108.883]), [0, 0, 0]);
  near(M.deltaE76([50, 0, 0], [53, 4, 0]), 5);
  near(M.deltaE94([50, 25, 0], [50, 20, 0]), 5 / 1.9);
});
test('all patterns, gamuts, gammas, depths and ranges produce finite targets', () => {
  for (const gamut of Object.values(gamuts)) for (const gamma of ['power', 'srgb', 'bt1886']) for (const bitDepth of [8, 10]) for (const range of ['limited', 'full']) for (const p of patterns) {
    const c = { ...base, gamut, gamma, bitDepth, range, black: 0.01 };
    const r = M.resolvePattern(p, c);
    assert.ok([...r.target.xyz, ...r.target.lab].every(Number.isFinite), p.id);
    assert.ok(r.target.xyY.Y >= c.black - 1e-10 && r.target.xyY.Y <= c.white + 1e-10);
  }
});
test('identical XYZ yields zero in every color difference formula', () => {
  const xyz = [20, 18, 10], whiteXYZ = [95.047, 100, 108.883];
  const result = M.calculateDeltaE(xyz, xyz, { whiteXYZ });
  for (const key of ['de76', 'de76luv', 'de94', 'de2000']) near(result[key], 0);
});
test('luminance compensation removes a pure intensity error and scale units cancel', () => {
  const whiteXYZ = [95.047, 100, 108.883], target = [30, 20, 10], measured = [33, 22, 11];
  const raw = M.calculateDeltaE(measured, target, { whiteXYZ }), compensated = M.calculateDeltaE(measured, target, { whiteXYZ, compensateLuminance: true });
  assert.ok(raw.de2000 > 1); near(compensated.de2000, 0);
  near(raw.de2000, M.calculateDeltaE(measured.map(x => x / 100), target.map(x => x / 100), { whiteXYZ: whiteXYZ.map(x => x / 100) }).de2000);
});
test('invalid inputs fail loudly rather than returning NaN or stale results', () => {
  for (const config of [{ black: -1 }, { white: 0 }, { black: 100 }, { exponent: NaN }, { exponent: 0 }, { bitDepth: 12 }, { gamma: 'pq' }]) assert.throws(() => M.validateConfig({ ...base, ...config }));
  for (const xyY of [{ x: 0.4, y: 0, Y: 1 }, { x: 0.7, y: 0.5, Y: 1 }, { x: NaN, y: 0.3, Y: 1 }, { x: 0.3, y: 0.3, Y: -1 }]) assert.throws(() => M.xyYToXYZ(xyY));
  assert.throws(() => M.calculateTarget([NaN, 0, 0], base));
  assert.throws(() => M.calculateTarget([1.1, 0, 0], base));
  assert.throws(() => M.buildRgbXyzMatrix({ primaries: [[0.3, 0.3], [0.3, 0.3], [0.3, 0.3]], white: [0.3, 0.3] }));
  assert.throws(() => M.calculateDeltaE([0, 0, 0], [1, 1, 1], { whiteXYZ: [1, 1, 1], compensateLuminance: true }));
});

test('matrix trace reconstructs the selected white and both conversion matrices', () => {
  const trace = {}, matrix = M.buildRgbXyzMatrix(gamuts.rec2020, trace);
  vector(M.multiply(trace.raw, trace.scale), trace.white);
  vector(M.multiply(matrix, [1, 1, 1]), trace.white);
  vector(M.multiply(trace.inverse, trace.white), [1, 1, 1]);
  assert.deepEqual(trace.matrix, matrix);
});
test('pattern trace preserves clipping and quantization provenance', () => {
  const p = { type: 'xyYn', x: 0.708, y: 0.292, Yn: 1 };
  const result = M.resolvePattern(p, base), { definition: d, quantization: q } = result.trace;
  assert.ok(d.divisor > 1);
  assert.ok(d.linear.some(v => v < 0));
  assert.ok(d.clipped.every(v => v >= 0 && v <= 1));
  d.clipped.forEach((v, i) => near(v, result.rgb[i] ** 2.2));
  assert.deepEqual(q.codes, result.codes);
  assert.deepEqual(result.trace.signal, result.actual);
  const ideal = M.resolvePattern(pattern('gray-50'), { ...base, quantize: false });
  assert.deepEqual(ideal.trace.signal, [0.5, 0.5, 0.5]);
  assert.notDeepEqual(ideal.trace.signal, ideal.trace.quantization.actual);
});
test('EOTF trace records actual sRGB branches and BT.1886 coefficients', () => {
  const lo = {}, hi = {}, bt = {}, c = { ...base, gamma: 'srgb', black: 0.1 };
  near(M.eotf(0.02, c, lo), 0.001 + 0.999 * 0.02 / 12.92);
  near(M.eotf(0.5, c, hi), 0.001 + 0.999 * 0.21404114048223255);
  assert.equal(lo.branch, 's / 12.92'); assert.equal(hi.branch, '((s + 0.055) / 1.055)^2.4');
  const y = M.eotf(0.5, { ...c, gamma: 'bt1886' }, bt);
  near(bt.rootLight, bt.a * 0.5 + bt.b); near(bt.absolute / 100, y); near(bt.result, y);
});
test('target trace reconstructs absolute XYZ, Lab and Luv across every EOTF', () => {
  for (const gamma of ['power', 'srgb', 'bt1886']) {
    const c = { ...base, gamma, black: 0.1 }, target = M.resolvePattern(pattern('cc-dark-skin'), c).target, t = target.trace;
    const unoffset = M.multiply(t.matrix.matrix, t.linear);
    vector(unoffset, t.unoffset);
    const restoredY = (unoffset[1] * (1 - t.k) + t.k) * c.white;
    near(restoredY, target.xyY.Y);
    vector(M.xyYToXYZ({ x: t.xy.x, y: t.xy.y, Y: restoredY }), target.xyz);
    vector(t.lab.result, target.lab); vector(t.luv.result, target.luv);
    vector(t.lab.ratios, target.xyz.map((v, i) => v / t.white[i]));
  }
  const black = M.calculateTarget([0, 0, 0], base);
  assert.equal(black.trace.floorApplied, true); assert.equal(black.trace.rawYn, 0); near(black.trace.Yn, 1e-11);
});
test('color difference trace records both raw and compensated comparison inputs', () => {
  const measured = [33, 22, 11], target = [30, 20, 10], whiteXYZ = [95.047, 100, 108.883];
  for (const compensateLuminance of [false, true]) {
    const result = M.calculateDeltaE(measured, target, { whiteXYZ, compensateLuminance }), t = result.trace;
    assert.deepEqual(t.measuredXYZ, measured); assert.deepEqual(t.targetXYZ, target);
    vector(t.comparisonXYZ, compensateLuminance ? measured : target);
    vector(t.measuredLab.result, result.measuredLab); vector(t.targetLab.result, result.targetLab);
    for (const key of ['de76', 'de76luv', 'de94', 'de2000']) near(t[key].result, result[key]);
    near(Math.sqrt(t.de76.squares.reduce((a, b) => a + b, 0)), result.de76);
    near(Math.sqrt(t.de94.terms.reduce((a, b) => a + b, 0)), result.de94);
    near(Math.sqrt(Math.max(0, t.de2000.terms.reduce((a, b) => a + b, 0))), result.de2000);
    if (compensateLuminance) near(t.de2000.result, 0);
    else assert.ok(t.de2000.result > 1);
  }
});

// G. Sharma, W. Wu, E. N. Dalal, supplementary data, 2005.
// https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/dataNprograms/ciede2000testdata.txt
const samples = fs.readFileSync(path.join(__dirname, 'ciede2000-reference.txt'), 'utf8').trim().split(/\r?\n/).map(line => line.trim().split(/\s+/).map(Number));
assert.equal(samples.length, 34);
samples.forEach((values, index) => test(`CIEDE2000 Sharma reference ${index + 1}/34`, () => {
  const trace = {};
  near(M.deltaE2000(values.slice(3, 6), values.slice(0, 3), trace), values[6], 0.000051);
  near(trace.result, values[6], 0.000051);
  near(trace.RT, -trace.RC * Math.sin(2 * trace.theta * Math.PI / 180));
  near(M.deltaE2000(values.slice(0, 3), values.slice(3, 6)), values[6], 0.000051);
}));
