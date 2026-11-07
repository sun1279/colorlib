# ColorLib · SDR 色彩计算工作台

一个可离线使用的 HTML / JavaScript 色彩计算器。选择色域、Gamma、Pattern 和黑白场亮度，计算理论 **xyY、XYZ、Lab / Luv**；输入实测 xyY 后，可比较 **ΔE76、ΔE94 和 ΔE2000**，也可批量导出所有 Pattern 的理论值。

页面采用深色主题，无运行时依赖、无后端、无 CDN。计算在浏览器本地完成。

## 快速开始

```sh
git clone https://github.com/sun1279/colorlib.git
cd colorlib
```

直接用现代浏览器打开 `index.html` 即可使用。也可以通过 Python 启动本机静态服务：

```sh
python -m http.server 8000 --bind 127.0.0.1
```

然后访问 <http://127.0.0.1:8000/>。如果端口被占用，可更换端口号。打开页面不需要安装 Node.js、npm 包或 Calman。

## 支持内容

| 项目 | 支持范围 |
| --- | --- |
| 色域 | Rec.709 / sRGB、P3-D65、Rec.2020、Adobe RGB |
| 白点 | D65、D50、DCI 白点、自定义 xy |
| Gamma / EOTF | Power Gamma（自定义指数）、分段 sRGB、BT.1886 |
| Pattern | 白场、黑场、9 个信号灰阶、6 个 100% RGB/CMY、22 个 Classic ColorChecker 色块，共 39 个 |
| 信号 | 8 / 10 bit，Full / Limited，可选百分比取整和码值量化 |
| 理论结果 | 目标 xyY、绝对 XYZ、相对白亮度 Yn、Lab / Luv、RGB 码值 |
| 色差 | ΔE76 CIELAB、ΔE76 CIELUV、ΔE94 Graphic Arts、CIEDE2000，可选亮度补偿 |
| 计算过程 | 展开查看矩阵生成、编码、舍入、EOTF、黑位、颜色转换和色差中间项 |
| 导出 | 全部 Pattern 的 7 列 CSV，UTF-8 BOM，保留计算精度 |

默认设置为 Rec.709 / sRGB、D65、Power Gamma 2.2、黑场 0 nit、白场 100 nit、8 bit **Full**；百分比取整和按实际码值计算目标均开启。

## 使用方法

1. 设置色域、参考白点、Gamma、黑白场亮度和信号格式。亮度单位为 **cd/m²（nit）**。
2. 在顶部 Pattern Library 点击色块。悬停可查看名称，也可以搜索或按类别筛选。
3. 查看目标 xyY、RGB 码值，以及“原始定义 / 理想信号 / 量化信号”的结果对照。
4. 输入实测 x、y、Y，查看四种色差。“填入当前目标”用于检查相同输入的色差接近零，不代表真实测量。
5. 根据需要启用亮度补偿：将比较目标的 XYZ 等比例缩放到实测亮度，再计算色差。
6. 展开底部“计算过程与适用范围”，查看当前设置下的公式、代入数值和中间结果。没有实测值时展示完整目标计算；有效实测输入后继续展示色差过程。

参数和实测输入改变时，结果与展开的过程会同步更新。计算过程默认折叠；输入数据只保留在当前页面内存中，刷新或关闭页面后清空。

## CSV 导出

点击 Pattern Library 右侧的 **“导出 CSV”**。无论当前搜索或筛选显示多少色块，都会导出全部 **39 个 Pattern**，每个 Pattern 一行，列顺序固定如下：

| Pattern | x | y | Y_nit | R_code | G_code | B_code |
| --- | --- | --- | --- | --- | --- | --- |
| Pattern 名称 | 色度 x | 色度 y | 理论亮度（nit） | 红通道码值 | 绿通道码值 | 蓝通道码值 |

- 理论 xyY 使用点击导出时的当前设置，数值不按页面显示的小数位数截断。
- 开启“按实际码值计算目标”时，导出量化信号的理论值；关闭时导出理想信号理论值，此时 RGB 码值仅供参考。
- 色域、Gamma、位深、信号范围及理想 / 量化模式体现在文件名中；CSV 不额外添加参数、实测值或 DeltaE 列。
- 文件使用 UTF-8 BOM 和 CRLF 换行，支持中文及标准 CSV 引号转义，可使用 Excel 或 CSV 工具读取。
- 设置无效时禁用导出；全部计算成功后才生成文件。保存位置及重名处理由浏览器决定。

## 计算口径

本项目参考 CalIO 中的 SDR 目标计算路径整理实现，几个容易混淆的地方是：

- **信号灰阶与相对白亮度灰不同。** `50% Gray` 指 50% RGB 信号；Classic 的 `Gray 50` 原始定义是 50% 相对白亮度。黑场 0、白场 100 nit、Gamma 2.2 下，前者的未量化理论亮度约为 21.76 nit。
- **ColorChecker 定义与最终目标不同。** 内置 ColorChecker 先从 xyYn 转成线性 RGB，再经固定 2.2 编码及可选取整；最终目标由当前选定的 EOTF 和实际信号重新计算。
- **黑位按目标路径处理。** 先移除逐通道 EOTF 中的黑位偏移，矩阵转换得到色度，再恢复亮度偏移。
- **参考白一致。** 目标与实测共用选定白点及白场亮度计算 Lab / Luv，不对每个色块单独归一化。
- **数值约定保留。** 默认 D65 使用 xy = 0.312713 / 0.329016；舍入采用中点取偶；零亮度目标保留归一化 Yn = 10⁻¹¹ 的数值下限。黑场 xy 是参考白约定值，不代表零亮度具有可测色度。

详细计算说明与参考文件映射见 [analysis.md](analysis.md)。

## 文件结构

```text
colorlib/
├── index.html                    # 页面入口
├── styles.css                    # 深色主题与响应式布局
├── app.js                        # 交互、图表和计算过程展示
├── color-math.js                 # 矩阵、EOTF、颜色转换与色差算法
├── presets.js                    # 色域与白点
├── patterns.js                   # 39 个内置 Pattern
├── export-csv.js                 # CSV 生成
├── analysis.md                   # 计算口径、源码映射与验证记录
└── tests/
    ├── color-math.test.cjs        # 计算内核与中间记录测试
    ├── export-csv.test.cjs        # CSV 格式与数据一致性测试
    └── ciede2000-reference.txt    # CIEDE2000 参考数据
```

仓库不包含原始 Calman C# 工程、DLL、dnSpy 或其他分析工具，页面运行无需这些文件。

## 测试

使用 Node.js 内置的 `node:test`，无需安装 npm 依赖。已在 Node.js 24.15.0 下验证：

```sh
node --test tests/color-math.test.cjs tests/export-csv.test.cjs
```

当前共 **63 项测试**，包括矩阵、白点、Gamma、黑位、舍入、颜色转换、亮度补偿、中间记录、CSV 结构与数值一致性。目标计算覆盖 39 个 Pattern × 4 色域 × 3 EOTF × 2 位深 × 2 信号范围，共 1872 个参数组合。

CIEDE2000 使用 Sharma、Wu、Dalal 的 34 组参考数据，两个方向均验证，容差为 0.000051，以覆盖参考值的四位小数舍入：

- [作者页面及论文说明](https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/)
- [原始参考数据](https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/dataNprograms/ciede2000testdata.txt)

## 适用范围

这是 SDR 理论计算与数值对照工具，尚未与运行中的 Calman 逐项对照，不宣称复现其所有设置和工作流。黑白场直接使用输入的计算值。

本版未包含 PQ / HLG、HDR 色差、3D LUT、原生 Gamma 测量曲线、SG / Video / 自定义 Pattern 文件导入、仪器通信或自动校准。

屏幕色块是经过 sRGB 裁切的示意，不是校准信号发生器，也不能证明当前显示器的实际亮度与色准。xy 图展示色域三角形及目标 / 实测点，不包含完整光谱轨迹。
