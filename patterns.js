(function (root) {
  'use strict';
  // Source: ColorCheckerSource.cs, ClassicCC_Source. Yn is relative to white.
  const classic = [
    ['dark-skin', 'Dark Skin', '深肤色', 0.405119, 0.36253, 0.096774],
    ['light-skin', 'Light Skin', '浅肤色', 0.379756, 0.357031, 0.353705],
    ['blue-sky', 'Blue Sky', '蓝天', 0.249396, 0.266854, 0.18913],
    ['foliage', 'Foliage', '叶绿', 0.338784, 0.433265, 0.132836],
    ['blue-flower', 'Blue Flower', '蓝花', 0.267688, 0.25314, 0.235775],
    ['bluish-green', 'Bluish Green', '蓝绿', 0.261653, 0.359045, 0.425252],
    ['orange', 'Orange', '橙色', 0.512087, 0.410373, 0.287229],
    ['purplish-blue', 'Purplish Blue', '紫蓝', 0.213095, 0.186377, 0.115692],
    ['moderate-red', 'Moderate Red', '中红', 0.461291, 0.312073, 0.187204],
    ['purple', 'Purple', '紫色', 0.288075, 0.217532, 0.064716],
    ['yellow-green', 'Yellow Green', '黄绿', 0.37852, 0.496473, 0.436288],
    ['orange-yellow', 'Orange Yellow', '橙黄', 0.473379, 0.443246, 0.433456],
    ['blue', 'Blue', '蓝色', 0.186955, 0.133934, 0.060722],
    ['green', 'Green', '绿色', 0.306493, 0.495107, 0.234403],
    ['red', 'Red', '红色', 0.547377, 0.317462, 0.114731],
    ['yellow', 'Yellow', '黄色', 0.44792, 0.475618, 0.597462],
    ['magenta', 'Magenta', '品红', 0.371346, 0.24177, 0.187509],
    ['cyan', 'Cyan', '青色', 0.19619, 0.266985, 0.193415]
  ].map(([id, name, label, x, y, Yn]) => ({ id: 'cc-' + id, name, label, type: 'xyYn', group: 'classic', x, y, Yn }));
  const patterns = [
    { id: 'white', name: 'White', label: '白场', type: 'rgb', group: 'signal', rgb: [1, 1, 1] },
    { id: 'black', name: 'Black', label: '黑场', type: 'rgb', group: 'signal', rgb: [0, 0, 0] },
    ...[10, 20, 30, 40, 50, 60, 70, 80, 90].map(n => ({ id: 'gray-' + n, name: n + '% Gray', label: n + '% 信号灰', type: 'rgb', group: 'signal', rgb: [n / 100, n / 100, n / 100] })),
    ...[
      ['red', 'Red', '红', [1, 0, 0]], ['green', 'Green', '绿', [0, 1, 0]], ['blue', 'Blue', '蓝', [0, 0, 1]],
      ['cyan', 'Cyan', '青', [0, 1, 1]], ['magenta', 'Magenta', '品红', [1, 0, 1]], ['yellow', 'Yellow', '黄', [1, 1, 0]]
    ].map(([id, name, label, rgb]) => ({ id: 'full-' + id, name: '100% ' + name, label: '100% ' + label, type: 'rgb', group: 'primary', rgb })),
    ...[35, 50, 65, 80].map(n => ({ id: 'cc-gray-' + n, name: 'Gray ' + n, label: n + '% 相对白亮度灰', type: 'relativeGray', group: 'classic', Yn: n / 100 })),
    ...classic
  ];
  if (typeof module === 'object' && module.exports) module.exports = patterns;
  else root.CalmanPatterns = patterns;
})(typeof globalThis !== 'undefined' ? globalThis : this);
