(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./color-math.js'));
  else root.CalmanCsv = factory(root.CalmanMath);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (M) {
  'use strict';
  const headers = [
    'Pattern', 'x', 'y', 'Y_nit', 'R_code', 'G_code', 'B_code'
  ];
  function csvCell(value) {
    // String(number) retains a double's round-trippable precision, including
    // the small nonzero black target floor. Never format from screen text.
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }
  function filenamePart(value) {
    return String(value).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'custom';
  }
  function buildPatternCsv(patterns, config) {
    const c = M.validateConfig(config);
    if (!Array.isArray(patterns) || patterns.length === 0) throw new Error('没有可导出的 Pattern。');
    const gamma = c.gamma === 'power' ? 'Power' : c.gamma === 'srgb' ? 'sRGB' : 'BT.1886';
    // Calculate the complete snapshot before creating any downloadable data.
    const rows = patterns.map(pattern => {
      const result = M.resolvePattern(pattern, c), { x, y, Y } = result.target.xyY;
      if (![x, y, Y, ...result.actual].every(Number.isFinite)) throw new Error('Pattern ' + pattern.name + ' 的计算结果无效，未生成 CSV。');
      return [pattern.name, x, y, Y, ...result.codes];
    });
    const csv = '\uFEFF' + [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
    const gammaPart = gamma + (c.gamma === 'power' ? '-' + c.exponent : '');
    const filename = `calman-patterns_${filenamePart(c.gamut.name || 'Custom')}_${filenamePart(gammaPart)}_${c.bitDepth}bit-${c.range}_${c.quantize ? 'quantized' : 'ideal'}.csv`;
    return { csv, filename, count: rows.length };
  }
  return { buildPatternCsv };
});
