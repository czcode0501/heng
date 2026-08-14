const pending = (name) => ({ name, status: "pending" });

export const macroMarkets = [
  {
    id: "china",
    code: "CN",
    title: "中国宏观环境",
    english: "CHINA MACRO",
    description: "聚焦中国的货币信用、增长周期与通胀盈利，后续单独形成中国宏观评分。",
    groups: [
      {
        title: "货币与信用",
        description: "观察流动性、信用扩张及金融条件。",
        indicators: [
          pending("M1同比与3个月动量"),
          pending("M2同比"),
          pending("社会融资规模存量同比"),
          pending("信用脉冲"),
          pending("DR007－7天逆回购利率"),
        ],
      },
      {
        title: "增长周期",
        description: "识别生产、订单与企业盈利所处阶段。",
        indicators: [
          pending("制造业PMI"),
          pending("PMI新订单"),
          pending("规模以上工业增加值"),
          pending("工业企业利润"),
        ],
      },
      {
        title: "通胀与盈利",
        description: "跟踪居民价格、工业价格与利润传导。",
        indicators: [pending("CPI同比"), pending("核心CPI同比"), pending("PPI同比"), pending("PPI－CPI剪刀差")],
      },
    ],
  },
  {
    id: "united-states",
    code: "US",
    title: "美国宏观环境",
    english: "UNITED STATES MACRO",
    description: "聚焦美国的通胀政策、增长就业与金融条件，后续单独形成美国宏观评分。",
    groups: [
      {
        title: "通胀与美联储",
        description: "判断通胀粘性与货币政策压力。",
        indicators: [pending("核心PCE同比"), pending("CPI同比"), pending("联邦基金目标利率")],
      },
      {
        title: "增长与就业",
        description: "跟踪经济动能与劳动力市场变化。",
        indicators: [pending("ISM制造业PMI与新订单"), pending("非农就业"), pending("失业率"), pending("首次申请失业金人数")],
      },
      {
        title: "金融条件",
        description: "观察利率、信用和美元对风险资产的约束。",
        indicators: [
          pending("美国10年期实际利率"),
          pending("10年－2年期限利差"),
          pending("NFCI"),
          pending("高收益债利差"),
          pending("美元指数DXY"),
        ],
      },
    ],
  },
];
