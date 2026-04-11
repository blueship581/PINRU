package prompt

import (
	"fmt"
	"strings"
	"unicode"

	"github.com/blueship581/pinru/internal/analysis"
)

// ── 任务类型 ──────────────────────────────────────────────────────────────────

const (
	TaskTypeUncategorized = "未归类"
	TaskTypeBugFix        = "Bug修复"
	TaskTypeCodeGen       = "代码生成"
	TaskTypeFeature       = "Feature迭代"
	TaskTypeUnderstand    = "代码理解"
	TaskTypeRefactor      = "代码重构"
	TaskTypeEngineering   = "工程化"
	TaskTypeTesting       = "代码测试"
)

var taskTypeAliases = map[string]string{
	"uncategorized": TaskTypeUncategorized,
	"unclassified":  TaskTypeUncategorized,
	"未分类":           TaskTypeUncategorized,
	"未归类":           TaskTypeUncategorized,
	"bugfix":        TaskTypeBugFix,
	"bug修复":         TaskTypeBugFix,
	"缺陷修复":          TaskTypeBugFix,
	"代码生成":          TaskTypeCodeGen,
	"feature":       TaskTypeFeature,
	"feature迭代":     TaskTypeFeature,
	"功能开发":          TaskTypeFeature,
	"代码理解":          TaskTypeUnderstand,
	"refactor":      TaskTypeRefactor,
	"代码重构":          TaskTypeRefactor,
	"perf":          "性能优化",
	"性能优化":          "性能优化",
	"工程化":           TaskTypeEngineering,
	"test":          TaskTypeTesting,
	"测试":            TaskTypeTesting,
	"测试补全":          TaskTypeTesting,
	"代码测试":          TaskTypeTesting,
}

// ── 约束标签类型 ───────────────────────────────────────────────────────────────

const (
	ConstraintStack    = "技术栈或依赖约束"
	ConstraintArch     = "架构或模式约束"
	ConstraintStyle    = "代码风格或规范约束"
	ConstraintNonCode  = "非代码回复约束"
	ConstraintBusiness = "业务逻辑约束"
	ConstraintNone     = "无约束"
)

// ── 修改范围 ──────────────────────────────────────────────────────────────────

const (
	ScopeSingleFile  = "单文件"
	ScopeModuleFiles = "模块内多文件"
	ScopeCrossModule = "跨模块多文件"
	ScopeCrossSystem = "跨系统多模块"
)

const MaxPromptBodyRunes = 80

// ── 任务类型到出题要点的精简指导 ──────────────────────────────────────────────

// taskGuidance 是从执行手册提炼的出题要点，供 LLM 理解每种任务类型的出题方向。
// 不直接暴露给最终生成的提示词，而是作为 LLM 的内部参考材料。
var taskGuidance = map[string]string{
	TaskTypeUncategorized: `出题方向：先不要预设任务类别，直接根据仓库里最真实、最典型、最容易被开发者提出来的问题或需求出题。
可以是 bug、功能补充、理解梳理、重构或测试补全中的任意一种，但题目表达仍然要自然，像用户真实提出的需求。
关键要求：
- 不要为了贴类别而硬套模板，优先选择仓库里最值得做的一件事
- 题目描述仍然必须具体，有清晰的业务现象或目标
- 如果仓库里存在明显问题，优先围绕真实痛点出题`,

	TaskTypeBugFix: `出题方向：找出代码中存在的逻辑错误、运行时异常、边界条件遗漏、类型错误或安全漏洞，
描述用户在使用系统时遇到的异常现象（报错信息、非预期输出、功能失效等），
让模型去定位并修复这个 bug。
关键要求：
- 描述"遇到了什么问题"，而非"要修改哪个文件"
- 可以提供报错信息的文字描述（不要粘贴堆栈，用业务语言描述现象）
- 必须基于仓库中真实存在的代码缺陷出题`,

	TaskTypeCodeGen: `出题方向：基于现有代码结构和业务背景，要求从零生成一个新的功能模块。
描述业务目标和功能需求，以"用户视角"的产品需求形式表达，
让模型去设计和实现完整可运行的代码。
关键要求：
- 需求描述要完整具体，包含功能点、预期行为
- 题目必须有足够的上下文，让模型能接上现有系统的约定
- 生成结果应能直接运行和验证`,

	TaskTypeFeature: `出题方向：在现有已实现的功能基础上，扩展或新增一个与业务相关的新特性。
描述"用户希望新增什么能力"，强调新功能与现有功能的协同关系，
让模型在不破坏原有逻辑的前提下平滑迭代。
关键要求：
- 明确说明是"在现有系统基础上"新增功能，不是从零构建
- 强调新旧功能的兼容性要求
- 功能扩展要自然合理，是现有功能的延伸`,

	TaskTypeUnderstand: `出题方向：要求解释、梳理或可视化某段代码/功能模块的运作机制。
以"不了解这套系统的新人"视角提问，描述"我想理解 XXX 是怎么运作的"，
让模型输出易于理解的解释、图表或文档。
关键要求：
- 问题聚焦在"弄清楚系统是怎么工作的"，而非修改代码
- 可要求输出架构图、流程图、数据流说明等（用约束标签指定格式）
- 描述要自然，像真实开发者提出的理解需求`,

	TaskTypeRefactor: `出题方向：找出代码中存在的代码异味（上帝函数、重复代码、紧耦合、难以维护等），
描述"这部分代码维护起来很痛苦"的用户感受，
让模型在不改变外部行为的前提下对内部结构进行重构优化。
关键要求：
- 重构目标要明确（性能、可读性、可维护性、解耦等）
- 必须强调"不改变外部行为" / "保持向后兼容"
- 基于真实存在代码异味的模块出题`,

	TaskTypeEngineering: `出题方向：围绕构建流程、自动化、测试配置、依赖管理、CI/CD 等工程化需求出题。
描述"团队在开发流程中遇到了什么效率问题"，
让模型提供工程化解决方案。
关键要求：
- 聚焦在开发流程和工具链层面，而非业务逻辑
- 描述工程化痛点，如"每次发布都要手动操作"、"测试配置混乱"等
- 要求可执行的方案，不是纯理论描述`,

	TaskTypeTesting: `出题方向：围绕单元测试、集成测试、回归测试或测试基建补齐出题。
描述"当前代码缺少有效验证，改动后容易回归"这一类真实问题，
让模型补充测试用例或改进测试覆盖。
关键要求：
- 重点是验证已有或新增行为，而不是重复实现业务逻辑
- 明确说明要覆盖的场景、边界条件或异常分支
- 测试需求必须与仓库中现有代码和测试框架兼容`,
}

// ── 约束标签的格式化表达映射 ──────────────────────────────────────────────────

// constraintDisplayName 将约束类型映射为提示词末尾的标签前缀，
// 使其看起来像"产品经理/质量工程师"发出的要求，而非技术规范。
var constraintDisplayName = map[string]string{
	ConstraintStack:    "技术栈约束",
	ConstraintArch:     "架构约束",
	ConstraintStyle:    "代码规范约束",
	ConstraintNonCode:  "非代码回复约束",
	ConstraintBusiness: "业务逻辑约束",
}

// ── 公共类型 ──────────────────────────────────────────────────────────────────

type TaskInfo struct {
	ID              string
	GitLabProjectID int64
	ProjectName     string
	Status          string
}

type PromptRequest struct {
	TaskType        string
	Scopes          []string
	Constraints     []string
	AdditionalNotes *string
}

// ── 系统提示词 ────────────────────────────────────────────────────────────────

// BuildSystemPrompt 返回严格要求业务语言输出的系统提示词。
func BuildSystemPrompt() string {
	return strings.Join([]string{
		"你是一名专业的代码模型评测出题员。你的任务是：基于给定的代码仓库分析，",
		"为代码模型生成一道「评测任务提示词」。",
		"",
		"输出必须严格遵守以下规则，每一条都不可违反：",
		"",
		"1. 只写业务需求，禁止写技术实现",
		"   - 不能出现：文件路径、类名、方法名、函数名、变量名、import 语句、package 名",
		"   - 不能出现：数据库表名、字段名、API 路径的具体字符串",
		"   - 可以出现：功能描述、业务场景、用户视角的操作描述",
		"",
		"2. 禁止 Markdown 格式",
		"   - 不能出现：井号标题、双星粗体、代码块、有序或无序列表符号",
		"   - 输出必须是纯文本段落，可用换行分隔不同约束标签",
		"",
		"3. 简短直接",
		"   - 正文描述控制在 2-4 句话内，清晰表达「用户遇到了什么问题」或「需要什么新功能」",
		"   - 正文部分总长度不得超过 80 个字（不含后续约束标签，空白字符不计入）",
		"   - 去掉所有铺垫语、客套语和废话",
		"",
		"4. 约束标签格式（若有）",
		"   - 每个约束标签另起一行，格式为：<标签名称>：<具体要求>",
		"   - 约束要求也必须用业务语言表达，不能出现技术标识符",
		"   - 若无约束，则结尾不加任何约束行",
		"",
		"5. 口语化、自然",
		"   - 读起来要像真实开发者或产品经理发出的任务描述",
		"   - 去除 AI 写作惯用的刻板措辞",
		"",
		"6. 输出前自检",
		"   - 如果正文部分超过 80 个字，先自行压缩语言，再输出最终版本",
		"",
		"直接输出提示词正文，不要加任何前言、解释或标注。",
	}, "\n")
}

// ── 用户提示词 ────────────────────────────────────────────────────────────────

// BuildUserPrompt 基于代码分析和任务参数构建发给 LLM 的用户提示词。
// 代码上下文仅作为出题参考，不能直接出现在最终提示词中。
func BuildUserPrompt(task TaskInfo, req PromptRequest, summary analysis.Summary, _ string) string {
	var sb strings.Builder

	// ── 1. 任务类型出题指导 ──
	normalizedTaskType := NormalizeTaskType(req.TaskType)
	guidance := taskGuidance[normalizedTaskType]
	if guidance == "" {
		guidance = "请根据代码仓库内容，生成一道符合业务场景的评测提示词。"
	}
	sb.WriteString("任务类型：")
	sb.WriteString(normalizedTaskType)
	sb.WriteString("\n\n")
	sb.WriteString("出题要点（仅供你理解方向，不要出现在输出中）：\n")
	sb.WriteString(guidance)
	sb.WriteString("\n\n")

	// ── 2. 修改范围要求 ──
	if len(req.Scopes) > 0 {
		sb.WriteString("修改范围：")
		sb.WriteString(strings.Join(req.Scopes, "、"))
		sb.WriteString("\n")
		sb.WriteString(buildScopeGuidance(req.Scopes))
		sb.WriteString("\n\n")
	}

	// ── 3. 约束标签要求 ──
	constraintLabels := buildConstraintLabels(req.Constraints)
	if len(constraintLabels) > 0 {
		sb.WriteString("本题需要添加的约束标签（")
		sb.WriteString(fmt.Sprintf("%d", len(constraintLabels)))
		sb.WriteString(" 个）：\n")
		for _, label := range constraintLabels {
			sb.WriteString("- ")
			sb.WriteString(label)
			sb.WriteString("\n")
		}
		sb.WriteString("请在提示词正文之后，逐行添加上述约束（格式：<标签名称>：<具体约束内容>）。\n")
		sb.WriteString("约束内容必须结合以下仓库信息生成，用业务语言表达，不写技术标识符。\n\n")
	} else {
		sb.WriteString("本题不添加任何约束标签（0 个标签）。\n\n")
	}

	// ── 4. 额外说明 ──
	if req.AdditionalNotes != nil && strings.TrimSpace(*req.AdditionalNotes) != "" {
		sb.WriteString("额外要求：")
		sb.WriteString(strings.TrimSpace(*req.AdditionalNotes))
		sb.WriteString("\n\n")
	}

	// ── 5. 仓库上下文（仅供出题参考，禁止直接引用到输出中）──
	sb.WriteString("=== 仓库参考信息（仅用于理解业务背景，禁止出现在输出中）===\n")
	sb.WriteString("项目名称：")
	sb.WriteString(task.ProjectName)
	sb.WriteString("\n")
	sb.WriteString("技术栈：")
	sb.WriteString(strings.Join(summary.DetectedStack, "、"))
	sb.WriteString("\n")
	sb.WriteString("文件数：")
	sb.WriteString(fmt.Sprintf("%d", summary.TotalFiles))
	sb.WriteString("\n")

	if len(summary.FileTree) > 0 {
		sb.WriteString("\n目录结构（节选）：\n")
		// 只取前 30 行文件树，避免 token 浪费
		lines := summary.FileTree
		if len(lines) > 30 {
			lines = lines[:30]
		}
		sb.WriteString(strings.Join(lines, "\n"))
		sb.WriteString("\n")
	}

	// 代码片段：只用于让 LLM 理解业务逻辑，但明确禁止泄露技术细节到输出
	if len(summary.KeyFiles) > 0 {
		sb.WriteString("\n核心文件内容（仅供理解业务逻辑，绝对不能将文件路径/类名/函数名写进提示词）：\n")
		// 最多展示 3 个文件片段，减少技术细节泄露风险
		count := len(summary.KeyFiles)
		if count > 3 {
			count = 3
		}
		for i := 0; i < count; i++ {
			f := summary.KeyFiles[i]
			sb.WriteString("[文件 ")
			sb.WriteString(fmt.Sprintf("%d", i+1))
			sb.WriteString("]\n")
			sb.WriteString(f.Snippet)
			sb.WriteString("\n")
		}
	}

	sb.WriteString("=== 参考信息结束 ===\n\n")

	// ── 6. 最终输出要求 ──
	sb.WriteString("现在请生成一道符合上述要求的评测提示词。")
	if len(constraintLabels) > 0 {
		sb.WriteString("正文后面追加约束标签，每个标签一行。")
	}
	sb.WriteString(fmt.Sprintf("输出前请自检：正文部分（不含约束标签）必须不超过 %d 个字。", MaxPromptBodyRunes))
	sb.WriteString("直接输出提示词内容，不加任何前言或说明。")

	return sb.String()
}

// ── 辅助函数 ──────────────────────────────────────────────────────────────────

func NormalizeTaskType(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}

	key := strings.ToLower(strings.ReplaceAll(trimmed, " ", ""))
	if normalized, ok := taskTypeAliases[key]; ok {
		return normalized
	}

	return trimmed
}

// buildConstraintLabels 将约束类型列表转换为需要添加的标签前缀列表。
// "无约束" 类型直接过滤，其余类型返回显示名称。
func buildConstraintLabels(constraints []string) []string {
	var labels []string
	for _, c := range constraints {
		if c == ConstraintNone || strings.Contains(c, "无约束") {
			continue
		}
		if name, ok := constraintDisplayName[c]; ok {
			labels = append(labels, name)
		} else {
			// 未知约束类型，直接使用原始值
			labels = append(labels, c)
		}
	}
	return labels
}

// buildScopeGuidance 根据选中的修改范围生成出题提示。
func buildScopeGuidance(scopes []string) string {
	var hints []string
	for _, s := range scopes {
		switch s {
		case ScopeSingleFile:
			hints = append(hints, "题目涉及的改动仅限于单一功能点或单一页面（单文件级别）")
		case ScopeModuleFiles:
			hints = append(hints, "题目的改动涉及同一功能模块内的多个协作部分（模块内多文件）")
		case ScopeCrossModule:
			hints = append(hints, "题目的改动需要跨越多个不同功能模块（跨模块多文件）")
		case ScopeCrossSystem:
			hints = append(hints, "题目的改动需要涉及前后端联动、多个子系统或数据存储与业务逻辑的联动（跨系统多模块）")
		}
	}
	if len(hints) == 0 {
		return ""
	}
	return "范围说明：" + strings.Join(hints, "；")
}

func SplitPromptSections(promptText string) (string, []string) {
	lines := strings.Split(strings.ReplaceAll(strings.TrimSpace(promptText), "\r\n", "\n"), "\n")
	bodyLines := make([]string, 0, len(lines))
	constraintLines := make([]string, 0, len(lines))
	inConstraintSection := false

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}

		if isConstraintLine(trimmed) {
			inConstraintSection = true
			constraintLines = append(constraintLines, trimmed)
			continue
		}

		if inConstraintSection {
			constraintLines = append(constraintLines, trimmed)
			continue
		}

		bodyLines = append(bodyLines, trimmed)
	}

	return strings.Join(bodyLines, "\n"), constraintLines
}

func PromptBodyRuneCount(promptText string) int {
	body, _ := SplitPromptSections(promptText)

	count := 0
	for _, r := range body {
		if unicode.IsSpace(r) {
			continue
		}
		count++
	}
	return count
}

func PromptBodyExceedsLimit(promptText string) bool {
	return PromptBodyRuneCount(promptText) > MaxPromptBodyRunes
}

func BuildShortenSystemPrompt(limit int) string {
	return strings.Join([]string{
		"你是一名中文产品需求文案编辑。",
		fmt.Sprintf("请把给定提示词的正文压缩到 %d 个字以内。", limit),
		"不要改变业务含义，不要引入技术实现，不要增加约束标签。",
		"只输出精炼后的正文，不要输出解释、前言、标题、Markdown 或约束行。",
	}, "\n")
}

func BuildShortenUserPrompt(body string, limit int) string {
	var sb strings.Builder
	sb.WriteString("请在不改变原意的前提下，把下面这段提示词正文压缩得更短、更自然。\n")
	sb.WriteString(fmt.Sprintf("要求：最终正文不超过 %d 个字，保留业务场景、问题现象和目标结果。\n", limit))
	sb.WriteString("正文如下：\n")
	sb.WriteString(strings.TrimSpace(body))
	return sb.String()
}

func isConstraintLine(line string) bool {
	for _, prefix := range []string{
		"技术栈约束：",
		"技术栈约束:",
		"架构约束：",
		"架构约束:",
		"代码规范约束：",
		"代码规范约束:",
		"非代码回复约束：",
		"非代码回复约束:",
		"业务逻辑约束：",
		"业务逻辑约束:",
	} {
		if strings.HasPrefix(line, prefix) {
			return true
		}
	}
	return false
}
