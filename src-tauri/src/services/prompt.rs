use crate::db::models::{CodeAnalysisSummary, GeneratePromptRequest, Task};
use crate::services::llm::{LlmProvider, LlmServiceError};

#[derive(Debug, thiserror::Error)]
pub enum PromptServiceError {
    #[error("{0}")]
    Provider(String),
    #[error("{0}")]
    EmptyResponse(String),
}

impl From<LlmServiceError> for PromptServiceError {
    fn from(value: LlmServiceError) -> Self {
        PromptServiceError::Provider(value.to_string())
    }
}

pub async fn generate_prompt(
    provider: &dyn LlmProvider,
    task: &Task,
    request: &GeneratePromptRequest,
    analysis: &CodeAnalysisSummary,
) -> Result<String, PromptServiceError> {
    let system_prompt = build_system_prompt();
    let user_prompt = build_user_prompt(task, request, analysis, provider.config().name.as_str());
    let result = provider.generate(system_prompt, &user_prompt).await?;
    let trimmed = result.trim();

    if trimmed.is_empty() {
        return Err(PromptServiceError::EmptyResponse(
            "模型没有返回可用的提示词内容".to_string(),
        ));
    }

    Ok(trimmed.to_string())
}

fn build_system_prompt() -> &'static str {
    "你是 PinRu 的提示词工坊，负责为另一个代码模型生成一份“可直接执行”的中文开发提示词。\n\
输出必须是最终交给代码模型的内容，不要解释你如何分析，也不要写前言客套话。\n\
提示词必须满足以下要求：\n\
1. 紧扣当前仓库和任务类型，不能泛泛而谈。\n\
2. 明确目标、改动范围、关键约束、实施步骤和验收标准。\n\
3. 如果信息不足，要显式写出合理假设，并要求模型先验证假设再动手。\n\
4. 输出使用 Markdown，结构清晰，方便复制后直接使用。\n\
5. 语言保持专业、具体、可执行，避免口号式描述。"
}

fn build_user_prompt(
    task: &Task,
    request: &GeneratePromptRequest,
    analysis: &CodeAnalysisSummary,
    provider_name: &str,
) -> String {
    let constraints = if request.constraints.is_empty() {
        "无额外约束".to_string()
    } else {
        request.constraints.join("、")
    };

    let scopes = if request.scopes.is_empty() {
        "未指定".to_string()
    } else {
        request.scopes.join("、")
    };

    let notes = request
        .additional_notes
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("无");

    let key_file_section = if analysis.key_files.is_empty() {
        "暂无关键文件摘录".to_string()
    } else {
        analysis
            .key_files
            .iter()
            .map(|file| {
                format!(
                    "### {}\n```text\n{}\n```",
                    file.path,
                    file.snippet
                )
            })
            .collect::<Vec<_>>()
            .join("\n\n")
    };

    format!(
        "请基于下面的仓库上下文，为代码模型生成一份执行提示词。\n\n\
## 任务信息\n\
- 任务 ID：{task_id}\n\
- GitLab 项目 ID：{project_id}\n\
- 项目名称：{project_name}\n\
- 当前任务状态：{status}\n\
- 任务类型：{task_type}\n\
- 作用范围：{scopes}\n\
- 约束条件：{constraints}\n\
- 额外说明：{notes}\n\
- 当前选用的提示词工坊模型：{provider_name}\n\n\
## 仓库分析\n\
- 代码目录：{repo_path}\n\
- 检测到的技术栈：{stack}\n\
- 扫描文件数：{total_files}\n\n\
### 文件树（节选）\n\
{file_tree}\n\n\
## 关键文件摘录\n\
{key_files}\n\n\
## 输出要求\n\
请直接输出最终提示词正文，并至少包含以下结构：\n\
1. 任务目标\n\
2. 代码上下文与关键文件\n\
3. 实施要求\n\
4. 约束与注意事项\n\
5. 建议执行步骤\n\
6. 完成前自检清单\n\
\n\
不要补充“以下是提示词”之类的引导语。",
        task_id = task.id,
        project_id = task.gitlab_project_id,
        project_name = task.project_name,
        status = task.status,
        task_type = request.task_type,
        scopes = scopes,
        constraints = constraints,
        notes = notes,
        provider_name = provider_name,
        repo_path = analysis.repo_path,
        stack = analysis.detected_stack.join("、"),
        total_files = analysis.total_files,
        file_tree = analysis.file_tree.join("\n"),
        key_files = key_file_section,
    )
}
