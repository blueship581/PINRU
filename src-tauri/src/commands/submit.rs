use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::db::models::{
    ModelRun, PublishSourceRepoRequest, PublishSourceRepoResult, SubmitModelRunRequest,
    SubmitModelRunResult, Task,
};
use crate::db::AppDb;
use crate::services::{git_ops, github};

const MAIN_BRANCH: &str = "main";

#[derive(Debug, thiserror::Error)]
pub enum SubmitError {
    #[error("{0}")]
    Db(String),
    #[error("{0}")]
    Validation(String),
    #[error("{0}")]
    Git(String),
    #[error("{0}")]
    GitHub(String),
    #[error("{0}")]
    NotFound(String),
}

impl SubmitError {
    fn db(error: impl std::fmt::Display) -> Self {
        log::error!("Submit DB error: {}", error);
        SubmitError::Db("提交记录读写失败，请稍后重试".to_string())
    }

    fn validation(message: impl Into<String>) -> Self {
        SubmitError::Validation(message.into())
    }

    fn git(error: impl std::fmt::Display) -> Self {
        log::error!("Submit git error: {}", error);
        SubmitError::Git(format!("Git 提交失败: {error}"))
    }

    fn github(error: impl std::fmt::Display) -> Self {
        log::error!("Submit GitHub error: {}", error);
        SubmitError::GitHub(format!("GitHub 提交失败: {error}"))
    }
}

impl serde::Serialize for SubmitError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[tauri::command]
pub async fn publish_source_repo(
    app: AppHandle,
    request: PublishSourceRepoRequest,
) -> Result<PublishSourceRepoResult, SubmitError> {
    validate_publish_request(&request)?;

    let db = &app.state::<AppDb>().0;
    let task = fetch_task(db, &request.task_id).await?;
    let source_run = fetch_model_run(db, &request.task_id, &request.model_name).await?;
    let source_path = model_run_path(&source_run, "源码文件夹缺少本地仓库路径，无法上传源码")?;

    let github_user = github::get_authenticated_user(request.github_token.trim())
        .await
        .map_err(SubmitError::github)?;
    let author_email = github_user
        .email
        .clone()
        .unwrap_or_else(|| format!("{}@users.noreply.github.com", github_user.login));
    let remote_repo = github::ensure_repository(
        request.target_repo.trim(),
        request.github_token.trim(),
        Some(task.project_name.as_str()),
    )
    .await
    .map_err(|error| {
        SubmitError::github(format!(
            "确保 GitHub 仓库 {} 可用失败: {}",
            request.target_repo.trim(),
            error
        ))
    })?;

    let workspace_path = git_ops::workspace_path(request.target_repo.trim());
    let remote_url = format!("https://github.com/{}.git", request.target_repo.trim());
    let github_token = request.github_token.trim().to_string();
    let publish_result = tokio::task::spawn_blocking({
        let workspace_path = workspace_path.clone();
        let remote_url = remote_url.clone();
        let source_path = source_path.clone();
        let github_login = github_user.login.clone();
        let author_email = author_email.clone();
        let github_token = github_token.clone();
        move || -> Result<(), SubmitError> {
            git_ops::recreate_workspace(&workspace_path, &remote_url, &github_login, &author_email)
                .map_err(SubmitError::git)?;
            git_ops::copy_project_contents(&source_path, &workspace_path).map_err(SubmitError::git)?;
            let committed = git_ops::commit_all(
                &workspace_path,
                MAIN_BRANCH,
                &github_login,
                &author_email,
                "init: 原始项目初始化",
            )
            .map_err(SubmitError::git)?;

            if !committed {
                return Err(SubmitError::git("源码目录没有可提交的文件".to_string()));
            }

            git_ops::ensure_branch_exists(&workspace_path, MAIN_BRANCH).map_err(SubmitError::git)?;
            git_ops::push_branch(
                &workspace_path,
                MAIN_BRANCH,
                &github_login,
                &github_token,
            )
            .map_err(SubmitError::git)?;

            Ok(())
        }
    })
    .await
    .map_err(|error| SubmitError::git(format!("源码上传任务被中断: {error}")))?;

    publish_result?;

    let _ = github::set_default_branch(
        request.target_repo.trim(),
        MAIN_BRANCH,
        request.github_token.trim(),
    )
    .await;

    Ok(PublishSourceRepoResult {
        branch_name: MAIN_BRANCH.to_string(),
        repo_url: remote_repo.html_url,
    })
}

#[tauri::command]
pub async fn submit_model_run(
    app: AppHandle,
    request: SubmitModelRunRequest,
) -> Result<SubmitModelRunResult, SubmitError> {
    validate_request(&request)?;

    let db = &app.state::<AppDb>().0;
    let _task = fetch_task(db, &request.task_id).await?;
    let model_run = fetch_model_run(db, &request.task_id, &request.model_name).await?;
    let model_path = model_run_path(&model_run, "模型副本缺少本地目录，无法创建 PR")?;
    let workspace_path = git_ops::workspace_path(request.target_repo.trim());

    if !workspace_path.exists() {
        return Err(SubmitError::validation(
            "源码尚未上传，请先执行源码上传步骤后再创建模型 PR",
        ));
    }

    let github_user = github::get_authenticated_user(request.github_token.trim())
        .await
        .map_err(SubmitError::github)?;
    let author_email = github_user
        .email
        .clone()
        .unwrap_or_else(|| format!("{}@users.noreply.github.com", github_user.login));

    let branch_name = request.model_name.trim().to_string();
    let started_at = now_string();
    update_model_run_status(
        db,
        &request.task_id,
        &request.model_name,
        "running",
        Some(branch_name.as_str()),
        None,
        Some(started_at.as_str()),
        None,
    )
    .await?;

    let commit_result = tokio::task::spawn_blocking({
        let workspace_path = workspace_path.clone();
        let model_path = model_path.clone();
        let github_login = github_user.login.clone();
        let author_email = author_email.clone();
        let commit_message = format!("feat: {} 模型实现", request.model_name.trim());
        let branch_name_for_commit = branch_name.clone();
        move || -> Result<bool, SubmitError> {
            git_ops::create_or_reset_branch_from(&workspace_path, &branch_name_for_commit, MAIN_BRANCH)
                .map_err(SubmitError::git)?;
            git_ops::copy_project_contents(&model_path, &workspace_path).map_err(SubmitError::git)?;
            git_ops::commit_all(
                &workspace_path,
                &branch_name_for_commit,
                &github_login,
                &author_email,
                &commit_message,
            )
            .map_err(SubmitError::git)
        }
    })
    .await
    .map_err(|error| SubmitError::git(format!("模型提交任务被中断: {error}")))?;

    let committed = match commit_result {
        Ok(committed) => committed,
        Err(error) => {
            mark_model_run_error(
                db,
                &request.task_id,
                &request.model_name,
                &branch_name,
                &started_at,
            )
            .await?;
            return Err(error);
        }
    };

    if !committed {
        mark_model_run_error(
            db,
            &request.task_id,
            &request.model_name,
            &branch_name,
            &started_at,
        )
        .await?;
        return Err(SubmitError::validation(format!(
            "模型 {} 与源码 main 无差异，无法创建 PR",
            request.model_name.trim()
        )));
    }

    let push_result = tokio::task::spawn_blocking({
        let workspace_path = workspace_path.clone();
        let github_login = github_user.login.clone();
        let token = request.github_token.trim().to_string();
        let branch_name = branch_name.clone();
        move || git_ops::push_branch(&workspace_path, &branch_name, &github_login, &token)
    })
    .await
    .map_err(|error| SubmitError::git(format!("模型分支推送被中断: {error}")))?;

    if let Err(error) = push_result {
        mark_model_run_error(
            db,
            &request.task_id,
            &request.model_name,
            &branch_name,
            &started_at,
        )
        .await?;
        return Err(SubmitError::git(error));
    }

    let repo_owner = request
        .target_repo
        .split('/')
        .next()
        .ok_or_else(|| SubmitError::validation("源码仓库格式应为 owner/repo"))?;
    let pr_url = match github::ensure_pull_request(
        request.target_repo.trim(),
        repo_owner,
        &branch_name,
        request.model_name.trim(),
        request.model_name.trim(),
        request.github_token.trim(),
    )
    .await
    {
        Ok(pr_url) => pr_url,
        Err(error) => {
            mark_model_run_error(
                db,
                &request.task_id,
                &request.model_name,
                &branch_name,
                &started_at,
            )
            .await?;
            return Err(SubmitError::github(error));
        }
    };

    let finished_at = now_string();
    update_model_run_status(
        db,
        &request.task_id,
        &request.model_name,
        "done",
        Some(branch_name.as_str()),
        Some(pr_url.as_str()),
        Some(started_at.as_str()),
        Some(finished_at.as_str()),
    )
    .await?;

    Ok(SubmitModelRunResult { branch_name, pr_url })
}

async fn fetch_task(db: &sqlx::Pool<sqlx::Sqlite>, task_id: &str) -> Result<Task, SubmitError> {
    let task = sqlx::query_as::<_, Task>(
        "SELECT id, gitlab_project_id, project_name, status, local_path, prompt_text, created_at, updated_at, notes FROM tasks WHERE id = ?1",
    )
    .bind(task_id)
    .fetch_optional(db)
    .await
    .map_err(SubmitError::db)?;

    task.ok_or_else(|| SubmitError::NotFound(format!("未找到任务: {task_id}")))
}

async fn fetch_model_run(
    db: &sqlx::Pool<sqlx::Sqlite>,
    task_id: &str,
    model_name: &str,
) -> Result<ModelRun, SubmitError> {
    let run = sqlx::query_as::<_, ModelRun>(
        "SELECT id, task_id, model_name, branch_name, local_path, pr_url, origin_url, gsb_score, status, started_at, finished_at
         FROM model_runs
         WHERE task_id = ?1 AND model_name = ?2",
    )
    .bind(task_id)
    .bind(model_name)
    .fetch_optional(db)
    .await
    .map_err(SubmitError::db)?;

    run.ok_or_else(|| SubmitError::NotFound(format!("未找到模型记录: {task_id} / {model_name}")))
}

async fn update_model_run_status(
    db: &sqlx::Pool<sqlx::Sqlite>,
    task_id: &str,
    model_name: &str,
    status: &str,
    branch_name: Option<&str>,
    pr_url: Option<&str>,
    started_at: Option<&str>,
    finished_at: Option<&str>,
) -> Result<(), SubmitError> {
    let result = sqlx::query(
        "UPDATE model_runs
         SET status = ?1, branch_name = ?2, pr_url = ?3, started_at = ?4, finished_at = ?5
         WHERE task_id = ?6 AND model_name = ?7",
    )
    .bind(status)
    .bind(branch_name)
    .bind(pr_url)
    .bind(started_at)
    .bind(finished_at)
    .bind(task_id)
    .bind(model_name)
    .execute(db)
    .await
    .map_err(SubmitError::db)?;

    if result.rows_affected() == 0 {
        return Err(SubmitError::NotFound(format!(
            "未找到模型记录: {task_id} / {model_name}"
        )));
    }

    Ok(())
}

async fn mark_model_run_error(
    db: &sqlx::Pool<sqlx::Sqlite>,
    task_id: &str,
    model_name: &str,
    branch_name: &str,
    started_at: &str,
) -> Result<(), SubmitError> {
    let finished_at = now_string();
    update_model_run_status(
        db,
        task_id,
        model_name,
        "error",
        Some(branch_name),
        None,
        Some(started_at),
        Some(finished_at.as_str()),
    )
    .await
}

fn model_run_path(model_run: &ModelRun, message: &str) -> Result<PathBuf, SubmitError> {
    let local_path = model_run
        .local_path
        .clone()
        .ok_or_else(|| SubmitError::validation(message))?;
    Ok(PathBuf::from(expand_tilde(&local_path)))
}

fn validate_publish_request(request: &PublishSourceRepoRequest) -> Result<(), SubmitError> {
    if request.task_id.trim().is_empty() {
        return Err(SubmitError::validation("任务不能为空"));
    }
    if request.model_name.trim().is_empty() {
        return Err(SubmitError::validation("源码文件夹不能为空"));
    }

    validate_target_repo_and_account(
        request.target_repo.trim(),
        request.github_username.trim(),
        request.github_token.trim(),
    )
}

fn validate_request(request: &SubmitModelRunRequest) -> Result<(), SubmitError> {
    if request.task_id.trim().is_empty() {
        return Err(SubmitError::validation("任务不能为空"));
    }
    if request.model_name.trim().is_empty() {
        return Err(SubmitError::validation("模型名称不能为空"));
    }

    validate_target_repo_and_account(
        request.target_repo.trim(),
        request.github_username.trim(),
        request.github_token.trim(),
    )
}

fn validate_target_repo_and_account(
    target_repo: &str,
    github_username: &str,
    github_token: &str,
) -> Result<(), SubmitError> {
    if target_repo.is_empty() {
        return Err(SubmitError::validation("源码仓库不能为空"));
    }
    if !is_repo_path(target_repo) {
        return Err(SubmitError::validation("源码仓库格式应为 owner/repo"));
    }
    if github_username.is_empty() || github_token.is_empty() {
        return Err(SubmitError::validation("GitHub 账号信息不完整"));
    }

    Ok(())
}

fn is_repo_path(value: &str) -> bool {
    let mut segments = value.split('/');
    let owner = segments.next().unwrap_or_default();
    let repo = segments.next().unwrap_or_default();
    segments.next().is_none() && !owner.trim().is_empty() && !repo.trim().is_empty()
}

fn now_string() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M").to_string()
}

fn expand_tilde(path: &str) -> String {
    if path == "~" {
        return std::env::var("HOME").unwrap_or_else(|_| path.to_string());
    }
    if let Some(rest) = path.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return format!("{home}/{rest}");
        }
    }
    path.to_string()
}
