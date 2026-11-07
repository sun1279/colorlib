# Calman SDR 计算模拟器

## 使用

直接用浏览器打开 `index.html`。不需要安装依赖或启动后端；没有 CDN、远程字体或数据请求。所有 JS 均为经典脚本，可使用 `file://` 打开。

选择色域、白点、Gamma、黑白场亮度及信号格式，然后从 Pattern 库选择色块。输入实测 xyY 即可计算色差。“填入当前目标”用于验证相同输入得到零色差，不代表真实测量。实测输入按 Pattern 存储在当前页面内存中，关闭或刷新页面即丢失；改变目标条件会保留该 Pattern 的实测输入并重新比较。

Pattern Library 右侧的“导出 CSV”按点击时的当前设置导出全部 39 个 Pattern，不受搜索、分类或选中色块影响。CSV 仅保留以下 7 列，顺序固定：`Pattern, x, y, Y_nit, R_code, G_code, B_code`。文件包含 UTF-8 BOM，行分隔符为 CRLF；数值保存可回读的双精度字符串，不按页面显示位数截断。

导出跟随“按实际码值计算目标”选项：开启时 xyY 由量化后的信号计算，关闭时由理想信号计算，此时 RGB 码值仅作参考。色域、Gamma、位深、范围与计算模式保留在文件名中，CSV 不额外添加参数、警告或实测数据列。黑场仍保留源码的微小目标亮度下限。任何一个 Pattern 计算失败时均不生成部分文件。下载位置及重名处理由浏览器决定。

导出列调整后的 9 项 CSV 测试全部通过，覆盖 39 行、固定 7 列、数值与计算内核一致、理想/量化模式、不同参数、中文与 CSV 转义及错误处理。浏览器下载、筛选时仍导出全部色块、手机按钮布局及无效设置禁用行为已在功能开发时验证。

运行数值测试（Node.js 24.15.0 已验证）：

```powershell
cd colorlib
node --test tests/color-math.test.cjs tests/export-csv.test.cjs
```

## 源码与实现映射

原始参考为 CalIO 的 `Cal.CalIO` 命名空间代码，下表按原文件名列出对应关系。原始 C# 工程、DLL 和分析工具不包含在本仓库；运行页面不需要这些文件。

| 源文件 / 成员 | 页面实现 | 要点 |
| --- | --- | --- |
| `GamutPrimarySet.cs`，Rec709_sRGB / Rec2020 / DCI_P3 / Adobe | `presets.js` | 原色坐标从源码提取；白点可独立选择 |
| `CalGamut.cs`，DefaultGamut.GetDefault_D65_709 | `presets.js` | 默认 D65 使用源码精度 0.312713 / 0.329016；不是常见四位小数近似值 |
| `ColorCheckerSource.cs`，WhiteSource / BlackSource / ClassicCC_Source / FullSatSource | `patterns.js` | 原样录入 18 个 Classic 彩色 xyYn + 4 个相对亮度灰；另有白黑、RGB/CMY 与 9 个信号灰 |
| `ColorDefinition__White_LStar.cs`、`ColorDefinition_Lab.cs` | `resolvePattern` | Classic 的 Gray 35/50/65/80 对应相对白亮度；当前白点决定灰色 xy |
| `ColorCheckerCollection.cs`，DoUpdateList | `resolvePattern` | 内置 SDR 使用无动态 Gamma 的 GetRGB_Vals，默认先把信号百分比取为整数 |
| `ColorDefinition_XnYnZn.cs`，GetRGB_Vals | `resolvePattern` | XYZ→线性 RGB；最大通道大于 1 则全通道同比例缩放；裁切到 0–1；固定 1/2.2 编码 |
| `Utility.cs`，GetBitFromPercent / GetPercentActualFromBit；`BitSpace.cs` | `roundEven` / `quantizeRgb` / `signalRange` | 两次舍入采用 .NET ToEven；先对幅度舍入，再加黑码偏移 |
| `GammaPower.cs`、`GammaBlackCompBase.cs`、`Gamma_sRGB.cs`、`Gamma_ITU1886.cs` | `eotf` | EOTF 返回含黑位的相对白亮度；BT.1886 指数固定 2.4 |
| `Colorspace.cs`，GetTargetXYZ_FromStimulus / LinearizeGamma | `calculateTarget` | 移除通道黑位，矩阵转换，保持 xy 后恢复亮度偏移；归一化 Yn 下限为 1e-11 |
| `CalculationPoint.cs`，UpdateTargets | `resolvePattern` + `calculateTarget` | 用实际 RGB 码值反解信号后计算目标，而不是直接使用 Pattern 的初始 xyYn |
| `Formulas.cs`，LabCH / LuvCH / DeltaE1976 / DeltaE1994 / DeltaE2000 | `xyzToLab` / `xyzToLuv` / `deltaE*` | 共同参考白；ΔE94 用目标色度计算权重；CIEDE2000 kL/kC/kH = 1 |
| `CalculationPoint.cs`，UpdateMeasures 中 LuminanceCompensated_Target_* | `calculateDeltaE` | 把目标 XYZ 缩放到实测 Y，然后重新计算色差 |

## 计算口径

内部 RGB 信号使用 0–1，界面信号百分比使用 0–100。源码部分接口混用百分比与单位区间，移植时在边界显式转换。

由三原色的 xy 先构造各自 Y=1 的 XYZ 列矩阵，求解白点的缩放系数，得到 `M_RGB→XYZ`。默认 D65 精度会导致结果与用 0.3127 / 0.3290 硬编码矩阵的工具存在微小差异。

设 `k=Lb/Lw`：

1. 原始 RGB 信号或固定 2.2 编码后的 ColorChecker RGB；
2. 可选百分比取整，再映射为 8/10 bit 码值，采用中点取偶；
3. 从码值反算真实信号 `s=(code−low)/(high−low)`；
4. 计算 `linear=(EOTF(s)−k)/(1−k)`；
5. 用矩阵计算无黑位的 XYZ，得到 xy；
6. `Yn=max(Ylinear*(1−k)+k, 1e−11)`，按原 xy 重建归一化 XYZ；
7. 乘以 Lw 得到绝对 XYZ / 亮度 Y。

全零信号的 xy 采用参考白约定值。真实零亮度的色度没有物理意义；保留 Calman 的微小目标下限并在界面提示，不把浮点下限误称为真实黑位。

Power EOTF 为 `k+(1−k)*s^gamma`。sRGB 对信号分段解码后施加相同黑位范围变换。BT.1886 使用 `((Lw^(1/2.4)−Lb^(1/2.4))*s+Lb^(1/2.4))^2.4/Lw`，与源码 a/b 参数形式代数等价。

原始 ColorChecker 的 Yn 相对白场定义，不因黑位改变；“原始定义”列按 Lw 缩放以便展示。固定编码路径生成的信号会随当前目标 EOTF 得到不同 xyY。理想列使用未执行两次取整的信号；量化列包含百分比及码值取整。关掉码值量化时，取整设置仅影响参考码值。

源代码还有 `Formulas.RGBtoXYZ_(StimulusRGB, ...)` 直接对各通道套 EOTF 的入口。本页目标使用实际 `CalculationPoint→Colorspace` 链路，避免非零黑位时混淆这两个入口。

实测 xyY→绝对 XYZ，以同一个参考白（其 Y=Lw）计算 Lab/Luv。改变绝对单位时，只要目标、实测、参考白同比例缩放，结果不变。亮度补偿需要目标 Y、实测 Y 均大于零；零亮度时直接报错并清空补偿色差，避免除零。实测高于白场的亮度不强行裁切。

## 数据验证

测试文件使用 Node 内置 `node:test`，无需 npm 依赖。验证矩阵独立系数、白点重建、幂函数和 sRGB/BT.1886 数值、黑位与灰阶、舍入、越界数据、Pattern 定义、亮度补偿与单位一致性。枚举 39 个 Pattern × 4 色域 × 3 EOTF × 2 位深 × 2 范围，共 1872 个参数组合，检查非零黑位目标为有限值且亮度在范围内。

ΔE2000 的 34 组参考值来自 G. Sharma, W. Wu, E. N. Dalal, *The CIEDE2000 Color-Difference Formula: Implementation Notes, Supplementary Test Data, and Mathematical Observations*, Color Research and Application, 30(1), 21–30 (2005)。

- 作者页面：https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/
- 原始测试数据：https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/dataNprograms/ciede2000testdata.txt
- 数据保存于 `tests/ciede2000-reference.txt`；结果精度允许 0.000051，以覆盖参考值四位小数舍入。两个方向都验证。

## 范围与限制

这是按已提供源码路径复现的 SDR 计算器，尚未与运行中的 Calman 逐项对照，因此不宣称与所有 Calman 设置、工作流完全一致。黑白场直接使用用户输入的计算值，没有完整复制 Calman 对测量黑位、参考峰值和用户选项的自动选择逻辑。

不包含 PQ/HLG、HDR 色差、3D LUT、实测原生 Gamma、SG/Video/自定义 Pattern 文件加载、仪器通讯、自动校准。数据输入只接受有限数字，色度约束为 x≥0、y>0、x+y≤1；这只是代数范围校验，不代表整个区域都是物理可实现色彩。

色块预览把目标相对 XYZ 转成标准 sRGB，裁切屏幕不可表示的通道。预览没有额外白点色适应，不能用于证明物理显示器的亮度或色准。xy 图仅画真实坐标上的色域三角形、目标和测量点，没有虚构光谱轨迹。

所有计算在内存中同步完成，无持久化、并发写入、外部服务或重试。配置无效时清空结果并显示错误，防止旧结果被误读为新配置输出。没有将反编译工程整体编译，也没有运行仪器相关代码。

## 本次验证记录

底部“计算过程与适用范围”默认折叠。展开时按当前实际使用的计算记录显示输入、矩阵生成、Pattern 编码/裁切、百分比与码值量化、EOTF 分支、黑位、目标 XYZ/xyY、参考白和 Lab/Luv。有效实测输入后继续展示实测转换、可选亮度补偿、两种 ΔE76、ΔE94 与完整 CIEDE2000 中间项。设置、实测输入或补偿开关变化会更新内容，并保留展开状态；重新加载页面时折叠。没有有效实测输入时，报告保留完整目标计算并提示等待；无效数据不展示旧色差记录。

中间值由 `color-math.js` 的原计算函数记录到返回对象的 `trace` 中，展示层只格式化数值。矩阵、EOTF、Lab/Luv 和色差单项函数允许可选的 trace 参数，原有返回类型保持兼容。报告显示约 10 位有效数字，内部仍使用双精度；报告末尾同时给出页面的三位小数结果。

本次完整报告改动后，54 项测试全部通过（含原有 34 组 CIEDE2000 参考样例）；新增验证覆盖矩阵记录、缩放/裁切与量化来源、sRGB/BT.1886 分支、目标结果重建和亮度补偿前后色差记录。浏览器验证了默认折叠、展开后的 12 个计算阶段、实测变化实时更新、补偿开关、错误输入清空、理想信号模式以及 390px 手机宽度无页面横向溢出。没有实测值时显示前 8 个阶段，并在实测阶段明确等待输入。

- 2026-11-07：49 项数值测试全部通过，其中包含 34 组 CIEDE2000 参考样例、双向验证，以及 1872 个目标参数组合。
- 浏览器实测：复制目标得到四种 ΔE=0；50% 理想信号、Gamma 2.4 得到 18.9465 nit；改变实测亮度产生色差，开启亮度补偿后归零。
- P3、10 bit Limited、BT.1886、黑位 0.1 的满红色度为 0.68 / 0.32，码值为 940 / 64 / 64。
- 验证 D50 与自定义白点、默认恢复、Pattern 切换后的测量值隔离、搜索及分类、无效配置/实测值清空结果。
- 检查桌面、平板及手机宽度；修正手机色差卡片过窄导致数字换行的问题。浏览器验证通过本机 HTTP 静态服务完成。尚未自动化验证直接打开本地文件的路径；页面本身不使用模块、fetch 或外部依赖。
