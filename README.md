# 衡策 Quant Desk

面向中国 A 股与美国股票的“可切换投资方法”量化研究平台。用户首先选择多因子平衡、质量价值、质量逆向、深度价值、合理价格成长、周期防守、全天候风险平衡或趋势反馈；公开人物姓名只在次级位置说明方法论资料来源。平台保留同一份行情与公司事实，只改变投资范围、因子贡献、硬门槛、行动、首笔仓位、等待条件、退出纪律和复核节奏。

基金经理系统把 [Augur](https://github.com/BruceLanLan/augur) 的独立判断、因子差异与反方挑战，[InvestorSkills](https://github.com/questflowai/investorskills) 的完整投资契约，以及 [AI Berkshire](https://github.com/xbtlin/ai-berkshire) 的证据纪律、论文红线与组合复核，蒸馏为一套衡策统一决策框架。这里的“蒸馏”是多源投资研究方法论与工作流蒸馏，不是机器学习模型蒸馏。

## 可切换投资经理与统一蒸馏框架

首页用目标与风险的生活化问题帮助新手缩小方法范围，并明确这不是适当性建议。个股主路径默认并排展示当前方法和量化差异最大的反方方法，回答“最看重什么、当前结论、最大仓位、最担心什么、什么会改判”；其余六种方法收进展开层。证据未达到 A 级双源或存在冲突时，卡片显示“此方法无法形成结论”，最大仓位保持 0%（仅研究），不会用技术信号替代基本面结论。

- **统一契约**：每位经理均定义投资范围、决策节奏、五层因子偏置、硬门槛、仓位政策、证据政策与监控规则。
- **五步评判**：筛选 → 研究 → 反方挑战 → 决策 → 监控；经理面板可展开查看归一化因子贡献和每一步的目的。
- **证据闸门**：决策关键财务字段优先一手来源并要求两个独立来源；相对差异超过 1% 时阻断买入，缺失字段明确显示“待补证”。
- **同一事实、不同镜头**：个股分析沿用一个弹窗，按行情分析、财报与增长、公司新闻、经理解读四类组织；切换经理不会改写原始事实。
- **持仓论文复核**：在原持仓评价中呈现论文基线、红线、证据等级、最大持仓集中度和机会成本；尚未建立 3–7 条结构化假设时不生成虚假健康分。

公开人物经理是依据股东信、演讲和机构资料建立的系统方法论映射，不代表人物本人观点、真实持仓或收益承诺。统一 Skill 与来源版本见 [`skills/hengce-manager-distillation/SKILL.md`](skills/hengce-manager-distillation/SKILL.md) 和 [`docs/investor-manager-audit.md`](docs/investor-manager-audit.md)。

## 开箱即用的数据模式

项目默认不要求使用者申请或填写 API Key：

- 中国市场：`BaoStock` 为主数据源，新浪财经日线为自动备用源。
- 美国市场：`yfinance` 批量读取，缺失标的自动按单标的重试。
- 浏览器只请求本项目自己的数据 API，不会直接依赖第三方接口格式。
- 应用启动后通过一次 `/api/signals` 后台准备四个数据页面；切换页面直接使用内存结果，不再逐页等待。
- 服务端把同一供应商需要的股票代码合并读取，并按标的共享 30 分钟缓存；市场择时、板块轮动与资金流向不会重复下载相同日线。
- 上游临时失败时，页面会显示“缓存数据”或“连接失败”，不会使用演示数字冒充真实行情。

市场择时使用收盘日线，属于自动更新的 EOD 数据，不是交易所实时行情。

## 数据源中心

打开 <http://127.0.0.1:5173/#data-sources> 可以查看六类数据源/账户通道：

- 免费模式：默认启用，中美市场均不要求登录或 API Key。
- IBKR：通过本机 TWS / IB Gateway 的官方 Socket API 读取账户与持仓；券商账号、密码和登录过程始终留在官方客户端。
- QMT：通过券商 QMT / miniQMT 的 `xtquant` 读取资产与持仓；账户授权仍由券商客户端完成。
- 同花顺 iFinD：作为行情与研究数据入口展示；公开 QuantAPI 不读取普通同花顺客户端的零售券商持仓。
- Databento：检查会话中输入的 Key 格式；Key 不会回传、写入浏览器存储或保存到配置文件。
- 直连交易所：只登记适配器名称和协议，不会请求用户填写的任意 URL。正式启用前必须实现并审查专用适配器。

IBKR 与 QMT 当前只提供一次性只读持仓快照：不保存资金账号，不接收券商密码，也没有下单 API。专业行情来源尚未接管页面行情；在此之前页面始终使用免费延迟数据回退。

### IBKR 只读持仓

1. 安装并登录 TWS 或 IB Gateway，在 API 设置中启用 Socket 客户端。
2. 确认本机端口。常见纸面账户端口为 `7497`，实盘 TWS 常见为 `7496`，最终以客户端设置为准。
3. 在数据源中心选择 IBKR，填写端口和不冲突的 Client ID，点击“同步只读持仓”。

服务端只允许 `127.0.0.1`、`localhost` 或 `::1`，不会连接用户填写的远程 IBKR 主机。官方参考：[TWS API 文档](https://www.interactivebrokers.com/campus/ibkr-api-page/twsapi-doc/)。

### QMT / miniQMT 只读持仓

1. 向支持 QMT 的券商申请并开通 xtquant 权限，以极简模式登录 miniQMT。
2. 使用 QMT 支持的 Python 环境运行本项目；`xtquant` 通常由券商客户端提供，不写入本项目 `requirements.txt`。
3. 在数据源中心填写客户端安装目录下的 `userdata_mini` 绝对路径和资金账号，点击“同步只读持仓”。

服务端调用 `query_stock_asset` 与 `query_stock_positions`，只生成标准化快照。官方参考：[XtQuant 交易模块](https://dict.thinktrader.net/nativeApi/xttrader.html)。

## 自定义持有期限

个股分析的持有期限为 1–365 天连续滑轨，也可直接输入天数。滑轨使用对数刻度，让 1日、1周、1月、3月、1年都保留足够操作空间；拖动期间仅更新轻量标签，停顿约 140ms 后再计算完整决策，以减少大段 DOM 重绘造成的卡顿。

## 本地启动

要求：Node.js 20+、Python 3.10+。

### Windows 一键安装

下载或克隆完整项目后，双击 `setup-windows.cmd`。脚本会在项目目录创建 `.venv`、依据 `requirements.txt` 安装数据脚本依赖、执行 `npm ci`，并在当前电脑桌面生成“衡策 Quant Desk”快捷方式。之后双击快捷方式即可启动本机数据 API、网页界面并打开总览。

快捷方式只能在创建它的本机使用，因为其中必须指向该用户实际下载项目的位置。不能把你电脑上的 `.lnk` 文件直接发给其他人；每位下载者都应在自己的电脑上运行一次 `setup-windows.cmd`。Node.js 和 Python 属于系统运行环境，若电脑尚未安装，脚本会明确提示先安装对应版本，不会静默下载或执行第三方系统安装包。

### 手动安装 / macOS / Linux

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
GET /api/instruments/search
GET /api/quotes
GET /api/analysis
GET /api/company-research
GET /api/macro
GET /api/market-timing
GET /api/market-timing?refresh=1
GET /api/sector-rotation
GET /api/sector-rotation?refresh=1
GET /api/investor-sentiment
GET /api/investor-sentiment?refresh=1
GET /api/capital-flow
GET /api/capital-flow?refresh=1
GET /api/capital-flow/constituents
GET /api/micro-market
GET /api/data-sources
GET /api/health
POST /api/data-sources/check
POST /api/news-credentials
POST /api/broker-accounts/snapshot
POST /api/broker-accounts/quotes
```

### 公司财报与公司新闻

搜索股票后的公司研究采用可替换的数据供应商，并把“已连接、未配置、暂时失败、使用上次成功数据”分开显示：

- 美股财报与公司身份：SEC EDGAR Companyfacts + Submissions，随申报更新；不需要 API Key。Submissions 只提供行业分类、总部、历史名称和申报入口，不能自动证明产品、市场份额或护城河。生产环境应设置 `SEC_USER_AGENT`，内容包含应用名称和可联系邮箱，以符合 SEC 自动访问要求。
- 美股公司新闻：Finnhub Company News。设置 `FINNHUB_API_KEY` 后启用，页面按接口返回的刷新周期自动检查。
- 中美媒体搜索：GNews。设置 `GNEWS_API_KEY` 后启用；公开发布和商业使用必须匹配 GNews 当前订阅条款。
- A 股财报、公司画像与公告：Tushare Pro。设置 `TUSHARE_TOKEN`，并为账户开通 `income`、`balancesheet`、`cashflow`、`stock_company` 与 `anns_d` 权限；媒体快讯 `news` 是单独权限。

经理解读统一建立八维公司研究档案：产品与客户价值、护城河、市场地位/份额、管理层与资本配置、未来预期、估值、催化、风险。字段没有来源时保持“待补证”，不会由利润率或历史涨幅推断。关键财务字段的第二来源可通过响应中的 `financialEvidence.<field>.sources[]` 接入；单源为 B 级、仅供研究，全部关键字段具有一手来源和两个独立来源且差异不超过 1% 才是 A 级。

每位用户都需要填写自己的 API Key，项目不会内置或共享开发者密钥。可以在数据源中心填写 Finnhub 和 GNews Key，也可以设置同名环境变量；环境变量优先。网页填写的密钥只由本机 API 保存到当前操作系统用户的配置目录（Windows 为 `%APPDATA%\\HengCeQuantDesk\\credentials.json`），不会写入浏览器存储、项目仓库或接口响应。公司研究默认每 10 分钟检查一次；历史成功结果会写入 `.cache/company-research`，上游短暂失败时返回带有 `stale-fallback` 标记的最后一次成功快照。财报仍以供应商的披露更新频率为准，定时检查不会把低频披露伪装成实时财务数据。

### 开源下载后的数据来自哪里

- 零配置行情仍由每位使用者的本机 Python 服务直接访问 BaoStock、yfinance 和已配置的公开备用源；数据不经过你的电脑。
- SEC 官方公司披露不要求 API Key；Finnhub、GNews、Tushare、IBKR 和 QMT 则分别取决于使用者自己的凭证、账户权限和本机客户端。
- `setup-windows.cmd` 安装的是获取数据所需的客户端脚本和 Python 包，不会把行情数据本身打包进仓库，也不能保证第三方网站永久不变。
- 免费行情适合本地研究和开源体验，但存在限流、延迟、字段变化或临时不可用风险；系统会标记缓存与失败状态。若要面向公众提供稳定的商业网站，应部署后端、监控上游并采购允许再分发的行情与新闻授权。

只读持仓请求示例：

```json
{
  "sourceId": "ibkr",
  "config": { "host": "127.0.0.1", "port": 7497, "clientId": 18 }
}
```

响应统一包含 `sourceId`、`readOnly`、脱敏账户信息、`positions` 与 `fetchedAt`。QMT 请求把 `config` 替换为 `qmtPath`、`accountId` 和 `accountType`；这些配置只用于本次请求，不写入浏览器存储。

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

## 中美全市场分层扫描

扫描器不再使用固定37只股票。A股股票宇宙来自 BaoStock 全部正常上市股票基础资料；美股股票宇宙来自 Nasdaq Trader 的 `nasdaqlisted.txt` 与 `otherlisted.txt`，并在股票池层排除ETF、测试证券、权证、单位、优先股和明显的债务产品。

第一层批量读取约6个月日线，只计算流动性、趋势、20/60日动量、量能和距60日高点；第二层只把每个市场排名靠前的短名单交给现有VRVP和五层决策。这样不会对上万只股票逐个运行完整分析。

运行完整扫描（首次运行较慢，可中断后再次执行并从当日检查点继续）：

```bash
npm run scan:market
```

只运行第一层：

```bash
npm run scan:prescreen
```

快速验证20只/市场并深度分析前5只/市场：

```bash
npm run scan:market -- --max-symbols 20 --deep-limit 5 --fresh
```

主要输出：

- `output/scanner/prescreen-latest.json`：两个市场的初筛短名单与覆盖统计。
- `output/scanner/decisions-latest.json`：VRVP、五层得分、条件买入区、目标区和失效位。
- `output/scanner/checkpoint-*.json`：当日逐股票检查点，用于断点续扫。
- `output/scanner/universe-*.json`：带来源、名称、交易所和行业映射的当日股票宇宙。

`--max-symbols` 只用于验证；省略或设为0才是全市场。免费数据源可能限流或缺少个别股票历史，失败项目会计入输出而不会被填成中性分。扫描结果仅供研究，不构成投资建议。

## 开源许可

仓库尚未加入项目级 `LICENSE` 文件。正式公开前，请由项目所有者选择并加入合适的开源许可证；第三方行情数据的使用条款不随代码许可证一同授权。
