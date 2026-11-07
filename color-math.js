(function (root) {
  'use strict';
  const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
  const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
  const multiply = (m, v) => m.map(row => dot(row, v));
  function finite(value, label) {
    if (!Number.isFinite(value)) throw new Error(label + '必须是有限数字。');
    return value;
  }
  function validateXy(x, y) {
    finite(x, 'x'); finite(y, 'y');
    if (x < 0 || y <= 0 || x + y > 1 + 1e-12) throw new Error('色度要求 x ≥ 0、y > 0、x + y ≤ 1。');
  }
  function xyYToXYZ({ x, y, Y }) {
    validateXy(x, y); finite(Y, '亮度 Y');
    if (Y < 0) throw new Error('亮度不能为负数。');
    return [x * Y / y, Y, (1 - x - y) * Y / y];
  }
  function xyzToXyY(xyz, fallback = null) {
    const sum = xyz.reduce((a, b) => a + b, 0);
    return sum > 0 ? { x: xyz[0] / sum, y: xyz[1] / sum, Y: xyz[1] }
      : { x: fallback ? fallback[0] : null, y: fallback ? fallback[1] : null, Y: xyz[1] };
  }
  function inverse3(m) {
    const [[a, b, c], [d, e, f], [g, h, i]] = m;
    const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) throw new Error('色域矩阵不可逆，请检查原色与白点。');
    return [[e * i - f * h, c * h - b * i, b * f - c * e], [f * g - d * i, a * i - c * g, c * d - a * f], [d * h - e * g, b * g - a * h, a * e - b * d]].map(r => r.map(v => v / det));
  }
  function buildRgbXyzMatrix(gamut, trace = null) {
    if (!gamut || !Array.isArray(gamut.primaries) || gamut.primaries.length !== 3 || !Array.isArray(gamut.white)) throw new Error('缺少色域原色或白点。');
    const columns = gamut.primaries.map(([x, y]) => xyYToXYZ({ x, y, Y: 1 }));
    const raw = [0, 1, 2].map(i => columns.map(c => c[i]));
    const w = xyYToXYZ({ x: gamut.white[0], y: gamut.white[1], Y: 1 });
    const rawInverse = inverse3(raw), scale = multiply(rawInverse, w);
    if (scale.some(v => v <= 0)) throw new Error('白点需要位于所选色域三角形内部。');
    const matrix = raw.map(row => row.map((v, j) => v * scale[j]));
    if (trace) Object.assign(trace, { primaries: gamut.primaries, whiteXy: gamut.white, columns, raw, rawInverse, white: w, scale, matrix, inverse: inverse3(matrix) });
    return matrix;
  }
  function validateConfig(config) {
    const c = { gamma: 'power', exponent: 2.2, black: 0, white: 100, bitDepth: 8, range: 'full', roundPercent: true, quantize: true, ...config };
    finite(c.black, '黑场'); finite(c.white, '白场'); finite(c.exponent, 'Gamma');
    if (c.black < 0 || c.white <= c.black) throw new Error('亮度要求 0 ≤ 黑场 < 白场。');
    if (c.exponent <= 0 || c.exponent > 10) throw new Error('Gamma 指数要求大于 0 且不超过 10。');
    if (!['power', 'srgb', 'bt1886'].includes(c.gamma)) throw new Error('不支持的 Gamma 类型。');
    if (![8, 10].includes(c.bitDepth) || !['limited', 'full'].includes(c.range)) throw new Error('信号格式无效。');
    buildRgbXyzMatrix(c.gamut);
    return c;
  }
  // Relative linear light INCLUDING the black offset, as in IGammaFormula.EOTF.
  function eotf(signal, config, trace = null) {
    finite(signal, '信号');
    if (signal < 0 || signal > 1) throw new Error('信号必须在 0–1 之间。');
    const { gamma, exponent, black, white } = config;
    const k = black / white;
    if (gamma === 'bt1886') {
      const b = Math.pow(black, 1 / 2.4);
      const a = Math.pow(white, 1 / 2.4) - b;
      const rootLight = a * signal + b, absolute = Math.pow(rootLight, 2.4), result = absolute / white;
      if (trace) Object.assign(trace, { signal, gamma, exponent: 2.4, k, a, b, rootLight, absolute, result, branch: 'BT.1886' });
      return result;
    }
    const linear = gamma === 'srgb' ? (signal <= 0.04045 ? signal / 12.92 : Math.pow((signal + 0.055) / 1.055, 2.4)) : Math.pow(signal, exponent);
    const result = linear * (1 - k) + k;
    if (trace) Object.assign(trace, { signal, gamma, exponent, k, linear, result, branch: gamma === 'srgb' ? (signal <= 0.04045 ? 's / 12.92' : '((s + 0.055) / 1.055)^2.4') : 's^γ' });
    return result;
  }
  // .NET MidpointRounding.ToEven; offsets are added AFTER rounding.
  function roundEven(value) {
    const low = Math.floor(value), fraction = value - low;
    if (fraction === 0.5) return low % 2 === 0 ? low : low + 1;
    return Math.round(value);
  }
  function signalRange(config) {
    const ten = config.bitDepth === 10;
    const low = config.range === 'limited' ? (ten ? 64 : 16) : 0;
    const high = config.range === 'limited' ? (ten ? 940 : 235) : (ten ? 1023 : 255);
    return { low, high, span: high - low };
  }
  function quantizeRgb(rgb, config) {
    const { low, span } = signalRange(config);
    const rounded = rgb.map(v => config.roundPercent ? roundEven(clamp(v) * 100) / 100 : clamp(v));
    const codes = rounded.map(v => low + roundEven(v * span));
    const actual = codes.map(v => (v - low) / span);
    return { codes, rounded, actual, trace: { low, span, high: low + span, input: rgb, roundPercent: config.roundPercent, percentages: rgb.map(v => clamp(v) * 100), rounded, scaled: rounded.map(v => v * span), amplitudes: codes.map(v => v - low), codes, actual } };
  }
  function calculateTarget(rgb, config) {
    const c = validateConfig(config), matrixTrace = {}, matrix = buildRgbXyzMatrix(c.gamut, matrixTrace), k = c.black / c.white;
    // Colorspace.GetTargetXYZ_FromStimulus: remove channel offsets, keep xy,
    // then restore the luminance offset. This is not M * EOTF(rgb).
    const channels = rgb.map(v => { const channel = {}; eotf(v, c, channel); return channel; });
    const linear = channels.map(channel => (channel.result - k) / (1 - k));
    const unoffset = multiply(matrix, linear);
    const xy = xyzToXyY(unoffset, c.gamut.white);
    const rawYn = unoffset[1] * (1 - k) + k;
    const Yn = Math.max(rawYn, 1e-11); // Calman target floor (normalized Y).
    const normalized = xyYToXYZ({ x: xy.x, y: xy.y, Y: Yn });
    const xyz = normalized.map(v => v * c.white);
    const white = xyYToXYZ({ x: c.gamut.white[0], y: c.gamut.white[1], Y: c.white });
    const labTrace = {}, luvTrace = {}, lab = xyzToLab(xyz, white, labTrace), luv = xyzToLuv(xyz, white, luvTrace);
    const trace = { config: c, matrix: matrixTrace, signal: rgb, k, channels, linear, unoffset, sum: unoffset.reduce((sum, v) => sum + v, 0), xy, rawYn, Yn, floorApplied: rawYn < 1e-11, normalized, xyz, white, lab: labTrace, luv: luvTrace };
    return { xyz, normalized, xyY: { x: xy.x, y: xy.y, Y: xyz[1] }, lab, luv, linear, matrix, floorApplied: rawYn < 1e-11, trace };
  }
  function resolvePattern(pattern, config) {
    const c = validateConfig(config), warnings = [];
    let rgb, nominalXYZ = null;
    const definition = { type: pattern.type };
    if (pattern.type === 'rgb') {
      rgb = pattern.rgb.slice();
      if (rgb.length !== 3 || rgb.some(v => !Number.isFinite(v) || v < 0 || v > 1)) throw new Error('Pattern RGB 必须是三个 0–1 数字。');
      definition.rgb = rgb;
    } else if (['xyYn', 'relativeGray'].includes(pattern.type)) {
      const [x, y] = pattern.type === 'relativeGray' ? c.gamut.white : [pattern.x, pattern.y];
      finite(pattern.Yn, 'Pattern Yn');
      nominalXYZ = xyYToXYZ({ x, y, Y: pattern.Yn });
      const linear = multiply(inverse3(buildRgbXyzMatrix(c.gamut)), nominalXYZ);
      const max = Math.max(...linear);
      if (max > 1 || linear.some(v => v < 0)) warnings.push('原始定义超出当前色域：已按 Calman 的缩放、裁切方式生成信号。');
      // Built-in SDR path in ColorDefinition_XnYnZn.GetRGB_Vals: fixed 2.2,
      // independent of the currently selected target gamma and black level.
      const divisor = max > 1 ? max : 1, scaled = linear.map(v => v / divisor), clipped = scaled.map(v => clamp(v));
      rgb = clipped.map(v => Math.pow(v, 1 / 2.2));
      Object.assign(definition, { x, y, Yn: pattern.Yn, nominalXYZ, linear, max, divisor, scaled, clipped, encoded: rgb });
    } else throw new Error('未知的 Pattern 定义类型。');
    const quantized = quantizeRgb(rgb, c);
    const actual = c.quantize ? quantized.actual : rgb;
    const target = calculateTarget(actual, c);
    if (target.floorApplied) warnings.push('零亮度目标按源码使用 Yn = 10⁻¹¹ 数值下限；这里的黑场 xy 是参考白约定值。');
    return { pattern, rgb, ...quantized, actual, target, nominalXYZ, nominalXyY: nominalXYZ ? xyzToXyY(nominalXYZ) : null, warnings, trace: { definition, quantization: quantized.trace, quantize: c.quantize, signal: actual, target: target.trace } };
  }
  function xyzToLab(xyz, white, trace = null) {
    const epsilon = 216 / 24389, kappa = 24389 / 27;
    const ratios = xyz.map((v, i) => v / white[i]);
    const f = ratios.map(r => {
      return r > epsilon ? Math.cbrt(r) : (kappa * r + 16) / 116;
    });
    const result = [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])];
    if (trace) Object.assign(trace, { xyz, white, epsilon, kappa, ratios, branches: ratios.map(r => r > epsilon ? '∛t' : '(κt + 16) / 116'), f, result });
    return result;
  }
  function xyzToLuv(xyz, white, trace = null) {
    const uv = v => { const d = v[0] + 15 * v[1] + 3 * v[2]; return d === 0 ? [0, 0] : [4 * v[0] / d, 9 * v[1] / d]; };
    const L = xyzToLab(xyz, white)[0], p = uv(xyz), w = uv(white);
    const result = [L, 13 * L * (p[0] - w[0]), 13 * L * (p[1] - w[1])];
    if (trace) Object.assign(trace, { xyz, white, denominator: xyz[0] + 15 * xyz[1] + 3 * xyz[2], whiteDenominator: white[0] + 15 * white[1] + 3 * white[2], uv: p, whiteUv: w, L, result });
    return result;
  }
  function deltaE76(a, b, trace = null) {
    const differences = a.map((v, i) => v - b[i]), result = Math.hypot(...differences);
    if (trace) Object.assign(trace, { measured: a, target: b, differences, squares: differences.map(v => v * v), result });
    return result;
  }
  function deltaE94(measured, target, trace = null) {
    const dL = measured[0] - target[0], dA = measured[1] - target[1], dB = measured[2] - target[2];
    const C = Math.hypot(target[1], target[2]), dC = Math.hypot(measured[1], measured[2]) - C;
    const dH2 = Math.max(0, dA * dA + dB * dB - dC * dC);
    const SC = 1 + 0.045 * C, SH = 1 + 0.015 * C;
    const terms = [dL * dL, (dC / SC) ** 2, dH2 / SH ** 2], result = Math.sqrt(terms[0] + terms[1] + terms[2]);
    if (trace) Object.assign(trace, { measured, target, Ctarget: C, Cmeasured: Math.hypot(measured[1], measured[2]), dL, dA, dB, dC, dH2, SC, SH, terms, result });
    return result;
  }
  function deltaE2000(measured, target, trace = null) {
    const [L1, a1, b1] = target, [L2, a2, b2] = measured;
    const rad = x => x * Math.PI / 180, deg = x => x * 180 / Math.PI;
    const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cbar = (C1 + C2) / 2;
    const G = (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7))) / 2;
    const ap1 = a1 * (1 + G), ap2 = a2 * (1 + G), cp1 = Math.hypot(ap1, b1), cp2 = Math.hypot(ap2, b2);
    const hue = (b, a) => { const h = deg(Math.atan2(b, a)); return h < 0 ? h + 360 : h; };
    const hp1 = hue(b1, ap1), hp2 = hue(b2, ap2);
    let dh = hp2 - hp1;
    if (cp1 * cp2 === 0) dh = 0;
    else if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
    // Preserve Calman Formulas.DeltaE2000's mean-hue branch order.
    let hbar;
    if (Math.abs(hp1 - hp2) <= 180) hbar = (hp1 + hp2) / 2;
    else if (hp1 + hp2 < 360) hbar = (hp1 + hp2 + 360) / 2;
    else hbar = (hp1 + hp2 - 360) / 2;
    const dL = L2 - L1, dC = cp2 - cp1, dH = 2 * Math.sqrt(cp1 * cp2) * Math.sin(rad(dh / 2));
    const Lbar = (L1 + L2) / 2, cpbar = (cp1 + cp2) / 2;
    const T = 1 - 0.17 * Math.cos(rad(hbar - 30)) + 0.24 * Math.cos(rad(2 * hbar)) + 0.32 * Math.cos(rad(3 * hbar + 6)) - 0.2 * Math.cos(rad(4 * hbar - 63));
    const SL = 1 + 0.015 * (Lbar - 50) ** 2 / Math.sqrt(20 + (Lbar - 50) ** 2), SC = 1 + 0.045 * cpbar, SH = 1 + 0.015 * cpbar * T;
    const RT = -2 * Math.sqrt(cpbar ** 7 / (cpbar ** 7 + 25 ** 7)) * Math.sin(rad(60 * Math.exp(-(((hbar - 275) / 25) ** 2))));
    const terms = [(dL / SL) ** 2, (dC / SC) ** 2, (dH / SH) ** 2, RT * (dC / SC) * (dH / SH)];
    const result = Math.sqrt(Math.max(0, terms[0] + terms[1] + terms[2] + terms[3]));
    if (trace) Object.assign(trace, { target, measured, C1, C2, Cbar, G, ap1, ap2, cp1, cp2, hp1, hp2, dh, hbar, dL, dC, dH, Lbar, cpbar, T, SL, SC, SH, RT, theta: 30 * Math.exp(-(((hbar - 275) / 25) ** 2)), RC: 2 * Math.sqrt(cpbar ** 7 / (cpbar ** 7 + 25 ** 7)), zeroChroma: cp1 * cp2 === 0, terms, result });
    return result;
  }
  function calculateDeltaE(measured, target, options) {
    const { whiteXYZ, compensateLuminance = false } = options;
    let reference = target;
    if ([...measured, ...target, ...whiteXYZ].some(v => !Number.isFinite(v) || v < 0) || whiteXYZ.some(v => v <= 0)) throw new Error('XYZ 和参考白数值无效。');
    if (compensateLuminance) {
      if (measured[1] <= 0 || target[1] <= 0) throw new Error('零亮度无法进行亮度补偿，请关闭该选项。');
      reference = target.map(v => v * measured[1] / target[1]);
    }
    const trace = { measuredXYZ: measured, targetXYZ: target, whiteXYZ, compensateLuminance, factor: compensateLuminance ? measured[1] / target[1] : 1, comparisonXYZ: reference, measuredLab: {}, targetLab: {}, measuredLuv: {}, targetLuv: {}, de76: {}, de76luv: {}, de94: {}, de2000: {} };
    const measuredLab = xyzToLab(measured, whiteXYZ, trace.measuredLab), targetLab = xyzToLab(reference, whiteXYZ, trace.targetLab);
    const measuredLuv = xyzToLuv(measured, whiteXYZ, trace.measuredLuv), targetLuv = xyzToLuv(reference, whiteXYZ, trace.targetLuv);
    return { de76: deltaE76(measuredLab, targetLab, trace.de76), de76luv: deltaE76(measuredLuv, targetLuv, trace.de76luv), de94: deltaE94(measuredLab, targetLab, trace.de94), de2000: deltaE2000(measuredLab, targetLab, trace.de2000), measuredLab, targetLab, comparisonXYZ: reference, trace };
  }
  const api = { clamp, multiply, inverse3, buildRgbXyzMatrix, validateConfig, eotf, roundEven, signalRange, quantizeRgb, calculateTarget, resolvePattern, xyYToXYZ, xyzToXyY, xyzToLab, xyzToLuv, deltaE76, deltaE94, deltaE2000, calculateDeltaE };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CalmanMath = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
