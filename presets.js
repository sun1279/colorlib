(function (root) {
  'use strict';
  const whitePoints = {
    d65: { name: 'D65 · Calman', xy: [0.312713, 0.329016] },
    d50: { name: 'D50 · Calman', xy: [0.345669, 0.358496] },
    cinema: { name: 'DCI 白点', xy: [0.314, 0.351] }
  };
  const gamuts = {
    rec709: { name: 'Rec.709 / sRGB', primaries: [[0.64, 0.33], [0.3, 0.6], [0.15, 0.06]], white: whitePoints.d65.xy },
    p3: { name: 'P3-D65', primaries: [[0.68, 0.32], [0.265, 0.69], [0.15, 0.06]], white: whitePoints.d65.xy },
    rec2020: { name: 'Rec.2020', primaries: [[0.708, 0.292], [0.17, 0.797], [0.131, 0.046]], white: whitePoints.d65.xy },
    adobe: { name: 'Adobe RGB', primaries: [[0.64, 0.33], [0.21, 0.71], [0.15, 0.06]], white: whitePoints.d65.xy }
  };
  const api = { gamuts, whitePoints };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CalmanPresets = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
