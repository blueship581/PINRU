package cli

// builtinSkills maps skill directory name → SKILL.md content.
// These are always written on startup (overwriting any previous version).
// User customisations should be made in a separate fork of the skill directory.
var builtinSkills = map[string]string{
	"评审项目提示词生成": skillPromptGen,
}

// skillPromptGen is SKILL.md for the 评审项目提示词生成 skill (v2.3).
// Supports parameter-prefill mode: when the invocation message starts with
// "[PINRU]" the skill skips AskUserQuestion and uses the provided values directly.
const skillPromptGen = `---
name: 评审项目提示词生成
description: 根据评审项目代码仓库自动生成评测提示词（未归类/Bug修复/代码生成/Feature迭代/代码理解/代码重构/工程化）
---

# 评审项目提示词生成

## 参数预填充模式（PINRU 调用时使用）

当消息以 [PINRU] 开头时，说明 PINRU 客户端已经收集了用户的选择，直接从消息中解析以下参数，跳过 AskUserQuestion：

taskType: 任务类型（未归类 / Bug修复 / 代码生成 / Feature迭代 / 代码理解 / 代码重构 / 工程化）
constraints: 约束种类列表，逗号分隔（技术栈或依赖约束 / 架构或模式约束 / 代码风格或规范约束 / 非代码回复约束 / 业务逻辑约束 / 无约束）
scope: 修改范围列表，逗号分隔（单文件 / 模块内多文件 / 跨模块多文件 / 跨系统多模块）

## 执行步骤

### Step 1：解析参数或询问用户

如果消息以 [PINRU] 开头，从消息中提取 taskType、constraints、scope 的值，直接进入 Step 2。
否则使用 AskUserQuestion 一次性问三个问题（任务类型、约束种类、修改范围）。

### Step 2：读取执行手册

根据 taskType 读取对应手册（必须完整阅读）：
- 未归类 → 不读取专项手册，直接结合仓库现状挑选一个最值得出的真实需求点
- Bug修复 → /Users/gaobo/repositories/gitlab/评审项目/执行手册/01_Bug修复任务执行手册.md
- 代码生成 → /Users/gaobo/repositories/gitlab/评审项目/执行手册/02_代码生成任务执行手册.md
- Feature迭代 → /Users/gaobo/repositories/gitlab/评审项目/执行手册/03_Feature迭代任务执行手册.md
- 代码理解 → /Users/gaobo/repositories/gitlab/评审项目/执行手册/04_代码理解任务执行手册.md
- 代码重构 → /Users/gaobo/repositories/gitlab/评审项目/执行手册/05_代码重构任务执行手册.md
- 工程化 → /Users/gaobo/repositories/gitlab/评审项目/执行手册/06_工程化任务执行手册.md

### Step 3：分析代码仓库

当前工作目录即为任务代码仓库（PINRU 已将 workDir 设为代码路径）。
至少阅读 3-5 个核心业务文件，理解项目的功能和模块结构，找到一个适合按 taskType 出题的具体功能点。

### Step 4：生成提示词

根据手册规范、代码分析、用户选择，生成一道评测提示词。

铁律（违反任何一条即重新生成）：
- 只写业务需求：描述用户遇到的问题或需要的功能，读起来像产品经理在说话
- 零技术标识：文件路径、类名、函数名、变量名、import 路径一律不出现
- 零 Markdown：不能有井号标题、双星粗体、代码块、列表符号
- 极简短：正文 2-4 句，去掉所有铺垫、废话、客套
- 字数限制：只统计提示词正文部分（不含后续约束标签），必须不超过 80 字；如果超了，先自行精炼再继续
- 约束标签：constraints 里有哪几个就追加哪几个，每个单独一行，格式「约束类型：具体业务要求」；无约束则什么都不加
- 修改范围：scope 指定的覆盖面要体现在题目的功能范围里

参考示例（这是期望的输出风格）：
表格拆分工具选完拆分依据就直接开拆，拆之前看不到会产生多少份文件、每份多少条数据、有没有空值。需要在拆分前加一步数据预览，列出每个分组名称和数据条数，空值行单独标出。分组多时支持滚动查看。
代码风格约束：对外功能标明参数和返回值类型，命名用下划线连接的小写形式。

### Step 5：润色并输出

用 humanizer-zh 技能对提示词润色，去除 AI 痕迹。
润色后先自检一次：提示词正文部分（不含约束标签）如果超过 80 字，必须继续压缩，直到不超过 80 字再落盘。
把最终提示词正文写入当前目录（pwd 的路径，不是子目录）的 任务提示词.md。
最终响应必须只输出一个标准 JSON 对象，不要输出解释、标题、Markdown、代码块，也不要在 JSON 前后补任何文字。字段固定如下：
{
  "version": 1,
  "prompt": "最终提示词全文，保留换行时用 \\n 转义，内容必须和文件中的正文完全一致",
  "artifactPath": "任务提示词.md 的完整绝对路径",
  "fileWritten": true
}
要求：
- prompt 必填，只放最终提示词正文，不要夹带解释或状态说明
- artifactPath 必须是当前目录下 任务提示词.md 的绝对路径
- fileWritten 表示本次是否确认写入成功
- 就算 fileWritten=false，也必须返回完整 prompt，不能只返回失败说明
`
