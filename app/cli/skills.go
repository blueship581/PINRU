package cli

// builtinSkills maps skill directory name → SKILL.md content.
// These are always written on startup (overwriting any previous version).
// User customisations should be made in a separate fork of the skill directory.
var builtinSkills = map[string]string{
	"评审项目提示词生成": skillPromptGen,
}

// skillPromptGen is SKILL.md for the 评审项目提示词生成 skill (v3.0).
// v3.0 changes:
//   - Added output format anchoring at the top (输出铁律) for stronger constraint
//   - Step 3: changed from Agent sub-agents to direct Read for speed
//   - Step 5: stronger output prohibition with fallback rules
//   - Added ⛔ output prohibition section at the bottom
const skillPromptGen = `---
name: 评审项目提示词生成
description: 根据评审项目代码仓库自动生成评测提示词（未归类/Bug修复/代码生成/Feature迭代/代码理解/代码重构/工程化）
---

# 评审项目提示词生成

## ⚠️ 输出铁律（最高优先级，贯穿全流程）

你的最终响应有且只有一个裸 JSON 对象。之前、之后、之外不允许有任何文字。
所有分析、推理、自检在内部完成，绝不输出给用户。
如果你发现自己开始写分析文字，立刻停下，只输出 JSON。
禁止输出任何 Markdown 标题、表格、代码块、分析段落。

## 参数预填充模式（PINRU 调用时使用）

当消息中包含 [PINRU] 标记时，直接从消息中解析以下参数，跳过 AskUserQuestion：

taskType / constraints / scope / notes（可选）

否则使用 AskUserQuestion 一次性问三个问题。

## 执行步骤

### Step 1：解析参数

[PINRU] 模式直接解析，非 PINRU 模式用 AskUserQuestion。

### Step 2：读取执行手册

根据 taskType 读取对应手册（必须完整阅读）：
- 未归类 → 不读取，直接结合仓库现状挑选
- Bug修复 → {{MANUAL_DIR}}/01_Bug修复任务执行手册.md
- 代码生成 → {{MANUAL_DIR}}/02_代码生成任务执行手册.md
- Feature迭代 → {{MANUAL_DIR}}/03_Feature迭代任务执行手册.md
- 代码理解 → {{MANUAL_DIR}}/04_代码理解任务执行手册.md
- 代码重构 → {{MANUAL_DIR}}/05_代码重构任务执行手册.md
- 工程化 → {{MANUAL_DIR}}/06_工程化任务执行手册.md

### Step 3：快速扫描代码仓库

当前目录即为代码仓库。

1. 运行一次 find 获取目录结构：
find . -maxdepth 3 -not -path '*/.git/*' -not -path '*/node_modules/*' -not -path '*/__pycache__/*' | sort

2. 从目录结构判断最核心的 2 个业务文件，用 Read 工具顺序读取（不用 Agent 子代理）。

注意：Step 3 的所有分析结果仅供内部使用，不要在最终响应中输出任何分析内容。

### Step 4：生成提示词

根据手册规范、代码分析、用户选择和 notes，生成一道评测提示词。

铁律（违反即重新生成）：
- 只写业务需求，读起来像产品经理在说话
- 零技术标识：文件路径、类名、函数名、变量名一律不出现
- 零 Markdown：无标题、无粗体、无代码块、无列表符号
- 极简短：正文 2-4 句
- 字数限制：正文不超过 80 字（不含约束标签）
- 约束标签：按 constraints 追加，每个一行，格式「约束类型：具体业务要求」；无约束则不加
- 修改范围：scope 覆盖面体现在题目的功能范围里
- 去 AI 味：
  1. 禁用词：此外、同时、另外、彰显、培养、突出、展示、至关重要、格局、持久、不可或缺
  2. 禁用结构："需要 X""实现 X 功能""不仅……而且……""确保……""以便……"
  3. 禁用三段式列举
  4. 禁止过度限定："可能""或许""一定程度上"
  5. 句子节奏长短交错
  6. 读感测试：像真人抱怨问题就过，像说明书就重写

参考示例：
表格拆分工具选完拆分依据就直接开拆，拆之前看不到会产生多少份文件、每份多少条数据、有没有空值。需要在拆分前加一步数据预览，列出每个分组名称和数据条数，空值行单独标出。分组多时支持滚动查看。
代码风格约束：对外功能标明参数和返回值类型，命名用下划线连接的小写形式。

### Step 5：自检、写入、收口

**自检**（内部完成，不写进响应）：字数、技术标识、禁用词、读感。

**写入**：用 Write 工具把提示词正文写入当前目录的 任务提示词.md。

**收口**：你的最终响应只能是这个裸 JSON：
{"version":1,"prompt":"提示词全文","artifactPath":"任务提示词.md绝对路径","fileWritten":true}

## ⛔ 输出禁令（违反即判定失败，无例外）

你调用完所有工具后，发送给用户的最终文本响应必须且只能是上面那个 JSON 对象。

绝对禁止：
- Markdown 标题（# ## ###）、表格、代码块
- JSON 前的任何文字（"生成结果"、"提示词如下"、"现在我已经"、"让我"、"基于"）
- JSON 后的任何补充
- 任何分析性内容（Bug 根因、涉及范围、架构说明）
- 以"我"开头的任何句子

**兜底**：不确定是否该输出某段文字，就不要输出。宁可只有 JSON，不可多一个字。
`
