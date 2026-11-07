'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../color-math.js');
const { buildPatternCsv } = require('../export-csv.js');
const { gamuts } = require('../presets.js');
const patterns = require('../patterns.js');
const base = M.validateConfig({ gamut: gamuts.rec709 });

// An independent CSV reader, including escaped quotes and multiline fields.
function readCsv(csv) {
  assert.equal(csv[0], '\uFEFF');
  const records = []; let record = [], field = '', quoted = false;
  for (let i = 1; i < csv.length; i++) {
    const char = csv[i];
    if (char === '"') {
      if (quoted && csv[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && char === ',') { record.push(field); field = ''; }
    else if (!quoted && char === '\r' && csv[i + 1] === '\n') {
      record.push(field); records.push(record); record = []; field = ''; i++;
    } else field += char;
  }
  assert.equal(quoted, false); assert.equal(field, ''); assert.deepEqual(record, []);
  const [headers, ...rows] = records;
  rows.forEach(row => assert.equal(row.length, headers.length));
  return { headers, rows: rows.map(row => Object.fromEntries(headers.map((name, i) => [name, row[i]]))) };
}

test('CSV contains a UTF-8 BOM, one header and all 39 patterns in library order', () => {
  const result = buildPatternCsv(patterns, base), parsed = readCsv(result.csv);
  assert.equal(result.count, 39); assert.equal(parsed.rows.length, 39);
  assert.deepEqual([...Buffer.from(result.csv, 'utf8').subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.deepEqual(parsed.headers, ['Pattern', 'x', 'y', 'Y_nit', 'R_code', 'G_code', 'B_code']);
  assert.deepEqual(parsed.rows.map(row => row.Pattern), patterns.map(pattern => pattern.name));
  assert.equal(parsed.rows[0].Pattern, 'White');
  assert.equal(Number(parsed.rows[0].Y_nit), 100);
  assert.ok(Math.abs(Number(parsed.rows[1].Y_nit) - 1e-9) < 1e-23);
  assert.ok(result.csv.endsWith('\r\n'));
});
test('every exported coordinate agrees exactly with the engine across presets and EOTFs', () => {
  for (const gamut of Object.values(gamuts)) for (const gamma of ['power', 'srgb', 'bt1886']) {
    const config = { ...base, gamut, gamma, black: 0.02, white: 120, bitDepth: 10, range: 'limited', exponent: 2.4 };
    const before = JSON.stringify(config), { rows } = readCsv(buildPatternCsv(patterns, config).csv);
    rows.forEach((row, i) => {
      const expected = M.resolvePattern(patterns[i], config);
      assert.deepEqual([Number(row.x), Number(row.y), Number(row.Y_nit)], [expected.target.xyY.x, expected.target.xyY.y, expected.target.xyY.Y]);
      assert.deepEqual([row.R_code, row.G_code, row.B_code].map(Number), expected.codes);
    });
    assert.equal(JSON.stringify(config), before);
  }
});
test('ideal versus quantized export follows the checkbox while retaining reference codes', () => {
  const quantized = readCsv(buildPatternCsv(patterns, base).csv).rows.find(row => row.Pattern === '50% Gray');
  const ideal = readCsv(buildPatternCsv(patterns, { ...base, quantize: false }).csv).rows.find(row => row.Pattern === '50% Gray');
  assert.equal(Number(ideal.Y_nit), 21.7637640824031);
  assert.notEqual(quantized.Y_nit, ideal.Y_nit);
  assert.equal(ideal.R_code, quantized.R_code);
});
test('CSV results reflect custom white, black/white, gamma, signal and rounding settings', () => {
  const config = { ...base, gamut: { ...gamuts.p3, white: [0.345669, 0.358496] }, gamma: 'bt1886', black: 0.1, white: 130, bitDepth: 10, range: 'limited', roundPercent: false };
  const parsed = readCsv(buildPatternCsv(patterns, config).csv), row = parsed.rows[0];
  assert.ok(Math.abs(Number(row.x) - config.gamut.white[0]) < 1e-15);
  assert.ok(Math.abs(Number(row.y) - config.gamut.white[1]) < 1e-15);
  assert.ok(Math.abs(Number(row.Y_nit) - 130) < 1e-12);
  assert.ok(Math.abs(Number(parsed.rows[1].Y_nit) - 0.1) < 1e-12);
  assert.deepEqual([row.R_code, row.G_code, row.B_code], ['940', '940', '940']);
  assert.ok(!parsed.headers.some(name => /Delta|measured/i.test(name)));
});
test('power exponent and segmented sRGB produce the correct gray luminance', () => {
  const power = readCsv(buildPatternCsv(patterns, { ...base, exponent: 2.6, quantize: false }).csv).rows.find(row => row.Pattern === '50% Gray');
  const srgb = readCsv(buildPatternCsv(patterns, { ...base, gamma: 'srgb', quantize: false }).csv).rows.find(row => row.Pattern === '50% Gray');
  assert.ok(Math.abs(Number(power.Y_nit) - 100 * 0.5 ** 2.6) < 1e-10);
  assert.ok(Math.abs(Number(srgb.Y_nit) - 100 * 0.21404114048223255) < 1e-10);
});
test('Chinese, commas, quotes and embedded line breaks round-trip in CSV cells', () => {
  const sample = { ...patterns[0], id: 'test,id', name: 'Skin, "测试"\r\n第二行', label: '中文，含"引号"与,逗号' };
  const result = buildPatternCsv([sample], base), row = readCsv(result.csv).rows[0];
  assert.equal(row.Pattern, sample.name);
  assert.ok(result.csv.includes('"Skin, ""测试""\r\n第二行"'));
});
test('out-of-gamut and black floor results are retained without extra columns', () => {
  const sample = { id: 'wide-red', name: 'Wide red', label: '超色域红', type: 'xyYn', x: 0.708, y: 0.292, Yn: 1 };
  const wide = readCsv(buildPatternCsv([sample], base).csv).rows[0];
  const expected = M.resolvePattern(sample, base);
  assert.deepEqual([Number(wide.x), Number(wide.y), Number(wide.Y_nit)], [expected.target.xyY.x, expected.target.xyY.y, expected.target.xyY.Y]);
  assert.equal(Object.keys(wide).length, 7);
  const black = readCsv(buildPatternCsv([patterns[1]], base).csv).rows[0];
  assert.equal(Number(black.Y_nit), M.resolvePattern(patterns[1], base).target.xyY.Y);
});
test('invalid settings or patterns throw instead of returning a partial CSV', () => {
  assert.throws(() => buildPatternCsv(patterns, { ...base, white: 0 }));
  assert.throws(() => buildPatternCsv([], base)); assert.throws(() => buildPatternCsv(null, base));
  assert.throws(() => buildPatternCsv([patterns[0], { ...patterns[0], rgb: [NaN, 0, 0] }], base));
});
test('download filename is safe and identifies gamut, gamma, bit depth, range and mode', () => {
  const result = buildPatternCsv(patterns, { ...base, gamut: { ...gamuts.p3, name: 'P3: D65 / Test <>"?*|' }, exponent: 2.4, quantize: false });
  assert.match(result.filename, /^calman-patterns_P3-D65-Test_Power-2\.4_8bit-full_ideal\.csv$/);
  assert.ok(!/[<>:"/\\|?*]/.test(result.filename)); assert.equal(result.count, 39);
});
