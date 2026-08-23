# 投资经理方法论来源与差异审计

审计日期：2026-08-22

## 结论

这 7 个具名经理不是人物模拟器，而是“公开方法论约束层”。当前实现已经能在相同输入下改变研究门槛、行动代码、首笔仓位和组合目标暴露；它不能证明未来收益，也不能替代完整的基本面或宏观研究。

最重要的完整性边界：美股个股分析可动态读取 SEC EDGAR 结构化财报、公司身份/行业资料和官方申报；A 股在用户配置 Tushare 权限后可读取三张财务报表、主营业务、经营范围、管理层、公告与财经快讯。关键财务字段仍缺第二个独立来源，通用市场份额与估值也尚未补齐。因此系统不会用技术指标、单源财报或历史增长伪装成最终买入结论，而是输出证据等级、八维公司研究缺口、冲突状态和决策边界。

## 三套开源 Skill 的统一蒸馏

本轮不是复制三个项目的实现，而是把适配衡策现有功能的信息结构和评判纪律合并为一个 `hengce-manager-distillation@1.0.0` 契约：

| 来源 | 审计版本 | 蒸馏进入衡策的能力 | 产品归属 |
|---|---|---|---|
| [Augur](https://github.com/BruceLanLan/augur) | `eade71a` | 独立判断、因子贡献、反方挑战、分歧优先于盲目共识 | 基金经理面板与经理解读 |
| [InvestorSkills](https://github.com/questflowai/investorskills) | `806a5d7` | 投资范围、决策节奏、信号、过滤、仓位、风险、执行、监控的完整契约 | 所有经理的统一配置骨架 |
| [AI Berkshire](https://github.com/xbtlin/ai-berkshire) | `6fb75c9` | A/B/C 信息丰富度、双源核验、1% 冲突闸门、明确结论、论文红线、组合机会成本 | 个股分析与持仓评价 |

三者均在审计版本中声明 MIT 许可。本项目只蒸馏公开方法结构和判定原则，没有复制人格语气、宣传文案或项目代码；每位人物经理的方法论主来源仍是下表中的股东信、演讲和机构资料。

## 权威来源与蒸馏覆盖

评分说明：5 表示公开信息足以覆盖主要方法；4 表示核心方法有直接依据但细节不完整；3 表示只覆盖公开框架，无法还原真实组合流程。公开资料不可能证明任何人物的完整内部决策过程，因此本审计不给出“完全复刻”。

| 经理 | 核心来源 | 来源强度 | 方法覆盖 | 当前运行数据覆盖 | 审计结论 |
|---|---|---:|---:|---:|---|
| 沃伦·巴菲特 | [1986 Berkshire 股东信](https://www.berkshirehathaway.com/letters/1986.html)、[2012 股东信](https://berkshirehathaway.com/letters/2012ltr.pdf)、[2018 股东信](https://berkshirehathaway.com/letters/2018ltr.pdf) | 一手/公司官方 | 4/5 | 依标的而变 | 所有者收益、护城河、资本配置、优质企业与合理价格有直接依据；产品、护城河、管理层、可再投资跑道和估值必须逐项取证。 |
| 查理·芒格 | [1994 USC《普世智慧》演讲转录](https://fs.blog/great-talks/a-lesson-on-worldly-wisdom/)、[1995《人类误判心理学》转录](https://fs.blog/great-talks/psychology-human-misjudgment/) | 一手演讲/二手托管 | 3/5 | 0/4 | 多元模型、激励与认知偏误有明确原始演讲依据；网页由第三方托管，且真实投资清单并未完全公开。 |
| 本杰明·格雷厄姆 | [1976 Financial Analysts Journal 访谈](https://rpc.cfainstitute.org/-/media/documents/book/rf-publication/1977/rf-v1977-n1-4731-pdf.pdf)、[CFA Living Legends](https://rpc.cfainstitute.org/research/cfa-magazine/2003/living-legends)、[安全边际说明](https://rpc.cfainstitute.org/blogs/enterprising-investor/2015/margin-of-safety-the-lost-art) | 一手访谈/权威机构 | 4/5 | 依标的而变 | 资产、标准化盈利、折价和安全边际得到支持；增长只能作为上行选择权，不能替代当前价值。 |
| 彼得·林奇 | [Fidelity 投资传奇课程转录](https://www.fidelity.com/bin-public/060_www_fidelity_com/documents/learning-center/Transcript_Investing%20legends_v2.pdf)、[Fidelity Investing Legends](https://www.fidelity.com/bin-public/060_www_fidelity_com/documents/learning-center/Presentation_Investing%20legends.pdf) | 雇主机构/直接引语 | 4/5 | 依标的而变 | 公司故事、成长类型、PEG、库存、债务和现金检查有直接材料；仍需按标的补市场空间、里程碑和估值。 |
| 霍华德·马克斯 | [Taking the Temperature](https://www.oaktreecapital.com/insights/memo/taking-the-temperature)、[The Best of the Memos](https://www.oaktreecapital.com/insights/memo/the-best-of) | 本人/公司官方 | 4/5 | 3/4 | 第二层思维、周期温度、风险控制与逆向判断覆盖较好；信用周期数据仍缺失。 |
| 瑞·达利欧 | [Bridgewater《The All Weather Story》](https://www.bridgewater.com/research-and-insights/the-all-weather-story)、[Investing in a New World](https://www.bridgewater.com/research-and-insights/investing-in-a-new-world-capturing-opportunity-and-weathering-uncertainty)、[Big Debt Crises](https://www.bridgewater.com/big-debt-crises/principles-for-navigating-big-debt-crises-by-ray-dalio.pdf) | 本人机构官方 | 4/5 | 宏观有，跨资产风险待补 | 增长/通胀四象限、股票/债券/黄金等跨资产平衡和风险贡献有直接依据；系统已禁止用该框架孤立地产生单股仓位。 |
| 乔治·索罗斯 | [CEU《Financial Markets》演讲](https://www.opensocietyfoundations.org/uploads/2b96bb8c-e2e1-4d88-9eea-badf16d0a2b8/george-soros-financial-markets-transcript.pdf)、[General Theory of Reflexivity](https://www.opensocietyfoundations.org/uploads/9ae17912-2262-4646-8ffc-d01afc934c36/george-soros-general-theory-of-reflexivity-transcript.pdf)、[Open Society Foundations 讲座系列](https://www.opensocietyfoundations.org/publications/george-soros-open-society-financial-crisis-and-way-ahead) | 本人/基金会官方 | 4/5 | 市场代理有，公司反馈事实依标的而变 | 反身性、易错性和认知—现实双向反馈有一手依据；价格、情绪和趋势只是代理，必须与公司催化、预期和真实行为变化交叉验证。 |

## 八维公司研究档案

所有经理读取相同事实，但按各自方法重新排序以下八个维度：产品与客户价值、护城河证据、市场地位/份额、管理层与资本配置、未来预期、估值与回报前提、催化与里程碑、失败情景与风险。

- 每个维度分别标记“多源覆盖”“单源/部分覆盖”或“待补证”，历史财务不能自动证明护城河或市场份额。
- 市场份额必须带统计口径、地区、期间和来源；没有通用可靠来源时保持待补证。
- 未来预期只接受公司指引、订单/产能、行业需求或其他可证伪假设；历史增速不直接外推。
- 持仓评价复用同一个公司研究缓存，并显示八维覆盖度；不再统一声称组合接口没有基本面数据。
- B 级单源关键财务事实可以支持研究解读，但 `canBuy=false`；只有 A 级双源核验且无超过 1% 的冲突才通过证据闸门。

## 相同输入的横向测试

运行命令：

```bash
npm run audit:managers
```

| 场景 | 动作动词种类 | 行动代码种类 | 综合分跨度 | 可执行首笔仓位中点 | 目标暴露范围 |
|---|---:|---:|---:|---:|---:|
| 强势支撑 | 2 | 8 | 19.6 分 | 10%–30% | 62%–75% |
| 周期冲突 | 2 | 8 | 17.5 分 | 7.5%–10% | 62%–75% |
| 持仓破位 | 1 | 3 | 14.3 分 | 无新增仓位 | 62%–75% |
| 中性区间 | 1 | 2 | 2.6 分 | 无新增仓位 | 62%–75% |

强势支撑场景的具体输出：

| 经理 | 综合分 | 动作 | 首笔仓位中点 | 70%统一基准后的目标暴露 |
|---|---:|---|---:|---:|
| 衡策多因子 | 76.8 | 买入 | 25% | 70% |
| 沃伦·巴菲特 | 75.2 | 等待基本面/估值证据 | — | 75% |
| 查理·芒格 | 73.9 | 等待企业质量/管理层/估值证据 | — | 73% |
| 本杰明·格雷厄姆 | 66.1 | 等待资产负债表/盈利/估值证据 | — | 65% |
| 彼得·林奇 | 79.3 | 等待增长/财务/估值证据 | — | 72% |
| 霍华德·马克斯 | 72.5 | 防守仓试探 | 10% | 62% |
| 瑞·达利欧 | 77.1 | 转入跨资产组合风险模型 | — | 67% |
| 乔治·索罗斯 | 85.7 | 趋势反馈确认后参与 | 30% | 70% |

“持仓破位”场景中所有经理都要求卖出/减仓，“中性区间”中所有经理都等待。这种收敛是有意保留的共同风险约束；如果为了展示差异而强迫某位经理在明确破位时买入，反而会降低方法准确性。

## 差异指数

审计脚本还给出相对衡策多因子的 0–100 行为差异指数。它组合动作动词、行动规则、综合分、目标暴露和首笔仓位；只用于检测“切换经理是否真正改变产品行为”，不代表预测准确率或预期超额收益。

| 经理 | 四场景平均差异指数 |
|---|---:|
| 沃伦·巴菲特 | 41.5 |
| 查理·芒格 | 39.7 |
| 本杰明·格雷厄姆 | 51.9 |
| 彼得·林奇 | 36.8 |
| 霍华德·马克斯 | 48.0 |
| 瑞·达利欧 | 41.4 |
| 乔治·索罗斯 | 22.4 |

## 本轮发现与修复

修复前，强势支撑场景只有 2 种行动代码，4 位可执行经理的首笔仓位完全相同。根因是人物权重只影响综合分，而最终动作主要由一套共享硬编码分支决定；仓位字符串也只有一个公共模板。

修复后：

1. 每位基本面经理拥有独立研究闸门与缺失证据。
2. 马克斯在周期偏热/拥挤时转为等待，在正常周期只用防守仓试探。
3. 达利欧镜头只把单股结论送入跨资产组合风险模型；单股页面无论数据是否齐全，都不会直接输出全天候仓位。
4. 索罗斯要求趋势反馈确认，并在反馈反转时使用快速纠错规则。
5. 适用于单股决策的经理拥有独立首笔仓位和最大单次风险上限；达利欧不参与这项单股仓位比较。

## 仍未证明的部分

- 这些测试证明“行为不同且与公开方法一致”，不证明哪位经理未来收益更高。
- 真正的历史准确率测试需要无前视偏差的逐期财务、估值、信用、宏观和价格快照，以及交易成本与退市样本。
- 在补齐这些数据前，巴菲特、芒格、格雷厄姆和林奇镜头应继续保持研究闸门，不能把技术信号冒充基本面结论。
