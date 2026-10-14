const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
  Header, Footer, AlignmentType, LevelFormat, HeadingLevel,
  BorderStyle, WidthType, ShadingType, PageBreak, PageNumber, VerticalAlign
} = require('docx');

const cjkFont = { ascii: "Arial", hAnsi: "Arial", eastAsia: "Microsoft YaHei" };
const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border };

const screenshots = {
  taskList: fs.readFileSync('/workspace/screenshots/task_list.png'),
  createTask: fs.readFileSync('/workspace/screenshots/create_task.png'),
  settings: fs.readFileSync('/workspace/screenshots/settings.png'),
  statistics: fs.readFileSync('/workspace/screenshots/statistics.png'),
};

function heading(text, level) {
  return new Paragraph({
    heading: level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
    spacing: { before: level === 1 ? 360 : 240, after: 120 },
    children: [new TextRun({ text, font: cjkFont, bold: true, size: level === 1 ? 32 : 28 })]
  });
}

function para(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text, font: cjkFont, size: 24, ...opts })]
  });
}

function bullet(text) {
  return new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    spacing: { after: 60 },
    children: [new TextRun({ text, font: cjkFont, size: 24 })]
  });
}

function image(img, w, h, desc) {
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 100 },
      children: [new ImageRun({
        type: "png",
        data: img,
        transformation: { width: w, height: h },
        altText: { title: desc, description: desc, name: desc }
      })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [new TextRun({ text: desc, font: cjkFont, size: 20, italics: true, color: "888888" })]
    })
  ];
}

function cell(text, opts = {}) {
  return new TableCell({
    borders: { top: border, bottom: border, left: border, right: border },
    width: { size: opts.width || 4680, type: WidthType.DXA },
    shading: opts.fill ? { fill: opts.fill, type: ShadingType.CLEAR } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text, font: cjkFont, size: 22, bold: opts.bold })] })]
  });
}

function table2col(rows) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [3000, 6360],
    rows: rows.map(([a, b]) => new TableRow({
      cantSplit: true,
      children: [
        cell(a, { width: 3000, bold: true, fill: "F0F4F8" }),
        cell(b, { width: 6360 })
      ]
    }))
  });
}

function spacer() {
  return new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: "" })] });
}

const doc = new Document({
  styles: {
    default: {
      document: { run: { font: cjkFont, size: 24 } }
    },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, font: cjkFont },
        paragraph: { spacing: { before: 360, after: 120 }, outlineLevel: 0, keepNext: false, keepLines: false } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, font: cjkFont },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1, keepNext: false, keepLines: false } },
    ]
  },
  numbering: {
    config: [
      { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "numbers", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    ]
  },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
      }
    },
    children: [
      // ===== 封面 =====
      new Paragraph({ spacing: { before: 3600 }, children: [new TextRun({ text: "" })] }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        children: [new TextRun({ text: "钉钉任务管理系统", font: cjkFont, size: 52, bold: true, color: "2B579A" })]
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 600 },
        children: [new TextRun({ text: "图文功能介绍手册", font: cjkFont, size: 36, color: "666666" })]
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        children: [new TextRun({ text: "基于钉钉工作台 | 免费 | 无需额外安装", font: cjkFont, size: 24, color: "999999" })]
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        children: [new TextRun({ text: "2026年10月", font: cjkFont, size: 24, color: "999999" })]
      }),
      new Paragraph({ children: [new PageBreak()] }),

      // ===== 目录概述 =====
      heading("一、系统概述", 1),
      para("本系统是一套基于钉钉工作台开发的任务管理应用，专为企业/部门内部的任务派发、跟踪、审批和统计而设计。系统直接嵌入钉钉工作台，员工无需安装任何额外软件，打开钉钉即可使用。"),
      para("系统完全免费，所有基础设施均使用免费额度："),
      bullet("前端托管：Cloudflare Pages（免费额度）"),
      bullet("后端服务：Cloudflare Workers（免费额度）"),
      bullet("数据库：Supabase / PostgreSQL（免费额度）"),
      bullet("用户体系：直接复用钉钉组织架构，无需单独注册登录"),
      spacer(),

      // ===== 技术架构 =====
      heading("二、技术架构", 1),
      para("系统采用前后端分离 + Serverless 架构，无需自建服务器："),
      table2col([
        ["前端框架", "Vue 3 + Vue Router + Vite"],
        ["UI组件库", "Vant 4（移动端组件库，适配钉钉内嵌打开）"],
        ["图表库", "ECharts（统计报表可视化）"],
        ["后端框架", "Hono（运行在 Cloudflare Workers 上）"],
        ["数据库", "PostgreSQL（Supabase 提供，含 REST API）"],
        ["身份认证", "钉钉免登（JSAPI authCode 换取用户身份）"],
        ["消息通知", "钉钉工作通知 API（任务派发/审批时推送）"],
        ["部署方式", "Cloudflare Pages + Workers（全球 CDN 加速）"],
      ]),
      spacer(),

      heading("工作原理", 2),
      para("1. 用户在钉钉中打开应用，前端通过钉钉 JSAPI 获取 authCode"),
      para("2. 前端将 authCode 发送到后端 Cloudflare Workers"),
      para("3. 后端用 authCode 调用钉钉 API 获取用户 userid"),
      para("4. 后端在 Supabase 数据库中查找或创建用户记录"),
      para("5. 后端返回 JWT Token，前端用 Token 访问所有 API"),
      para("6. 创建/流转任务时，后端通过钉钉 API 给相关人发送推送通知"),
      spacer(),

      // ===== 功能介绍 =====
      new Paragraph({ children: [new PageBreak()] }),
      heading("三、功能介绍", 1),

      // 3.1 任务列表
      heading("3.1 任务列表", 2),
      para("任务列表是系统的主界面，打开应用后首先看到。包含以下功能："),
      bullet("顶部统计卡片：全部/待办/进行中/已完成任务数量一目了然"),
      bullet("状态筛选标签：全部、待办、进行中、待审核、已完成，带数量显示"),
      bullet("搜索框：按任务标题或描述搜索"),
      bullet("分类标签筛选：按标签快速筛选任务（如：培训PPT、运行规程等）"),
      bullet("任务卡片：显示任务标题、标签、负责人、任务周期、流程进度"),
      bullet("长按批量操作：长按任务进入选择模式，可批量完成/删除"),
      bullet("右下角浮动按钮：快速创建新任务"),
      ...image(screenshots.taskList, 450, 300, "图1：任务列表主界面"),
      spacer(),

      // 3.2 新建任务
      heading("3.2 新建任务", 2),
      para("点击右下角\"+\"按钮进入新建任务页面，可填写以下信息："),
      table2col([
        ["任务类型", "部门任务 / 班组任务"],
        ["标题", "必填，任务名称"],
        ["描述", "任务的详细说明"],
        ["任务周期", "日任务 / 周任务 / 月任务 / 季度任务 / 年任务"],
        ["负责人", "谁执行这个任务（从钉钉通讯录选择）"],
        ["审批人", "谁审核任务完成情况"],
        ["部门主任", "部门负责人（关闭任务时需要）"],
        ["协作者", "多人协作（可多选）"],
        ["截止日期", "任务完成期限"],
        ["标签", "任务分类标签（如：培训PPT、运行规程等）"],
      ]),
      para("所有选择器均为底部弹窗 + 大蓝色\"确定\"按钮，操作统一方便。"),
      ...image(screenshots.createTask, 450, 300, "图2：新建任务表单"),
      spacer(),

      // 3.3 任务详情与流转
      heading("3.3 任务详情与审批流转", 2),
      para("点击任务卡片进入详情页，可查看完整信息并执行状态流转："),
      spacer(),
      para("任务状态流转流程：", { bold: true }),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        columnWidths: [1800, 1800, 1800, 1800, 2160],
        rows: [
          new TableRow({
            cantSplit: true,
            children: [
              cell("当前状态", { width: 1800, bold: true, fill: "D5E8F0" }),
              cell("可流转到", { width: 1800, bold: true, fill: "D5E8F0" }),
              cell("操作人", { width: 1800, bold: true, fill: "D5E8F0" }),
              cell("操作", { width: 1800, bold: true, fill: "D5E8F0" }),
              cell("说明", { width: 2160, bold: true, fill: "D5E8F0" }),
            ]
          }),
          new TableRow({ cantSplit: true, children: [cell("待办", {width:1800}), cell("进行中", {width:1800}), cell("负责人", {width:1800}), cell("开始执行", {width:1800}), cell("负责人点击开始", {width:2160})] }),
          new TableRow({ cantSplit: true, children: [cell("进行中", {width:1800}), cell("待审核", {width:1800}), cell("负责人", {width:1800}), cell("提交审核", {width:1800}), cell("负责人提交给审批人", {width:2160})] }),
          new TableRow({ cantSplit: true, children: [cell("待审核", {width:1800}), cell("已完成", {width:1800}), cell("审批人", {width:1800}), cell("审核通过", {width:1800}), cell("审批人通过", {width:2160})] }),
          new TableRow({ cantSplit: true, children: [cell("待审核", {width:1800}), cell("已驳回", {width:1800}), cell("审批人", {width:1800}), cell("驳回", {width:1800}), cell("审批人驳回", {width:2160})] }),
          new TableRow({ cantSplit: true, children: [cell("已驳回", {width:1800}), cell("进行中", {width:1800}), cell("负责人", {width:1800}), cell("重新执行", {width:1800}), cell("负责人重新开始", {width:2160})] }),
          new TableRow({ cantSplit: true, children: [cell("已完成", {width:1800}), cell("已关闭", {width:1800}), cell("主任/创建人", {width:1800}), cell("关闭任务", {width:1800}), cell("部门任务由主任关闭，班组任务由创建人关闭", {width:2160})] }),
        ]
      }),
      spacer(),
      para("任务卡片上会显示当前流程进度，例如："),
      bullet("待执行 · 张三 → 张三 开始执行"),
      bullet("执行中 · 张三 → 李四 审核"),
      bullet("待审核 · 李四 → 审核通过/驳回"),
      spacer(),

      // 3.4 分类设置
      new Paragraph({ children: [new PageBreak()] }),
      heading("3.4 分类设置", 2),
      para("点击右上角齿轮图标进入分类设置页面，可以自定义任务标签分类："),
      bullet("新增分类：输入名称 + 选择颜色（8种颜色可选），点击添加"),
      bullet("编辑分类：点击\"编辑\"按钮，修改名称或颜色"),
      bullet("删除分类：点击\"删除\"按钮，确认后删除（自动取消关联）"),
      bullet("每个分类显示关联的任务数量"),
      ...image(screenshots.settings, 450, 350, "图3：分类设置页面"),
      spacer(),

      // 3.5 统计报表
      heading("3.5 统计报表", 2),
      para("点击右上角图表图标进入统计报表页面，可查看："),
      bullet("任务概览：总数、进行中、待审核、已完成"),
      bullet("状态分布：饼图展示各状态任务占比"),
      bullet("负责人工作量：按人统计任务数量"),
      bullet("支持导出报表"),
      ...image(screenshots.statistics, 450, 300, "图4：统计报表页面"),
      spacer(),

      // 3.6 钉钉通知推送
      heading("3.6 钉钉通知推送", 2),
      para("系统会在关键节点自动给相关人发送钉钉消息推送："),
      table2col([
        ["创建任务时", "给负责人发送\"新任务派发\"通知，包含任务标题和截止日期"],
        ["提交审核时", "给审批人发送\"有任务待审核\"通知"],
        ["审核驳回时", "给负责人发送\"任务被驳回\"通知"],
        ["批量操作时", "相关人也会收到对应通知"],
      ]),
      para("通知通过钉钉工作通知 API 发送，直接在钉钉 APP 中弹出消息，无需关注公众号或加机器人。"),
      spacer(),

      // ===== 免费说明 =====
      new Paragraph({ children: [new PageBreak()] }),
      heading("四、免费说明", 1),
      para("本系统完全免费，无任何费用："),
      table2col([
        ["前端托管", "Cloudflare Pages 免费额度：每月 500 次构建，无限请求"],
        ["后端计算", "Cloudflare Workers 免费额度：每天 10 万次请求"],
        ["数据库", "Supabase 免费额度：500MB 存储，5万月活用户"],
        ["钉钉 API", "企业内部应用免费，无 API 调用费用"],
        ["域名", "使用 Cloudflare 提供的 .pages.dev 免费子域名"],
      ]),
      para("以上免费额度对于部门级任务管理绰绰有余。如果未来用户量增长超出免费额度，可升级为付费计划，费用也很低。"),
      spacer(),

      // ===== 使用方式 =====
      heading("五、使用方式", 1),
      para("1. 在钉钉工作台中找到\"任务管理\"应用"),
      para("2. 点击打开，自动登录（无需输入账号密码）"),
      para("3. 在任务列表查看分配给你的任务"),
      para("4. 点击右下角\"+\"创建新任务"),
      para("5. 点击任务卡片查看详情、执行流转"),
      para("6. 长按任务进行批量操作"),
      para("7. 点击齿轮图标管理分类标签"),
      para("8. 点击图表图标查看统计报表"),
      spacer(),

      // ===== 总结 =====
      heading("六、总结", 1),
      para("本系统是一套轻量、免费、实用的钉钉任务管理工具，具备完整的任务创建、分配、审批、通知和统计功能。无需额外安装，打开钉钉即用。适合企业部门内部的日常工作任务管理。"),
    ]
  }]
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync('/workspace/钉钉任务管理系统-功能介绍.docx', buffer);
  console.log('文档已生成: /workspace/钉钉任务管理系统-功能介绍.docx');
});
