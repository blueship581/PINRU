use tauri::{AppHandle, Manager};

use crate::db::AppDb;
use crate::db::models::{CreateTaskRequest, ModelRun, Task, UpdateModelRunRequest};

#[derive(Debug, thiserror::Error)]
pub enum TaskError {
    #[error("{0}")]
    Db(String),
    #[error("{0}")]
    Fs(String),
    #[error("{0}")]
    NotFound(String),
}

impl TaskError {
    pub fn db(e: impl std::fmt::Display) -> Self {
        log::error!("Database error in task: {}", e);
        TaskError::Db("任务数据读写异常，请重启应用后重试".to_string())
    }
    pub fn fs(e: impl std::fmt::Display) -> Self {
        log::error!("Filesystem error in task: {}", e);
        TaskError::Fs("本地文件删除失败，请检查目录权限后重试".to_string())
    }
    pub fn not_found(id: &str) -> Self {
        TaskError::NotFound(format!("未找到任务: {}", id))
    }
}

fn expand_tilde(path: &str) -> String {
    if path == "~" {
        return std::env::var("HOME").unwrap_or_else(|_| path.to_string());
    }
    if let Some(rest) = path.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return format!("{}/{}", home, rest);
        }
    }
    path.to_string()
}

impl serde::Serialize for TaskError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[tauri::command]
pub async fn list_tasks(app: AppHandle) -> Result<Vec<Task>, TaskError> {
    let db = &app.state::<AppDb>().0;

    let tasks: Vec<Task> = sqlx::query_as(
        "SELECT id, gitlab_project_id, project_name, status, local_path, prompt_text, created_at, updated_at, notes FROM tasks ORDER BY created_at DESC",
    )
    .fetch_all(db)
    .await
    .map_err(TaskError::db)?;

    Ok(tasks)
}

#[tauri::command]
pub async fn get_task(app: AppHandle, id: String) -> Result<Option<Task>, TaskError> {
    let db = &app.state::<AppDb>().0;

    let task: Option<Task> = sqlx::query_as(
        "SELECT id, gitlab_project_id, project_name, status, local_path, prompt_text, created_at, updated_at, notes FROM tasks WHERE id = ?1",
    )
    .bind(&id)
    .fetch_optional(db)
    .await
    .map_err(TaskError::db)?;

    Ok(task)
}

#[tauri::command]
pub async fn create_task(app: AppHandle, task: CreateTaskRequest) -> Result<Task, TaskError> {
    let db = &app.state::<AppDb>().0;

    let task_id = format!("label-{:05}", task.gitlab_project_id);
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M").to_string();

    sqlx::query(
        "INSERT INTO tasks (id, gitlab_project_id, project_name, status, local_path, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    )
    .bind(&task_id)
    .bind(task.gitlab_project_id)
    .bind(&task.project_name)
    .bind("Claimed")
    .bind(&task.local_path)
    .bind(&now)
    .bind(&now)
    .execute(db)
    .await
    .map_err(TaskError::db)?;

    // Create model_runs entries
    for model_name in &task.models {
        let run_id = uuid::Uuid::new_v4().to_string();
        let model_local_path = task.local_path.as_ref().map(|base_path| {
            format!("{}/{}", base_path.trim_end_matches('/'), model_name)
        });
        sqlx::query(
            "INSERT INTO model_runs (id, task_id, model_name, local_path, status) VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .bind(&run_id)
        .bind(&task_id)
        .bind(model_name)
        .bind(model_local_path)
        .bind("pending")
        .execute(db)
        .await
        .map_err(TaskError::db)?;
    }

    Ok(Task {
        id: task_id,
        gitlab_project_id: task.gitlab_project_id,
        project_name: task.project_name,
        status: "Claimed".to_string(),
        local_path: task.local_path,
        prompt_text: None,
        created_at: now.clone(),
        updated_at: now,
        notes: None,
    })
}

#[tauri::command]
pub async fn update_task_status(
    app: AppHandle,
    id: String,
    status: String,
) -> Result<(), TaskError> {
    let db = &app.state::<AppDb>().0;

    let now = chrono::Local::now().format("%Y-%m-%d %H:%M").to_string();

    let result = sqlx::query("UPDATE tasks SET status = ?1, updated_at = ?2 WHERE id = ?3")
        .bind(&status)
        .bind(&now)
        .bind(&id)
        .execute(db)
        .await
        .map_err(TaskError::db)?;

    if result.rows_affected() == 0 {
        return Err(TaskError::not_found(&id));
    }

    Ok(())
}

#[tauri::command]
pub async fn list_model_runs(
    app: AppHandle,
    task_id: String,
) -> Result<Vec<ModelRun>, TaskError> {
    let db = &app.state::<AppDb>().0;

    let runs: Vec<ModelRun> = sqlx::query_as(
        "SELECT id, task_id, model_name, branch_name, local_path, pr_url, origin_url, gsb_score, status, started_at, finished_at
         FROM model_runs
         WHERE task_id = ?1
         ORDER BY CASE WHEN UPPER(model_name) = 'ORIGIN' THEN 0 ELSE 1 END, model_name COLLATE NOCASE",
    )
    .bind(&task_id)
    .fetch_all(db)
    .await
    .map_err(TaskError::db)?;

    Ok(runs)
}

#[tauri::command]
pub async fn update_model_run(
    app: AppHandle,
    request: UpdateModelRunRequest,
) -> Result<(), TaskError> {
    let db = &app.state::<AppDb>().0;

    let result = sqlx::query(
        "UPDATE model_runs
         SET status = ?1, branch_name = ?2, pr_url = ?3, started_at = ?4, finished_at = ?5
         WHERE task_id = ?6 AND model_name = ?7",
    )
    .bind(&request.status)
    .bind(&request.branch_name)
    .bind(&request.pr_url)
    .bind(&request.started_at)
    .bind(&request.finished_at)
    .bind(&request.task_id)
    .bind(&request.model_name)
    .execute(db)
    .await
    .map_err(TaskError::db)?;

    if result.rows_affected() == 0 {
        return Err(TaskError::NotFound(format!(
            "未找到模型记录: {} / {}",
            request.task_id, request.model_name
        )));
    }

    Ok(())
}

#[tauri::command]
pub async fn delete_task(app: AppHandle, id: String) -> Result<(), TaskError> {
    let db = &app.state::<AppDb>().0;

    let task: Option<Task> = sqlx::query_as(
        "SELECT id, gitlab_project_id, project_name, status, local_path, prompt_text, created_at, updated_at, notes FROM tasks WHERE id = ?1",
    )
    .bind(&id)
    .fetch_optional(db)
    .await
    .map_err(TaskError::db)?;

    let task = task.ok_or_else(|| TaskError::not_found(&id))?;

    if let Some(local_path) = task.local_path.as_deref() {
        let expanded = expand_tilde(local_path);
        let path = std::path::Path::new(&expanded);
        if path.exists() {
            std::fs::remove_dir_all(path).map_err(TaskError::fs)?;
        }
    }

    sqlx::query("DELETE FROM model_runs WHERE task_id = ?1")
        .bind(&id)
        .execute(db)
        .await
        .map_err(TaskError::db)?;

    sqlx::query("DELETE FROM tasks WHERE id = ?1")
        .bind(&id)
        .execute(db)
        .await
        .map_err(TaskError::db)?;

    Ok(())
}
