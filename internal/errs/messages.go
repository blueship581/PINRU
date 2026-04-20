// Package errs 统一管理 PINRU 项目面向用户的错误文案。
//
// 使用约定：
//  1. 所有会抵达用户界面的错误文案，一律以本包中的常量/格式化串为准，不再内联字符串。
//  2. 未导出内容（技术调试信息，如 SQL、包内实现细节）保留原样即可，
//     但不要使用英文或纯代码式短语（例如 "task not found"），这类文案一旦
//     通过 %w 链向上传递就会直接暴露给用户。
//  3. 普通无参数文案使用 Msg* 常量；需要参数的文案使用 Fmt* 常量配合
//     fmt.Errorf 使用，例如：
//         return fmt.Errorf(errs.FmtTaskNotFound, id)
//  4. 本文件中的文案必须是中文，不得带未转义换行符或句末句号；
//     参数占位符放在冒号后或用括号包裹，便于拼接。
package errs

// ---------- 通用字段校验 ----------

const (
	MsgTaskIDRequired        = "任务 ID 不能为空"
	MsgTaskRequired          = "任务不能为空"
	MsgTaskTypeRequired      = "任务类型不能为空"
	MsgModelNameRequired     = "模型名称不能为空"
	MsgModelNameAndTaskIDReq = "任务 ID 和模型名称不能为空"
	MsgTitleRequired         = "标题不能为空"
	MsgMessageContentEmpty   = "消息内容不能为空"
	MsgWorkDirRequired       = "工作目录不能为空，请先完成领题 Clone"
	MsgLocalPathRequired     = "本地路径不能为空"
	MsgPromptRequired        = "提示词不能为空"
	MsgPromptContentRequired = "提示词内容不能为空"
	MsgTargetDirRequired     = "目标目录不能为空"
	MsgDirRequired           = "目录不能为空"
	MsgRootDirRequired       = "根目录不能为空"
	MsgSourceDirRequired     = "源码文件夹不能为空"
	MsgSourceRepoRequired    = "源码仓库不能为空"
	MsgProjectRequired       = "项目不能为空"
	MsgProjectConfigIDReq    = "项目配置 ID 不能为空"
	MsgSetCountInvalid       = "套数必须大于 0"
	MsgSourceRepoFormat      = "源码仓库格式应为 owner/repo"
	MsgPolishTextRequired    = "润色文本不能为空"
	MsgProviderTypeRequired  = "提供商类型不能为空"
	MsgReviewRoundIDRequired = "轮次 ID 不能为空"
)

// ---------- 任务 / 题卡 ----------

const (
	FmtTaskNotFound        = "任务不存在：%s"
	FmtCardNotFound        = "题卡 %q 不存在"
	FmtQuestionBankItemNotFound = "题库条目不存在：%d"
	FmtTaskTypeQuotaUsedUp = "任务类型 %q 的配额已用尽"
	FmtTaskTypeNoQuota     = "任务类型 %q 未配置配额"
	FmtProjectTaskExists   = "当前项目下题卡已存在：%s"
	FmtGitLabQuotaReached  = "GitLab 项目 %d 的 %s 领题数已达上限 %d，无法继续领取"
	FmtSessionTypeRequired = "第 %d 个 session 的任务类型不能为空"
	FmtSessionDoneRequired = "第 %d 个 session 的是否完成不能为空"
	FmtSessionLikedReq     = "第 %d 个 session 的是否满意不能为空"
	FmtModelDuplicate      = "模型 %q 重复"
	FmtModelExists         = "模型 %q 已存在"
	FmtUnsupportedField    = "不支持的字段：%s"
	FmtRefuseDeleteOutside = "拒绝删除受管范围外的任务目录：%s"

	MsgTaskNoLocalDir       = "当前题目还没有可打开的本地目录"
	MsgTaskNoReviewSubdir   = "当前题目还没有可供复审的子文件夹"
	MsgTaskMissingWorkDir   = "当前任务没有本地代码目录，请先完成领题 Clone"
	MsgQuestionBankRefreshOnlyGitLab = "只有 GitLab 题库条目支持刷新源码"
)

// ---------- 会话 / 消息 ----------

const (
	FmtSessionNotFound   = "会话不存在：%s"
	FmtMessageNotFound   = "消息不存在：%w"
	MsgMessageEmptyForPrompt = "消息内容为空，无法保存为提示词"
	MsgPromptGenerating  = "当前任务正在后台生成提示词，请稍后再试"
)

// ---------- 提示词 ----------

const (
	MsgModelOutputEmpty       = "模型输出为空"
	MsgPromptNotDetected      = "模型输出中没有识别到可用的提示词正文"
	MsgPolishContentNotFound  = "模型输出中没有识别到可用的润色正文"
	MsgPromptJSONEmpty        = "JSON 中 prompt 为空"
	MsgClaudeCodeAcpBusy      = "Claude Code ACP 账号池暂时耗尽（503），请稍后重试或检查 ACP 配置"
	MsgClaudeCodeAcpMissing   = "未找到所选的提示词提供商，请重新选择 Claude Code (ACP)"
	MsgClaudeCodeAcpNotConfigured = "未找到可用的 Claude Code (ACP) 提供商，请先在设置中配置一个"
	MsgClaudeCodeAcpOnly      = "生成提示词当前仅支持 Claude Code (ACP) 提供商，请在设置中改为 Claude Code (ACP)"
	MsgHumanizerEmpty         = "润色失败：/humanizer-zh 未返回有效内容"

	FmtPromptFileMissing = "生成完成，但未找到提示词文件：%s"
	FmtPromptFileNoWrite = "生成完成，但未检测到新的提示词文件写入：%s"
	FmtPromptFileEmpty   = "提示词文件内容为空：%s"
	FmtPromptRetryFailed = "提示词生成失败，已重试 %d 次。请检查 Claude Code 配置后重试。最后一次错误：%v"
	FmtPromptExtractBoth = "%s；同时无法从模型输出提取提示词：%v"
	FmtPromptStatusBack  = "%s；提示词状态回写失败：%v"
	FmtPromptReadInfo    = "读取提示词文件信息失败：%w"
	FmtPromptReadFile    = "读取提示词文件失败：%w"
	FmtPromptSaveTask    = "保存提示词到任务失败：%w"
	FmtPromptWriteFile   = "写入提示词文件失败：%w"
	FmtPromptExtractFail = "无法从 Agent 输出中提取提示词：%w"
	FmtPolishExtractFail = "无法从 /humanizer-zh 输出中提取正文：%w"
	FmtPolishFailed      = "润色失败：%w"
	FmtClaudeStartFail   = "启动 Claude Code 失败：%w"
	FmtCliPollFail       = "轮询 CLI 输出失败：%w"
	FmtClaudeRunErr      = "Claude Code 执行出错：%s"
)

// ---------- 后台任务 / Job ----------

const (
	MsgJobAiReviewParseFail    = "解析 ai_review 参数失败"
	MsgJobRetryOnlyFailed      = "只能重试失败的任务"
	MsgJobDeleteOnlyReview     = "只能删除 AI 复审记录"
	MsgJobReviewStillRunning   = "复审任务仍在进行中，请先取消后再删除"
	MsgJobSessionSyncNoTask    = "同步会话任务缺少题卡 ID"
	MsgJobSessionSyncNoService = "会话同步服务未初始化"
	MsgJobCliUninitialized     = "CLI 服务未初始化"
	MsgJobAiReviewNoRound      = "AI 复审任务缺少轮次 ID"
	MsgJobAiReviewNoTask       = "AI 复审任务缺少题卡 ID"
	MsgJobAiReviewNoLocalPath  = "AI 复审任务缺少本地路径"
	MsgGitCloneFailed          = "git clone 失败"
	MsgJobMissingCloneTarget   = "缺少拉取目标目录"

	FmtJobSerializeAiReview    = "序列化 ai_review 参数失败：%w"
	FmtJobCreateFail           = "创建后台任务失败：%w"
	FmtJobQueryFail            = "查询后台任务失败：%w"
	FmtJobMaxRetryReached      = "已达最大重试次数（%d）"
	FmtJobUnknownType          = "未知的任务类型：%s"
	FmtJobParsePromptGenParam  = "解析提示词生成参数失败：%w"
	FmtJobParseGitCloneParam   = "解析 git_clone 参数失败：%w"
	FmtJobParsePrSubmitParam   = "解析 pr_submit 参数失败：%w"
	FmtJobCleanRetryDirFail    = "清理重试目录失败：%w"
	FmtJobCleanFailedDirFail   = "失败后清理目录失败：%w"
	FmtJobCleanAbortResidualFail = "清理中断残留目录失败：%w"
	FmtJobGitCloneRetriesFailed = "git clone 连续失败 %d 次：%w"
	FmtJobGitCloneIdleTimeout  = "git clone 超过 %s 无进度输出，已中止"
	FmtJobReadReviewRound      = "读取复审轮次失败：%w"
	FmtJobReviewRoundNotFound  = "未找到复审轮次：%s"
	FmtJobUpdateReviewRoundFail = "更新复审轮次状态失败：%w"
	FmtJobSaveReviewResultFail  = "保存复审轮次结果失败：%w"
	FmtJobNextRoundFail        = "获取下一轮次编号失败：%w"
	FmtJobReadPrevReviewFail   = "读取上一轮复审失败：%w"
	FmtJobCreateReviewRoundFail = "创建复审轮次失败：%w"
	FmtJobDirConflict          = "目录冲突：以下目录已存在：%s"
	FmtJobRefuseUnsafeClean    = "拒绝清理不安全目录：%s"
	FmtJobSourceUploadFail     = "源码上传失败：%s"
)

// ---------- Git / Clone / 工作目录 ----------

const (
	MsgOpenLocalDirFail  = "打开本地目录失败"
	MsgGitOpFailed       = "Git 操作失败"
	MsgGitPushFailed     = "Git 推送失败"
	MsgDefaultBranchFail = "设置默认分支失败"

	FmtLocalDirNotExist      = "本地目录不存在：%s"
	FmtDirLabelNotExist      = "%s不存在：%s"
	FmtNormalizeNotFound     = "未找到可归一的%s"
	FmtNormalizeTargetExists = "目标目录已存在，无法归一：%s"
	FmtSourceBaseFail        = "源码目录补 Git 基线失败：%w"
	FmtModelBaseFail         = "模型 %s 补 Git 基线失败：%w"
	FmtReadTaskPromptFail    = "读取任务提示词失败：%w"
	FmtSyncTaskPromptFail    = "同步任务提示词失败：%w"
	FmtTaskTypeNormFail      = "任务类型已更新，但本地目录归一失败：%w"
	FmtTaskDirNotExist       = "任务目录不存在：%s"
	FmtTaskDirNotFolder      = "任务目录不是文件夹：%s"
	FmtReadTaskDirInfoFail   = "读取任务目录信息失败：%w"
	FmtTargetDirExists       = "目标目录「%s」已存在"
	FmtSourceDirNotExist     = "源目录不存在：%s"
	FmtTargetPathNotDir      = "目标路径不是目录：%s"
	FmtGitStartFail          = "无法启动 git 命令：%w"
	FmtGitCloneFailCause     = "git clone 失败：%w"
	FmtMoveCloneDirFail      = "无法移动克隆目录到目标路径：%w"
	FmtCopyDirMoveFail       = "无法移动复制目录到目标路径：%w"
	FmtRemoteURLFail         = "获取 remote URL 失败：%w"
	FmtRefuseCleanOutside    = "拒绝清理受管范围外的工作目录：%s"
	FmtRefuseDeleteOutsideDir = "拒绝删除受管范围外的工作目录：%s"
	FmtQuestionBankSyncFail   = "同步题库源码失败：%w"
)

// ---------- GitHub ----------

const (
	MsgGitHubUsernameRequired = "GitHub 用户名不能为空"
	MsgGitHubTokenRequired    = "GitHub 访问令牌不能为空"
	MsgGitHubAuthFail         = "GitHub 认证失败，请检查访问令牌"
	MsgGitHubForbidden        = "GitHub 拒绝了本次操作，请确认令牌权限"
	MsgGitHubNotFound         = "GitHub 未找到目标资源"
	MsgGitHubPRCreateFail     = "GitHub 无法创建 PR，请检查分支是否有实际改动"
	MsgGitHubAccountInfoIncomplete = "GitHub 账号信息不完整"
	MsgSourceNotUploaded      = "源码尚未上传，请先执行源码上传步骤后再创建模型 PR"
	MsgSourceDirNoCommit      = "源码目录没有可提交的文件"
	MsgSourceMissingLocalRepo = "源码文件夹缺少本地仓库路径，无法上传源码"
	MsgModelMissingLocalDir   = "模型副本缺少本地目录，无法创建 PR"

	FmtSourceModelMissing   = "未找到源码记录 %s，请先在领题页下载项目"
	FmtSourceModelNoPath    = "源码记录 %s 缺少本地路径，无法推送源码"
	FmtGitHubAPIFailStatus  = "GitHub API 请求失败：HTTP %d"
	FmtGitHubAuthWrap       = "GitHub 认证失败：%w"
	FmtEnsureGitHubRepoFail = "确保 GitHub 仓库可用失败：%w"
	FmtModelNoDiff          = "模型 %s 与源码 main 无差异，无法创建 PR"
	FmtPRCreateFail         = "PR 创建失败：%w"
	FmtGitHubPRCreateWrap   = "GitHub PR 创建失败：%w"
	FmtPRCreatedButStateFail = "PR 已创建，但模型状态写回失败：%w"
	FmtModelStateBackFail    = "模型状态写回失败：%w"
	FmtTaskStateBackFail     = "任务状态写回失败：%w"
	FmtSourceStateBackFail   = "源码记录状态写回失败：%w"
	FmtReadModelRunFail      = "读取模型记录失败 %s：%w"
	FmtGitHubAccountNotFound = "未找到 GitHub 账号：%s"
	FmtModelStateBackInline  = "%w；模型状态写回失败：%v"
	FmtTaskStateBackInline   = "%w；任务状态写回失败：%v"
	FmtModelRunNotFound      = "未找到模型记录：%s / %s"

	MsgNoDiffToMain          = "与 main 无差异，无法创建 PR"
)

// ---------- GitLab ----------

const (
	MsgGitLabTokenRequired  = "GitLab 访问令牌不能为空"
	MsgGitLabURLRequired    = "GitLab 服务器地址不能为空"
	MsgGitLabURLFormat      = "GitLab 服务器地址格式错误，请填写完整地址，例如 https://gitlab.example.com"
	MsgGitLabURLScheme      = "GitLab 服务器地址必须以 http:// 或 https:// 开头"
	MsgGitLabSettingsMissing = "请先在设置页面配置 GitLab URL 和 Token"
	MsgQuestionBankProjectIDsInvalid = "GitLab 题库 ID 列表只能包含正整数项目 ID"

	FmtGitLabAPIStatus  = "GitLab API %d：%s"
	FmtGitLabDownloadFail = "下载失败 %d：%s"
	FmtGitLabTargetExist = "目标目录已存在：%s"
	FmtQuestionBankProjectIDInvalid = "无效的 GitLab 题库项目 ID：%s"
	FmtQuestionBankProjectIDNotFound = "GitLab 题库项目不存在或不可访问：%s"
)

// ---------- CLI（Claude / Codex） ----------

const (
	MsgClaudeCliMissing       = "Claude CLI 未找到，请先安装 Claude Code：npm install -g @anthropic-ai/claude-code"
	MsgClaudeCodeCliNotInstalled = "Claude Code CLI 未安装，请执行：npm install -g @anthropic-ai/claude-code"
	MsgClaudeCodeAcpTimeout   = "Claude Code ACP 连接超时（60s），请检查网络或 ACP 配置"
	MsgClaudeCodeAcpBusyShort = "ACP 账号池暂时耗尽（503），请稍后重试"
	MsgClaudeCodeAcpUnsupport = "ACP 代理不支持当前模型，请检查 ACP 配置"
	MsgClaudeCodeCliNoContent = "Claude Code CLI 未返回可用内容"
	MsgCodexCliNotInstalled   = "Codex CLI 未安装，请先安装后重试"
	MsgCodexCliMissing        = "Codex CLI 未找到，请先安装：npm install -g @openai/codex"
	MsgCodexCliNoContent      = "Codex CLI 未返回可用内容"
	MsgCodexNoStructuredOutput = "Codex 未生成结构化输出"
	MsgClaudeCodeCliNotInstalledInstallGuide = "请先安装 Claude Code CLI：npm install -g @anthropic-ai/claude-code"

	FmtStdoutPipeFail       = "无法创建输出管道：%v"
	FmtStderrPipeFail       = "无法创建错误管道：%v"
	FmtClaudeStartClassicFail = "启动 claude 失败：%v"
	FmtUserDirFail          = "无法获取用户目录：%v"
	FmtUserDirShort         = "无法获取用户目录"
	FmtReadSkillDirFail     = "读取技能目录失败：%v"
	FmtUnsupportedPermission = "不支持的权限模式：%s"
	FmtSchemaTempFileFail   = "创建 schema 临时文件失败：%w"
	FmtWriteSchemaFail      = "写入 schema 失败：%w"
	FmtOutputTempFileFail   = "创建输出临时文件失败：%w"
	FmtStdoutPipeWrap       = "创建 stdout 管道失败：%w"
	FmtStderrPipeWrap       = "创建 stderr 管道失败：%w"
	FmtCodexStartFail       = "启动 codex 失败：%w"
	FmtCodexRunFailWithSummary = "codex 执行失败：%w：%s"
	FmtCodexRunFail         = "codex 执行失败：%w"
	FmtCodexReadOutputFail  = "读取 codex 输出失败：%w"
	FmtCodexParseJSONFail   = "解析 codex 输出 JSON 失败：%w"
	FmtClaudeCodeAcpFail    = "Claude Code ACP 调用失败：%s"
	FmtClaudeCodeAcpFailErr = "Claude Code ACP 调用失败：%v"
	FmtClaudeCodeCliFailStderr = "Claude Code CLI 调用失败：%s"
	FmtClaudeCodeCliFailErr = "Claude Code CLI 调用失败：%w"
	FmtCodexCliFailStderr   = "Codex CLI 调用失败：%s"
	FmtCodexCliFailErr      = "Codex CLI 调用失败：%w"
	FmtCodexCliUnavailable  = "Codex CLI 未安装或不可用：%v"
	FmtCodexCliUnavailableOut = "Codex CLI 未安装或不可用：%s"
	FmtDetectedCyclicTrae   = "检测到 Trae 工作区循环引用：%s"
)

// ---------- LLM ----------

const (
	MsgAPIKeyRequired        = "API Key 不能为空"
	MsgOpenAINoTextContent   = "OpenAI 兼容模型未返回可用的文本内容"
	MsgAnthropicNoTextContent = "Anthropic 模型未返回可用的文本内容"

	FmtUnknownProviderType   = "未知的提供商类型：%s"
	FmtLLMRequestFail        = "模型请求失败（%d）：%s"
	FmtLLMParseResponseFail  = "解析模型响应失败：%w"
)

// ---------- 提交 / PR ----------

const (
	// 参见 GitHub 分组已复用的大部分文案
)

// ---------- Store 持久化层 ----------
//
// 这些文案原本为英文，透传到上层后会直接出现在用户界面；
// 统一改为中文后，即便被 %w 串到顶层也可安全呈现。
const (
	FmtStoreTaskNotFound    = "任务不存在：%s"
	FmtStoreProjectNotFound = "项目不存在：%s"
	FmtStoreModelRunNotFoundByID   = "模型记录 %q 不存在"
	FmtStoreModelRunNotFoundByPair = "模型记录 %q/%q 不存在"
	FmtStoreModelRunNotFound = "模型记录不存在：%s"
	FmtStoreInvalidTaskTypeJSON  = "任务类型配置数据损坏：%w"
	FmtStoreInvalidSessionListJSON = "session_list 数据损坏：%w"
	FmtStoreInvalidTaskTypeCountJSON = "任务类型计数数据损坏：%w"
	FmtStoreInvalidQuestionBankIDsJSON = "题库项目 ID 配置损坏：%w"
	FmtStoreBackfillQuotas    = "回填项目 %s 配额失败：%w"
	FmtStoreBackfillUsage     = "回填项目 %s 用量失败：%w"
	FmtStoreBackfillTotals    = "回填项目 %s 合计失败：%w"
	FmtStoreMigrationMismatch = "数据库迁移校验不一致：%s"
	FmtStoreMigrationExec     = "数据库迁移执行失败：%w\n迁移：%s\nSQL：%s"
	FmtStoreRecordMigration   = "记录数据库迁移 %s 失败：%w"
	FmtStoreEnsureMetaSchema  = "初始化元数据表失败：%w"
	FmtStoreDisableFKLegacy   = "准备修复历史任务表失败：%w"
	FmtStoreCreateLegacyRepair = "创建历史任务修复表失败：%w"
	FmtStoreCopyLegacyTasks   = "复制历史任务到修复表失败：%w"
	FmtStoreDropLegacyTasks   = "删除历史任务表失败：%w"
	FmtStoreRenameRepaired    = "重命名修复后任务表失败：%w"
	FmtStoreCheckTable        = "检查数据表 %s 失败：%w"
	FmtStoreEnsureIndex       = "创建索引失败：%w\nSQL：%s"
	FmtStoreNormalizeRuns     = "规范化重复模型记录失败：%w"
	FmtStoreEnsureColumn      = "初始化字段 %s.%s 失败：%w"
	FmtStoreLookupMigration   = "查询迁移 %s 失败：%w"
	FmtStoreCheckIndex        = "检查索引 %s 失败：%w"
	FmtStoreRecordRepair      = "记录数据修复 %s 失败：%w"
	FmtStoreLegacyMigrate     = "迁移历史数据（项目 %s）失败：%w"
	FmtStoreLegacyMigrateGH   = "迁移历史 GitHub 账号 %s 失败：%w"
	FmtStoreLegacyMigrateLLM  = "迁移历史 LLM 提供商 %s 失败：%w"
	FmtStoreScanBgJob         = "读取后台任务失败：%w"
	FmtStoreScanBgJobRow      = "读取后台任务行失败：%w"
	FmtStoreBgJobNotFound     = "后台任务 %q 不存在"
	FmtStoreChatSessionNotFound = "会话 %q 不存在"
	FmtStoreChatMessageNotFound = "消息 %q 不存在"
	FmtStoreReviewRoundNotFound = "复审轮次 %q 不存在"
	FmtStoreReviewNodeNotFound  = "复审节点 %q 不存在"
	MsgStorePromptTextRequired = "提示词内容不能为空"
	MsgStoreTaskTypeRequired   = "任务类型不能为空"
)

// ---------- 分析 / 代码目录 ----------

const (
	MsgNoAnalyzableCodeDir = "未找到可分析的代码目录"
)
