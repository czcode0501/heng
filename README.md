# 衡策 Quant Desk

面向中国 A 股与美国股票的本地量化研究工作台。当前包含组合管理、股票搜索与分析、宏观信号、市场择时、板块轮动与资金流向等模块。

## 开箱即用的数据模式

项目默认不要求使用者申请或填写 API Key：

- 中国市场：`BaoStock` 为主数据源，新浪财经日线为自动备用源。
- 美国市场：`yfinance` 批量读取，缺失标的自动按单标的重试。
- 浏览器只请求本项目自己的数据 API，不会直接依赖第三方接口格式。
- 应用启动后通过一次 `/api/signals` 后台准备四个数据页面；切换页面直接使用内存结果，不再逐页等待。
- 服务端把同一供应商需要的股票代码合并读取，并按标的共享 30 分钟缓存；市场择时、板块轮动与资金流向不会重复下载相同日线。
- 上游临时失败时，页面会显示“缓存数据”或“连接失败”，不会使用演示数字冒充真实行情。

市场择时使用收盘日线，属于自动更新的 EOD 数据，不是交易所实时行情。

## 本地启动

要求：Node.js 20+、Python 3.10+。

```bash
python -m venv .venv
```

激活虚拟环境后安装依赖：

```bash
pip install -r requirements.txt
npm ci
```

启动数据 API：

```bash
npm run dev:api
```

在第二个终端启动前端：

```bash
npm run dev
```

打开：<http://127.0.0.1:5173/#signals/capital-flow>

## 市场择时模型

中美市场分别计算，不共享固定阈值。每个市场由五个互补维度组成：

| 维度 | 权重 | 衡量内容 |
|---|---:|---|
| 趋势 | 30% | 指数相对中长期均线的位置和均线斜率 |
| 市场广度 | 25% | 行情参与范围，识别少数权重股推动的脆弱上涨 |
| 成交与流动性 | 15% | 成交扩张是否与价格方向相互确认 |
| 波动与压力 | 15% | 实际或预期波动、阶段回撤和市场压力 |
| 风险偏好 | 15% | 小盘、成长和信用风险资产相对表现 |

API 返回综合得分、市场阶段、模型风险暴露区间、信心等级、底层指标、数据日期和质量状态。风险暴露区间是研究模型输出，不构成个性化投资建议。

## 资金流与板块轮动

资金流向保留独立分析页面，负责解释方向、持续性、量能和价格背离；板块轮动只接收一个去重后的“资金确认”维度，权重为 15%。这样既保留分析透明度，又避免把 CMF、Flow %、MFI、OBV 等相关指标重复计权。

资金流页面沿用 Sector Flow 的九项价格—成交量证据，并分别展示 1 日、5 日和 20 日窗口。`估算净流额` 只用于展示规模，不参与跨板块评分。所有资金流数值都是基于日线 OHLCV/成交额的估算，不代表交易所披露的机构真实净买入。

## API

```text
GET /api/signals
GET /api/macro
GET /api/market-timing
GET /api/market-timing?refresh=1
GET /api/sector-rotation
GET /api/sector-rotation?refresh=1
GET /api/capital-flow
GET /api/capital-flow?refresh=1
```

普通请求优先使用仍然新鲜的缓存。`refresh=1` 会要求服务端立即重新检查外部数据源；请勿高频调用。

完整的数据源分组、共享范围与降级规则见 [`docs/data-interface-map.md`](docs/data-interface-map.md)。

## 数据来源与许可边界

- [BaoStock PyPI](https://pypi.org/project/baostock/)：客户端包采用 BSD License，提供中国证券历史数据访问。
- [yfinance API 文档](https://ranaroussi.github.io/yfinance/reference/index.html)：支持多标的历史行情下载。
- [yfinance 使用声明](https://github.com/ranaroussi/yfinance#readme)：工具本身采用 Apache License，但 Yahoo Finance 数据面向研究、教育及个人使用，实际数据权利受 Yahoo 条款约束。

因此，当前零配置模式适合本地研究和个人使用。如果将项目部署为商业产品或公开再分发行情数据，应替换 `market_timing_sources.py` 中的数据适配器，接入获得相应授权的供应商。评分模块 `market_timing.py` 与数据提供商解耦，不需要重写前端合同。

## 测试

```bash
npm test
npm run build
```

测试覆盖数据规范化、评分维度、备用源切换、缓存降级、API 既有功能和前端状态渲染。

## 开源许可

仓库尚未加入项目级 `LICENSE` 文件。正式公开前，请由项目所有者选择并加入合适的开源许可证；第三方行情数据的使用条款不随代码许可证一同授权。
