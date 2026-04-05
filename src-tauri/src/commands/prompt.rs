use tauri::{AppHandle, Manager};

use crate::db::models::{
    GeneratePromptRequest, LlmProviderConfig, PromptGenerationResult, Task,
};
use crate::db::AppDb;
use crate::services::{code_analysis, llm, prompt as prompt_service};

#[derive(Debug, thiserror::Error)]
pub enum PromptError {
    #[error("{0}")]
    Db(String),
    #[error("{0}")]
    Validation(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Analysis(String),
    #[error("{0}")]
    Provider(String),
}

impl PromptError {
    fn db(error: impl std::fmt::Display) -> Self {
        log::error!("Database error in prompt flow: {}", error);
        PromptError::Db("提示词数据读写异常，请稍后重试".to_string())
    }

    fn validation(message: impl Into<String>) -> Self {
        PromptError::Validation(message.into())
    }

    fn not_found(task_id: &str) -> Self {
        PromptError::NotFound(format!("未找到任务: {task_id}"))
    }

    fn analysis(error: impl std::fmt::Display) -> Self {
        log::error!("Code analysis error: {}", error);
        PromptError::Analysis(error.to_string())
    }

    fn provider(error: impl std::fmt::Display) -> Self {
        log::error!("LLM provider error: {}", error);
        PromptError::Provider(error.to_string())
    }
}

impl serde::Serialize for PromptError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[tauri::command]
pub async fn test_llm_provider(provider: LlmProviderConfig) -> Result<bool, PromptError> {
    let provider = llm::build_provider(provider).map_err(PromptError::provider)?;
    provider
        .test_connection()
        .await
        .map_err(PromptError::provider)?;
    Ok(true)
}

#[tauri::command]
pub async fn generate_task_prompt(
    app: AppHandle,
    request: GeneratePromptRequest,
) -> Result<PromptGenerationResult, PromptError> {
    if request.task_id.trim().is_empty() {
        return Err(PromptError::validation("任务不能为空"));
    }
    if request.task_type.trim().is_empty() {
        return Err(PromptError::validation("任务类型不能为空"));
    }

    let db = &app.state::<AppDb>().0;
    let task = fetch_task(db, &request.task_id).await?;
    let task_path = task
        .local_path
        .clone()
        .ok_or_else(|| PromptError::validation("当前任务没有本地代码目录，请先完成领题 Clone"))?;

    let providers = llm::load_provider_configs(db)
        .await
        .map_err(PromptError::provider)?;
    let selected_provider = llm::select_provider(&providers, request.provider_id.as_deref())
        .map_err(PromptError::provider)?;
    let provider_name = selected_provider.name.clone();
    let provider_model = selected_provider.model.clone();
    let provider = llm::build_provider(selected_provider).map_err(PromptError::provider)?;

    let analysis = tokio::task::spawn_blocking(move || code_analysis::analyze_repository(&task_path))
        .await
        .map_err(|error| PromptError::analysis(format!("分析任务被中断: {error}")))?
        .map_err(PromptError::analysis)?;

    let prompt_text = prompt_service::generate_prompt(provider.as_ref(), &task, &request, &analysis)
        .await
        .map_err(PromptError::provider)?;

    persist_prompt(db, &task.id, &prompt_text).await?;

    Ok(PromptGenerationResult {
        prompt_text,
        analysis,
        provider_name,
        model: provider_model,
        status: "PromptReady".to_string(),
    })
}

#[tauri::command]
pub async fn save_task_prompt(
    app: AppHandle,
    task_id: String,
    prompt_text: String,
) -> Result<(), PromptError> {
    if task_id.trim().is_empty() {
        return Err(PromptError::validation("任务不能为空"));
    }
    if prompt_text.trim().is_empty() {
        return Err(PromptError::validation("提示词内容不能为空"));
    }

    let db = &app.state::<AppDb>().0;
    fetch_task(db, &task_id).await?;
    persist_prompt(db, &task_id, &prompt_text).await
}

async fn fetch_task(db: &sqlx::Pool<sqlx::Sqlite>, task_id: &str) -> Result<Task, PromptError> {
    let task: Option<Task> = sqlx::query_as(
        "SELECT id, gitlab_project_id, project_name, status, local_path, prompt_text, created_at, updated_at, notes FROM tasks WHERE id = ?1",
    )
    .bind(task_id)
    .fetch_optional(db)
    .await
    .map_err(PromptError::db)?;

    task.ok_or_else(|| PromptError::not_found(task_id))
}

async fn persist_prompt(
    db: &sqlx::Pool<sqlx::Sqlite>,
    task_id: &str,
    prompt_text: &str,
) -> Result<(), PromptError> {
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M").to_string();
    let result = sqlx::query(
        "UPDATE tasks SET prompt_text = ?1, status = ?2, updated_at = ?3 WHERE id = ?4",
    )
    .bind(prompt_text)
    .bind("PromptReady")
    .bind(now)
    .bind(task_id)
    .execute(db)
    .await
    .map_err(PromptError::db)?;

    if result.rows_affected() == 0 {
        return Err(PromptError::not_found(task_id));
    }

    Ok(())
}
