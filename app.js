(function () {
  'use strict';
  const M = window.CalmanMath, P = window.CalmanPresets, patterns = window.CalmanPatterns;
  const $ = id => document.getElementById(id);
  const fmt = (v, digits = 6) => Number.isFinite(v) ? v.toFixed(digits) : '—';
  const groups = { signal: 'SIGNAL & GRAYSCALE', primary: 'RGB / CMY · FULL SATURATION', classic: 'CLASSIC COLORCHECKER' };
  let selectedId = 'cc-dark-skin', filter = 'all', current = null, config = null;
  let measurementRecord = { status: 'pending', message: '尚未输入实测 xyY。' };
  const measurements = new Map();
  const srgbInverse = M.inverse3(M.buildRgbXyzMatrix({ ...P.gamuts.rec709, white: [0.3127, 0.329] }));
  function previewColor(xyz) {
    const linear = M.multiply(srgbInverse, xyz);
    const encode = v => v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return 'rgb(' + linear.map(v => Math.round(255 * M.clamp(encode(M.clamp(v))))).join(',') + ')';
  }
  function numberInput(id) {
    const value = $(id).value.trim();
    return value === '' ? NaN : Number(value);
  }
  function readConfig() {
    const gamut = { ...P.gamuts[$('gamut').value], white: [numberInput('white-x'), numberInput('white-y')] };
    return M.validateConfig({ gamut, gamma: $('gamma').value, exponent: $('gamma').value === 'power' ? numberInput('exponent') : 2.4, black: numberInput('black'), white: numberInput('white'), bitDepth: Number($('depth').value), range: $('range').value, roundPercent: $('round-percent').checked, quantize: $('quantize').checked });
  }
  function updateWhitepoint() {
    const custom = $('whitepoint').value === 'custom';
    $('white-x').readOnly = !custom; $('white-y').readOnly = !custom;
    if (!custom) {
      const xy = P.whitePoints[$('whitepoint').value].xy;
      $('white-x').value = xy[0]; $('white-y').value = xy[1];
    }
  }
  function updateGamma() {
    const gamma = $('gamma').value;
    $('exponent').disabled = gamma !== 'power';
    $('gamma-hint').textContent = gamma === 'power' ? '可输入 2.2、2.4 或其他指数。' : gamma === 'srgb' ? '分段 sRGB EOTF；包含所设黑位偏移。' : '指数固定为 2.4，曲线由黑白场亮度共同确定。';
  }
  function clearDelta() {
    for (const id of ['de2000', 'de76', 'de94', 'de76luv']) $(id).textContent = '—';
    $('measure-lab').textContent = '';
  }
  function clearResults() {
    current = null;
    measurementRecord = { status: 'invalid', message: '目标条件无效，请修正后重新计算。' };
    for (const id of ['hero-x', 'hero-y', 'hero-Y', 'code-r', 'code-g', 'code-b']) $(id).textContent = '—';
    $('target-table-body').replaceChildren(); $('xy-chart').replaceChildren(); $('calculation-steps').replaceChildren();
    $('hero-swatch').style.background = '#1e2d44';
    $('copy-target').disabled = true; $('definition-note').textContent = '修正目标条件后继续计算。';
    $('export-csv').disabled = true;
    $('pattern-warnings').hidden = true; $('measurement-error').hidden = true; clearDelta();
    $('measure-status').textContent = '请先修正目标条件。';
    $('trace-summary').textContent = '目标条件无效，计算过程已清空。';
  }
  function renderTargetTable(ideal, quantized) {
    const nominalXYZ = current.nominalXYZ ? current.nominalXYZ.map(v => v * config.white) : null;
    const whiteXYZ = M.xyYToXYZ({ x: config.gamut.white[0], y: config.gamut.white[1], Y: config.white });
    const nominalLab = nominalXYZ ? M.xyzToLab(nominalXYZ, whiteXYZ) : [null, null, null];
    const nominal = current.nominalXyY;
    const rows = [
      ['x', nominal?.x, ideal.xyY.x, quantized.xyY.x, 6],
      ['y', nominal?.y, ideal.xyY.y, quantized.xyY.y, 6],
      ['Y · nit', nominal ? nominal.Y * config.white : null, ideal.xyY.Y, quantized.xyY.Y, 4],
      ['Yn · %', nominal ? nominal.Y * 100 : null, ideal.normalized[1] * 100, quantized.normalized[1] * 100, 4],
      ['X', nominalXYZ?.[0], ideal.xyz[0], quantized.xyz[0], 4],
      ['Z', nominalXYZ?.[2], ideal.xyz[2], quantized.xyz[2], 4],
      ['L*', nominalLab[0], ideal.lab[0], quantized.lab[0], 4],
      ['a*', nominalLab[1], ideal.lab[1], quantized.lab[1], 4],
      ['b*', nominalLab[2], ideal.lab[2], quantized.lab[2], 4]
    ];
    const body = $('target-table-body'); body.replaceChildren();
    for (const [name, ...values] of rows) {
      const digits = values.pop(), tr = document.createElement('tr'), label = document.createElement('td'); label.textContent = name; tr.append(label);
      values.forEach((v, i) => {
        const td = document.createElement('td'); td.textContent = fmt(v, digits);
        if (i === (config.quantize ? 2 : 1)) td.className = 'active-column';
        if (!Number.isFinite(v)) td.classList.add('muted-cell');
        tr.append(td);
      });
      body.append(tr);
    }
    const headers = document.querySelectorAll('.target-table thead th');
    headers.forEach((el, i) => el.classList.toggle('active-column', i === (config.quantize ? 3 : 2)));
    const typeNote = current.pattern.type === 'rgb' ? '此 Pattern 定义的是 RGB 信号；没有独立的原始 xyY。' : '原始定义的亮度按白场缩放；理想与量化列均由当前 Gamma 重新计算。';
    $('definition-note').textContent = typeNote + ' 当前实际信号：' + current.actual.map(v => fmt(v * 100, 3)).join(' / ') + '%。';
  }
  // Every numeric intermediate below comes from the same trace that produced
  // the visible result. Formatting is the only rounding done by this renderer.
  const traceNumber = value => Number.isFinite(value) ? String(Number(value.toPrecision(10))) : '—';
  const traceVector = values => '[' + values.map(traceNumber).join(', ') + ']';
  function traceText(parent, text, className = '') {
    const p = document.createElement('p'); p.textContent = text; p.className = className; parent.append(p); return p;
  }
  function traceStage(title) {
    const section = document.createElement('section'); section.className = 'trace-stage';
    const heading = document.createElement('h4'), number = document.createElement('span');
    number.className = 'trace-stage-number'; number.textContent = String($('calculation-steps').children.length + 1).padStart(2, '0');
    heading.append(number, document.createTextNode(title)); section.append(heading); $('calculation-steps').append(section); return section;
  }
  function traceEquation(parent, formula, substituted = '') {
    const pre = document.createElement('pre'); pre.className = 'trace-formula';
    pre.textContent = formula + (substituted ? '\n→ ' + substituted : ''); parent.append(pre);
  }
  function traceTable(parent, headers, rows) {
    const wrap = document.createElement('div'), table = document.createElement('table');
    wrap.className = 'trace-table-scroll'; table.className = 'trace-table';
    const head = document.createElement('thead'), headRow = document.createElement('tr');
    headers.forEach(text => { const th = document.createElement('th'); th.textContent = text; th.scope = 'col'; headRow.append(th); }); head.append(headRow);
    const body = document.createElement('tbody');
    rows.forEach(row => { const tr = document.createElement('tr'); row.forEach(value => { const td = document.createElement('td'); td.textContent = typeof value === 'number' ? traceNumber(value) : value; tr.append(td); }); body.append(tr); });
    table.append(head, body); wrap.append(table); parent.append(wrap);
  }
  function traceMatrix(parent, name, matrix) {
    const pre = document.createElement('pre'); pre.className = 'trace-formula trace-matrix';
    pre.textContent = name + ' =\n' + matrix.map(row => '[ ' + row.map(v => traceNumber(v).padStart(15)).join('  ') + ' ]').join('\n'); parent.append(pre);
  }
  function traceColorConversion(parent, label, lab, luv) {
    const heading = document.createElement('h5'); heading.textContent = label; parent.append(heading);
    traceEquation(parent, 'tX = X/Xw; tY = Y/Yw; tZ = Z/Zw\nε = 216/24389; κ = 24389/27\nf(t) = ∛t  (t > ε)，否则 f(t) = (κt + 16)/116', `ε = ${traceNumber(lab.epsilon)}; κ = ${traceNumber(lab.kappa)}`);
    traceTable(parent, ['分量', 'XYZ', '参考白 XYZ', '比值 t', '所用分支', 'f(t)'], ['X', 'Y', 'Z'].map((axis, i) => [axis, lab.xyz[i], lab.white[i], lab.ratios[i], lab.branches[i], lab.f[i]]));
    const [fx, fy, fz] = lab.f;
    traceEquation(parent, 'L* = 116f(tY) − 16; a* = 500(f(tX) − f(tY)); b* = 200(f(tY) − f(tZ))', `L* = 116 × ${traceNumber(fy)} − 16 = ${traceNumber(lab.result[0])}\na* = 500 × (${traceNumber(fx)} − ${traceNumber(fy)}) = ${traceNumber(lab.result[1])}\nb* = 200 × (${traceNumber(fy)} − ${traceNumber(fz)}) = ${traceNumber(lab.result[2])}`);
    traceEquation(parent, 'D = X + 15Y + 3Z; u′ = 4X/D; v′ = 9Y/D\nLuv 使用同一个 L*；u* = 13L*(u′ − u′w); v* = 13L*(v′ − v′w)', `D = ${traceNumber(luv.denominator)}; Dw = ${traceNumber(luv.whiteDenominator)}\n[u′, v′] = ${traceVector(luv.uv)}; [u′w, v′w] = ${traceVector(luv.whiteUv)}\nu* = 13 × ${traceNumber(luv.L)} × (${traceNumber(luv.uv[0])} − ${traceNumber(luv.whiteUv[0])}) = ${traceNumber(luv.result[1])}\nv* = 13 × ${traceNumber(luv.L)} × (${traceNumber(luv.uv[1])} − ${traceNumber(luv.whiteUv[1])}) = ${traceNumber(luv.result[2])}\nLab = ${traceVector(lab.result)}\nLuv = ${traceVector(luv.result)}`);
    if (luv.denominator === 0) traceText(parent, 'XYZ 全零时，代码令 u′=v′=0；由于 L*=0，最终 u*=v*=0。零亮度本身没有可测的色度。', 'trace-note');
  }
  function renderSteps(trace = current?.trace) {
    $('calculation-steps').replaceChildren();
    if (!current || !trace) { $('trace-summary').textContent = '目标条件无效，计算过程已清空。'; return; }
    const c = config, t = trace.target, matrix = t.matrix, q = trace.quantization, d = trace.definition;
    const gammaName = c.gamma === 'power' ? 'Power ' + traceNumber(c.exponent) : c.gamma === 'srgb' ? 'sRGB' : 'BT.1886';
    $('trace-summary').textContent = `${current.pattern.name} · ${c.gamut.name} · ${gammaName} · 黑/白 ${traceNumber(c.black)} / ${traceNumber(c.white)} nit · ${c.bitDepth} bit ${c.range.toUpperCase()} · ${c.quantize ? '量化信号目标' : '理想信号目标'} · ${$('compensate').checked ? '亮度补偿' : '包含亮度误差'}。数值显示约 10 位有效数字，计算保留双精度。`;
    if (!$('method').open) return;
    let stage = traceStage('当前输入与计算约定');
    traceTable(stage, ['项目', '当前值'], [
      ['Pattern', current.pattern.name + ' · ' + current.pattern.label], ['定义类型', d.type === 'rgb' ? 'RGB 信号' : d.type === 'relativeGray' ? '相对白亮度灰' : '固定 xyYn'],
      ['色域', c.gamut.name], ['R / G / B 原色 xy', c.gamut.primaries.map(traceVector).join(' / ')], ['参考白 xy', traceVector(c.gamut.white)],
      ['EOTF', gammaName], ['黑场 Lb / 白场 Lw（cd/m²）', traceVector([c.black, c.white])], ['k = Lb/Lw', t.k],
      ['信号码值 low / high / span', traceVector([q.low, q.high, q.span])], ['整数百分比舍入', c.roundPercent ? '开启：中点取偶' : '关闭'],
      ['实际参与计算的信号', c.quantize ? '码值反算的信号' : '未取整的理想信号'], ['亮度补偿', $('compensate').checked ? '开启' : '关闭']
    ]);
    traceText(stage, '以下 XYZ 标明“归一化”时以白场 Y=1 为基准；绝对 XYZ 和亮度 Y 使用 cd/m²。R/G/B 向量按此顺序排列。', 'trace-note');

    stage = traceStage('由原色和白点生成 RGB↔XYZ 矩阵');
    traceEquation(stage, '对各原色：(X, Y, Z) = (x/y, 1, (1−x−y)/y)\nA 的三列分别为 R、G、B 原色的 XYZ；W = (xw/yw, 1, (1−xw−yw)/yw)', '归一化白点 W = ' + traceVector(matrix.white));
    traceMatrix(stage, 'A', matrix.raw); traceMatrix(stage, 'A⁻¹', matrix.rawInverse);
    traceEquation(stage, 'S = A⁻¹ × W; M = A × diag(S)', 'S = ' + traceVector(matrix.scale));
    traceMatrix(stage, 'M（RGB → XYZ）', matrix.matrix); traceMatrix(stage, 'M⁻¹（XYZ → RGB）', matrix.inverse);

    stage = traceStage('读取 Pattern 并生成理想 RGB 信号');
    if (d.type === 'rgb') {
      traceEquation(stage, '直接读取 RGB 信号，不套用 ColorChecker 的固定 2.2 编码。', 's理想 = ' + traceVector(d.rgb));
    } else {
      traceEquation(stage, 'Xn = x × Yn/y; Zn = (1−x−y) × Yn/y', `x = ${traceNumber(d.x)}; y = ${traceNumber(d.y)}; Yn = ${traceNumber(d.Yn)}\n原始归一化 XYZ = ${traceVector(d.nominalXYZ)}`);
      traceEquation(stage, 'RGBlinear = M⁻¹ × XYZnominal\n缩放因子 D = max(1, max(RGBlinear)); RGBscaled = RGBlinear/D\nRGBclip = clamp(RGBscaled, 0, 1); s理想 = RGBclip^(1/2.2)', `D = ${traceNumber(d.divisor)}${d.divisor > 1 ? '（发生同比例缩放）' : '（未缩放）'}`);
      traceTable(stage, ['通道', '逆矩阵转换', '缩放后', '裁切后', '固定 2.2 编码后'], ['R', 'G', 'B'].map((ch, i) => [ch, d.linear[i], d.scaled[i], d.clipped[i], d.encoded[i]]));
      traceText(stage, '这是 Calman 内置 SDR ColorChecker 的生成路径。此处固定 2.2 编码，与当前用于目标计算的 ' + gammaName + ' 是两个不同步骤。', 'trace-note');
    }

    stage = traceStage('百分比舍入、码值量化与实际信号');
    traceEquation(stage, 'p = 100 × clamp(s理想, 0, 1)\np取整 = RoundToEven(p)（启用时）；u = p取整/100 × span\ncode = low + RoundToEven(u); s码值 = (code−low)/span', `low = ${q.low}; high = ${q.high}; span = ${q.span}`);
    traceTable(stage, ['通道', '原始 p (%)', '舍入后 p (%)', 'u（幅度码值）', '幅度取偶', 'code', 's码值', '实际使用 s'], ['R', 'G', 'B'].map((ch, i) => [ch, q.percentages[i], q.rounded[i] * 100, q.scaled[i], q.amplitudes[i], q.codes[i], q.actual[i], trace.signal[i]]));
    traceText(stage, c.quantize ? '当前使用码值反算信号。中点取偶的例子：109.5→110，110.5→110；黑码偏移在幅度舍入后相加。' : '当前关闭码值量化：上表码值仅作参考；下一步实际使用原始理想信号，百分比舍入也不参与目标计算。', 'trace-note');

    stage = traceStage('逐通道 EOTF 与黑位偏移');
    if (c.gamma === 'power') traceEquation(stage, 'F(s) = s^γ; EOTF(s) = (1−k)F(s) + k', `γ = ${traceNumber(c.exponent)}; k = ${traceNumber(t.k)}; 1−k = ${traceNumber(1 - t.k)}`);
    else if (c.gamma === 'srgb') traceEquation(stage, 'F(s) = s/12.92  (s ≤ 0.04045)\nF(s) = ((s+0.055)/1.055)^2.4  (s > 0.04045)\nEOTF(s) = (1−k)F(s) + k', `k = ${traceNumber(t.k)}; 1−k = ${traceNumber(1 - t.k)}`);
    else traceEquation(stage, 'α = Lw^(1/2.4) − Lb^(1/2.4); β = Lb^(1/2.4)\nroot = αs + β; EOTF(s) = root^2.4/Lw', `α = ${traceNumber(t.channels[0].a)}; β = ${traceNumber(t.channels[0].b)}; Lw = ${traceNumber(c.white)}`);
    traceEquation(stage, 'linear = (EOTF(s) − k)/(1−k)', `k = ${traceNumber(t.k)}; 1−k = ${traceNumber(1 - t.k)}`);
    traceTable(stage, ['通道', '实际 s', 'EOTF 分支', c.gamma === 'bt1886' ? 'root = αs+β' : 'F(s)', 'EOTF（含黑位）', '移除黑位后 linear'], t.channels.map((channel, i) => [['R', 'G', 'B'][i], channel.signal, channel.branch, c.gamma === 'bt1886' ? channel.rootLight : channel.linear, channel.result, t.linear[i]]));

    stage = traceStage('矩阵转换、色度与目标亮度');
    ['X', 'Y', 'Z'].forEach((axis, i) => traceEquation(stage, `${axis}linear = M[${i + 1},:] · [Rlinear, Glinear, Blinear]`, matrix.matrix[i].map((v, j) => `${traceNumber(v)} × ${traceNumber(t.linear[j])}`).join(' + ') + ' = ' + traceNumber(t.unoffset[i])));
    traceEquation(stage, 'Σ = Xlinear + Ylinear + Zlinear; x = Xlinear/Σ; y = Ylinear/Σ', `Σ = ${traceNumber(t.sum)}; x = ${traceNumber(t.xy.x)}; y = ${traceNumber(t.xy.y)}`);
    if (t.linear.every(v => v <= 0)) traceText(stage, '全零信号使用参考白 xy 作为约定值；这不代表黑场具有可测色度。', 'trace-note');
    traceEquation(stage, 'Yn原始 = Ylinear × (1−k) + k; Yn = max(Yn原始, 10⁻¹¹)', `${traceNumber(t.unoffset[1])} × ${traceNumber(1 - t.k)} + ${traceNumber(t.k)} = ${traceNumber(t.rawYn)}\nYn = ${traceNumber(t.Yn)}${t.floorApplied ? '（已使用数值下限）' : '（未触发数值下限）'}`);
    traceEquation(stage, 'Xn = x × Yn/y; Zn = (1−x−y) × Yn/y\n[X, Y, Z]绝对 = [Xn, Yn, Zn] × Lw', `归一化 XYZ = ${traceVector(t.normalized)}\n绝对 XYZ = ${traceVector(t.normalized)} × ${traceNumber(c.white)} = ${traceVector(t.xyz)}\n目标 xyY = ${traceVector([t.xy.x, t.xy.y, t.xyz[1]])}`);

    stage = traceStage('参考白与目标 Lab / Luv');
    traceEquation(stage, '白场参考 XYZ = (xw × Lw/yw, Lw, (1−xw−yw) × Lw/yw)', `白点 xy = ${traceVector(c.gamut.white)}; Lw = ${traceNumber(c.white)}\n参考白 XYZ = ${traceVector(t.white)}`);
    traceColorConversion(stage, '原始目标（尚未执行可选亮度补偿）', t.lab, t.luv);

    stage = traceStage('实测输入与亮度补偿');
    if (measurementRecord.status !== 'valid') {
      traceText(stage, measurementRecord.message + ' 上方目标计算已完整展示；实测 XYZ、Lab/Luv 和 DeltaE 在获得有效实测输入后继续。', 'trace-pending');
      return;
    }
    const measured = measurementRecord.input, delta = measurementRecord.delta, dt = delta.trace;
    traceEquation(stage, 'Xm = xm × Ym/ym; Zm = (1−xm−ym) × Ym/ym', `实测 xyY = ${traceVector([measured.x, measured.y, measured.Y])}\nXm = ${traceNumber(measured.x)} × ${traceNumber(measured.Y)} / ${traceNumber(measured.y)} = ${traceNumber(dt.measuredXYZ[0])}\nZm = (1−${traceNumber(measured.x)}−${traceNumber(measured.y)}) × ${traceNumber(measured.Y)} / ${traceNumber(measured.y)} = ${traceNumber(dt.measuredXYZ[2])}\n实测绝对 XYZ = ${traceVector(dt.measuredXYZ)}`);
    if (dt.compensateLuminance) traceEquation(stage, 'f补偿 = Ym/Ytarget; XYZcomparison = XYZtarget × f补偿', `f补偿 = ${traceNumber(dt.measuredXYZ[1])} / ${traceNumber(dt.targetXYZ[1])} = ${traceNumber(dt.factor)}\n比较目标 XYZ = ${traceVector(dt.targetXYZ)} × ${traceNumber(dt.factor)} = ${traceVector(dt.comparisonXYZ)}`);
    else traceEquation(stage, '亮度补偿关闭：f补偿 = 1; XYZcomparison = XYZtarget', '比较目标 XYZ = ' + traceVector(dt.comparisonXYZ));
    traceColorConversion(stage, '实测 Lab / Luv（与目标共用参考白）', dt.measuredLab, dt.measuredLuv);
    if (dt.compensateLuminance) traceColorConversion(stage, '亮度补偿后的比较目标 Lab / Luv', dt.targetLab, dt.targetLuv);
    else traceText(stage, '比较目标的 Lab/Luv 与上一阶段原始目标相同，无需重复转换。', 'trace-note');

    stage = traceStage('ΔE76 · CIELAB / CIELUV');
    for (const [label, value, coords] of [['CIELAB', dt.de76, ['L*', 'a*', 'b*']], ['CIELUV', dt.de76luv, ['L*', 'u*', 'v*']]]) {
      traceTable(stage, [label + ' 分量', '实测', '比较目标', '差值', '差值平方'], coords.map((name, i) => [name, value.measured[i], value.target[i], value.differences[i], value.squares[i]]));
      traceEquation(stage, `ΔE76 (${label}) = √Σ(实测分量−目标分量)²`, `√(${value.squares.map(traceNumber).join(' + ')}) = ${traceNumber(value.result)}`);
    }

    stage = traceStage('ΔE94 · Graphic Arts');
    const d94 = dt.de94;
    traceEquation(stage, 'Ct = √(at²+bt²); Cm = √(am²+bm²)\nΔL = Lm−Lt; Δa = am−at; Δb = bm−bt; ΔC = Cm−Ct\nΔH² = max(0, Δa²+Δb²−ΔC²)\nSL = 1; SC = 1+0.045Ct; SH = 1+0.015Ct; kL=kC=kH=1');
    traceTable(stage, ['Ct', 'Cm', 'ΔL', 'Δa', 'Δb', 'ΔC', 'ΔH²', 'SC', 'SH'], [[d94.Ctarget, d94.Cmeasured, d94.dL, d94.dA, d94.dB, d94.dC, d94.dH2, d94.SC, d94.SH]]);
    traceEquation(stage, 'ΔE94 = √[(ΔL/SL)² + (ΔC/SC)² + ΔH²/SH²]', `√(${d94.terms.map(traceNumber).join(' + ')}) = ${traceNumber(d94.result)}`);

    stage = traceStage('ΔE2000 · CIEDE2000 完整计算');
    const de = dt.de2000;
    traceText(stage, '下标 1=比较目标，2=实测。角度均以度表示，三角函数计算时转为弧度；kL=kC=kH=1。', 'trace-note');
    traceEquation(stage, 'C1 = √(a1²+b1²); C2 = √(a2²+b2²); C̄ = (C1+C2)/2\nG = (1−√(C̄⁷/(C̄⁷+25⁷)))/2', `C1 = ${traceNumber(de.C1)}; C2 = ${traceNumber(de.C2)}; C̄ = ${traceNumber(de.Cbar)}; G = ${traceNumber(de.G)}`);
    traceEquation(stage, 'a′i = (1+G)ai; C′i = √(a′i²+bi²)\nh′i = atan2(bi, a′i)，若为负则加 360°');
    traceTable(stage, ['颜色', 'L*', 'a*', 'b*', 'a′', 'C′', 'h′ (°)'], [['目标 1', ...de.target, de.ap1, de.cp1, de.hp1], ['实测 2', ...de.measured, de.ap2, de.cp2, de.hp2]]);
    traceEquation(stage, 'Δh′ = h′2−h′1：C′1C′2=0 时取 0；大于 180° 则减 360°，小于 −180° 则加 360°\nΔL′ = L2−L1; ΔC′ = C′2−C′1; ΔH′ = 2√(C′1C′2)sin(Δh′/2)', `Δh′ = ${traceNumber(de.dh)}°${de.zeroChroma ? '（零色度分支）' : ''}; ΔL′ = ${traceNumber(de.dL)}; ΔC′ = ${traceNumber(de.dC)}; ΔH′ = ${traceNumber(de.dH)}`);
    traceEquation(stage, 'L̄′ = (L1+L2)/2; C̄′ = (C′1+C′2)/2\nh̄′：|h′1−h′2|≤180° 时取平均；否则角度和<360° 时先加360°，否则先减360°，再除以2', `L̄′ = ${traceNumber(de.Lbar)}; C̄′ = ${traceNumber(de.cpbar)}; h̄′ = ${traceNumber(de.hbar)}°`);
    traceEquation(stage, 'T = 1 − 0.17cos(h̄′−30°) + 0.24cos(2h̄′) + 0.32cos(3h̄′+6°) − 0.20cos(4h̄′−63°)\nSL = 1 + 0.015(L̄′−50)²/√(20+(L̄′−50)²)\nSC = 1 + 0.045C̄′; SH = 1 + 0.015C̄′T', `T = ${traceNumber(de.T)}; SL = ${traceNumber(de.SL)}; SC = ${traceNumber(de.SC)}; SH = ${traceNumber(de.SH)}`);
    traceEquation(stage, 'Δθ = 30°exp(−((h̄′−275°)/25°)²)\nRC = 2√(C̄′⁷/(C̄′⁷+25⁷)); RT = −RC sin(2Δθ)', `Δθ = ${traceNumber(de.theta)}°; RC = ${traceNumber(de.RC)}; RT = ${traceNumber(de.RT)}`);
    traceTable(stage, ['项', '代入数值', '该项结果'], [
      ['亮度项 (ΔL′/SL)²', `(${traceNumber(de.dL)} / ${traceNumber(de.SL)})²`, de.terms[0]],
      ['色度项 (ΔC′/SC)²', `(${traceNumber(de.dC)} / ${traceNumber(de.SC)})²`, de.terms[1]],
      ['色相项 (ΔH′/SH)²', `(${traceNumber(de.dH)} / ${traceNumber(de.SH)})²`, de.terms[2]],
      ['交叉项 RT(ΔC′/SC)(ΔH′/SH)', `${traceNumber(de.RT)} × (${traceNumber(de.dC)} / ${traceNumber(de.SC)}) × (${traceNumber(de.dH)} / ${traceNumber(de.SH)})`, de.terms[3]]
    ]);
    traceEquation(stage, 'ΔE2000 = √max(0, 亮度项 + 色度项 + 色相项 + 交叉项)', `√max(0, ${de.terms.map(traceNumber).join(' + ')}) = ${traceNumber(de.result)}`);

    stage = traceStage('与页面色差结果核对');
    traceTable(stage, ['算法', '计算结果（约 10 位有效数字）', '页面显示（3 位小数）'], [['ΔE76 Lab', delta.de76, fmt(delta.de76, 3)], ['ΔE76 Luv', delta.de76luv, fmt(delta.de76luv, 3)], ['ΔE94', delta.de94, fmt(delta.de94, 3)], ['ΔE2000', delta.de2000, fmt(delta.de2000, 3)]]);
  }
  function renderChart(measured = null) {
    const svg = $('xy-chart'); svg.replaceChildren();
    if (!current) return;
    const all = [...config.gamut.primaries, config.gamut.white, [current.target.xyY.x, current.target.xyY.y]];
    if (measured) all.push([measured.x, measured.y]);
    const maxX = Math.min(1, Math.max(0.8, ...all.map(p => p[0] + 0.04))), maxY = Math.min(1, Math.max(0.9, ...all.map(p => p[1] + 0.04)));
    const x = v => 32 + v / maxX * 266, y = v => 243 - v / maxY * 220;
    function node(tag, attrs, text) {
      const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      if (text !== undefined) el.textContent = text;
      svg.append(el); return el;
    }
    node('title', {}, 'xy 色度图：冰蓝圆点为目标，橙色十字为实测，空心圆为参考白。');
    for (let value = 0; value <= 1.001; value += 0.2) {
      if (value <= maxX) {
        node('line', { x1: x(value), y1: 23, x2: x(value), y2: 243, stroke: 'var(--chart-grid)', 'stroke-width': 1 });
        node('text', { x: x(value), y: 260, fill: 'var(--muted)', 'font-size': 8, 'font-family': 'Consolas,monospace', 'text-anchor': 'middle' }, value.toFixed(1));
      }
      if (value <= maxY) {
        node('line', { x1: 32, y1: y(value), x2: 298, y2: y(value), stroke: 'var(--chart-grid)', 'stroke-width': 1 });
        node('text', { x: 22, y: y(value) + 3, fill: 'var(--muted)', 'font-size': 8, 'font-family': 'Consolas,monospace', 'text-anchor': 'end' }, value.toFixed(1));
      }
    }
    node('line', { x1: 32, y1: 23, x2: 32, y2: 243, stroke: 'var(--chart-axis)' });
    node('line', { x1: 32, y1: 243, x2: 298, y2: 243, stroke: 'var(--chart-axis)' });
    node('text', { x: 309, y: 247, fill: 'var(--muted)', 'font-size': 9 }, 'x');
    node('text', { x: 29, y: 13, fill: 'var(--muted)', 'font-size': 9 }, 'y');
    node('polygon', { points: config.gamut.primaries.map(p => `${x(p[0])},${y(p[1])}`).join(' '), fill: 'var(--chart-fill)', stroke: 'var(--chart-edge)', 'stroke-width': 1.2 });
    config.gamut.primaries.forEach((p, i) => {
      node('circle', { cx: x(p[0]), cy: y(p[1]), r: 2.5, fill: ['#ff9ca5', '#72dfbf', '#a6adff'][i] });
      node('text', { x: x(p[0]) + 7, y: y(p[1]) - 5, fill: 'var(--muted)', 'font-size': 9, 'font-family': 'Consolas,monospace' }, ['R', 'G', 'B'][i]);
    });
    const t = current.target.xyY, w = config.gamut.white;
    node('line', { x1: x(w[0]), y1: y(w[1]), x2: x(t.x), y2: y(t.y), stroke: 'var(--chart-axis)', 'stroke-dasharray': '3 3' });
    node('circle', { cx: x(w[0]), cy: y(w[1]), r: 3.8, fill: 'var(--panel)', stroke: 'var(--chart-white)', 'stroke-width': 1.2 });
    node('circle', { cx: x(t.x), cy: y(t.y), r: 8, fill: '#36d8f426' });
    node('circle', { cx: x(t.x), cy: y(t.y), r: 3.5, fill: 'var(--accent)', stroke: 'var(--panel)', 'stroke-width': 1 });
    if (measured) {
      node('line', { x1: x(t.x), y1: y(t.y), x2: x(measured.x), y2: y(measured.y), stroke: 'var(--chart-measured)', 'stroke-dasharray': '2 2' });
      const mx = x(measured.x), my = y(measured.y);
      node('path', { d: `M${mx - 4},${my}h8M${mx},${my - 4}v8`, stroke: 'var(--chart-measured)', 'stroke-width': 1.7, fill: 'none' });
    }
  }
  function saveMeasurement() {
    measurements.set(selectedId, ['measure-x', 'measure-y', 'measure-Y'].map(id => $(id).value));
  }
  function restoreMeasurement() {
    const values = measurements.get(selectedId) || ['', '', ''];
    ['measure-x', 'measure-y', 'measure-Y'].forEach((id, i) => { $(id).value = values[i]; });
  }
  function renderMeasurement() {
    clearDelta(); $('measurement-error').hidden = true;
    measurementRecord = { status: 'pending', message: '请完整填写实测 x、y 和 Y。' };
    $('delta-mode').textContent = $('compensate').checked ? '已启用亮度补偿' : '包含亮度误差';
    if (!current) return;
    const fields = ['measure-x', 'measure-y', 'measure-Y'].map(id => $(id).value.trim());
    if (fields.some(v => v === '')) {
      measurementRecord.message = fields.every(v => v === '') ? '尚未输入实测 xyY。' : '实测输入尚不完整。';
      $('measure-status').textContent = fields.every(v => v === '') ? '填入实测值后计算；不会自动生成测量数据。' : '请完整填写实测 x、y 和 Y。';
      renderChart(); return;
    }
    try {
      const measured = { x: numberInput('measure-x'), y: numberInput('measure-y'), Y: numberInput('measure-Y') };
      const measuredXYZ = M.xyYToXYZ(measured), whiteXYZ = M.xyYToXYZ({ x: config.gamut.white[0], y: config.gamut.white[1], Y: config.white });
      const delta = M.calculateDeltaE(measuredXYZ, current.target.xyz, { whiteXYZ, compensateLuminance: $('compensate').checked });
      measurementRecord = { status: 'valid', input: measured, delta };
      for (const id of ['de2000', 'de76', 'de94', 'de76luv']) $(id).textContent = fmt(delta[id], 3);
      $('measure-status').textContent = '与当前所选目标比较 · 实测值按 Pattern 分别保留在本次页面会话中。';
      $('measure-lab').textContent = '实测 Lab  ' + delta.measuredLab.map(v => fmt(v, 3)).join(' / ');
      if (measured.Y === 0) {
        $('measure-status').textContent = '实测亮度为 0：色度没有物理意义；色差按 XYZ = 0 计算。'; renderChart();
      } else renderChart(measured);
    } catch (error) {
      measurementRecord = { status: 'invalid', message: '实测数据无效：' + error.message };
      $('measurement-error').textContent = error.message; $('measurement-error').hidden = false;
      $('measure-status').textContent = '实测输入无效，色差结果已清空。'; renderChart();
    }
  }
  function selectPattern(id) {
    saveMeasurement(); selectedId = id; restoreMeasurement(); render();
    $('selected-name').focus({ preventScroll: true });
    document.querySelector('.target-card').scrollIntoView({ block: 'start', behavior: 'instant' });
  }
  function renderLibrary() {
    const term = $('pattern-search').value.trim().toLowerCase(), grid = $('pattern-grid'); grid.replaceChildren();
    const visible = patterns.filter(p => (filter === 'all' || p.group === filter) && `${p.name} ${p.label} ${p.id} ${p.group}`.toLowerCase().includes(term));
    $('pattern-count').textContent = visible.length;
    $('empty-library').hidden = visible.length > 0;
    for (const p of visible) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'pattern-button' + (p.id === selectedId ? ' selected' : '');
      button.dataset.patternId = p.id; button.setAttribute('aria-pressed', String(p.id === selectedId)); button.title = p.name + ' · ' + p.label; button.setAttribute('aria-label', button.title);
      const swatch = document.createElement('span'); swatch.className = 'pattern-swatch'; swatch.setAttribute('aria-hidden', 'true');
      if (config && !document.body.classList.contains('invalid-config')) swatch.style.background = previewColor(M.resolvePattern(p, config).target.normalized);
      else swatch.style.background = '#223149';
      const text = document.createElement('span'); text.className = 'pattern-text';
      const name = document.createElement('strong'); name.textContent = p.name;
      const label = document.createElement('small'); label.textContent = p.label;
      text.append(name, label); button.append(swatch, text); button.addEventListener('click', () => selectPattern(p.id)); grid.append(button);
    }
  }
  function render() {
    $('export-status').hidden = true;
    const pattern = patterns.find(p => p.id === selectedId);
    $('selected-name').textContent = pattern.name; $('selected-label').textContent = pattern.label; $('selected-family').textContent = groups[pattern.group];
    try {
      config = readConfig(); document.body.classList.remove('invalid-config'); $('config-error').hidden = true; $('copy-target').disabled = false;
      current = M.resolvePattern(pattern, config);
      $('export-csv').disabled = false;
      const ideal = M.calculateTarget(current.rgb, config), quantized = M.calculateTarget(current.codes.map(v => (v - M.signalRange(config).low) / M.signalRange(config).span), config);
      $('hero-x').textContent = fmt(current.target.xyY.x); $('hero-y').textContent = fmt(current.target.xyY.y); $('hero-Y').textContent = fmt(current.target.xyY.Y, 4);
      $('target-mode').textContent = config.quantize ? '量化信号目标' : '理想信号目标';
      $('hero-swatch').style.background = previewColor(current.target.normalized);
      const r = M.signalRange(config); $('range-hint').textContent = `${config.range === 'limited' ? '视频' : '全'}范围 ${r.low}–${r.high}`;
      $('signal-format').textContent = `${config.bitDepth} BIT · ${config.range.toUpperCase()}`;
      document.querySelector('.signal-strip>span').textContent = config.quantize ? 'RGB 码值' : '参考 RGB 码值';
      ['code-r', 'code-g', 'code-b'].forEach((id, i) => { $(id).textContent = current.codes[i]; });
      $('pattern-warnings').textContent = current.warnings.join(' '); $('pattern-warnings').hidden = current.warnings.length === 0;
      renderTargetTable(ideal, quantized); renderMeasurement(); renderSteps(); renderLibrary();
    } catch (error) {
      document.body.classList.add('invalid-config'); $('config-error').textContent = error.message; $('config-error').hidden = false;
      clearResults(); renderLibrary();
    }
  }
  function exportPatternsCsv() {
    let link = null, objectUrl = null;
    const status = $('export-status'); status.classList.remove('is-error');
    try {
      const result = window.CalmanCsv.buildPatternCsv(patterns, readConfig());
      objectUrl = URL.createObjectURL(new Blob([result.csv], { type: 'text/csv;charset=utf-8' }));
      link = document.createElement('a'); link.href = objectUrl; link.download = result.filename; link.hidden = true;
      document.body.append(link); link.click();
      status.textContent = `已生成全部 ${result.count} 个 Pattern 的 CSV，请查看浏览器下载。`;
    } catch (error) {
      status.classList.add('is-error'); status.textContent = '导出失败：' + error.message;
    } finally {
      if (link) link.remove();
      // Let the browser finish consuming the URL before releasing it.
      if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
      status.hidden = false;
    }
  }
  $('export-csv').addEventListener('click', exportPatternsCsv);
  $('config-form').addEventListener('submit', event => event.preventDefault());
  $('config-form').addEventListener('input', event => {
    if (event.target.id === 'whitepoint') updateWhitepoint();
    if (event.target.id === 'gamma') updateGamma();
    render();
  });
  for (const id of ['measure-x', 'measure-y', 'measure-Y']) $(id).addEventListener('input', () => { saveMeasurement(); renderMeasurement(); renderSteps(); });
  $('compensate').addEventListener('change', () => { renderMeasurement(); if (current) renderSteps(); });
  $('copy-target').addEventListener('click', () => {
    if (!current) return;
    // Number inputs retain round-trippable precision rather than displayed rounding.
    $('measure-x').value = String(current.target.xyY.x); $('measure-y').value = String(current.target.xyY.y); $('measure-Y').value = String(current.target.xyY.Y);
    saveMeasurement(); renderMeasurement(); renderSteps();
  });
  $('reset').addEventListener('click', () => { $('config-form').reset(); updateWhitepoint(); updateGamma(); render(); });
  $('pattern-search').addEventListener('input', renderLibrary);
  for (const button of document.querySelectorAll('[data-filter]')) button.addEventListener('click', () => {
    filter = button.dataset.filter;
    for (const item of document.querySelectorAll('[data-filter]')) { const active = item === button; item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active)); }
    renderLibrary();
  });
  $('method').open = false;
  $('method').addEventListener('toggle', () => { if ($('method').open) renderSteps(); });
  updateWhitepoint(); updateGamma(); render();
})();
