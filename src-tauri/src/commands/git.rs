use crate::db::models::GitLabProject;
use crate::services::{git_ops, gitlab};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Debug, thiserror::Error)]
pub enum GitError {
    #[error("{0}")]
    GitLab(String),
    #[error("{0}")]
    Git(String),
}

impl GitError {
    pub fn gitlab(e: impl std::fmt::Display) -> Self {
        let msg = e.to_string();
        log::error!("GitLab API error: {}", msg);
        // Provide user-friendly messages for common scenarios
        if msg.contains("404") || msg.contains("Not Found") {
            GitError::GitLab("未找到该项目，请检查项目 ID 是否正确".to_string())
        } else if msg.contains("401") || msg.contains("Unauthorized") {
            GitError::GitLab("认证失败，请检查 GitLab 令牌是否有效".to_string())
        } else if msg.contains("403") || msg.contains("Forbidden") {
            GitError::GitLab("无权访问该项目，请确认令牌权限".to_string())
        } else if msg.contains("timeout") || msg.contains("connect") {
            GitError::GitLab("无法连接到 GitLab 服务器，请检查网络和服务器地址".to_string())
        } else {
            GitError::GitLab(format!("GitLab 请求失败，请稍后重试 ({})", msg))
        }
    }
    pub fn git(e: impl std::fmt::Display) -> Self {
        let msg = e.to_string();
        log::error!("Git operation error: {}", msg);
        if msg.contains("already exists") {
            GitError::Git("目标目录已存在，请更换路径或删除已有目录".to_string())
        } else if msg.contains("authentication") || msg.contains("credentials") {
            GitError::Git("Git 认证失败，请检查用户名和令牌".to_string())
        } else {
            GitError::Git(format!("Git 操作失败: {}", msg))
        }
    }
}

impl serde::Serialize for GitError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLabProjectLookupResult {
    pub project_ref: String,
    pub project: Option<GitLabProject>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn fetch_gitlab_project(
    project_ref: String,
    url: String,
    token: String,
) -> Result<GitLabProject, GitError> {
    gitlab::fetch_project(&project_ref, &url, &token)
        .await
        .map_err(GitError::gitlab)
}

#[tauri::command]
pub async fn fetch_gitlab_projects(
    project_refs: Vec<String>,
    url: String,
    token: String,
) -> Result<Vec<GitLabProjectLookupResult>, GitError> {
    let mut results = Vec::with_capacity(project_refs.len());

    for project_ref in project_refs {
        match gitlab::fetch_project(&project_ref, &url, &token).await {
            Ok(project) => results.push(GitLabProjectLookupResult {
                project_ref,
                project: Some(project),
                error: None,
            }),
            Err(error) => results.push(GitLabProjectLookupResult {
                project_ref,
                project: None,
                error: Some(GitError::gitlab(error).to_string()),
            }),
        }
    }

    Ok(results)
}

#[tauri::command]
pub async fn clone_project(
    app: AppHandle,
    clone_url: String,
    path: String,
    username: String,
    token: String,
) -> Result<(), GitError> {
    let result = tokio::task::spawn_blocking(move || {
        git_ops::clone_repo_with_progress(&clone_url, &path, &username, &token, |msg| {
            let _ = app.emit("clone-progress", msg);
        })
    })
    .await
    .map_err(|e| GitError::git(format!("内部错误: {}", e)))?;

    result.map_err(GitError::git)
}

#[tauri::command]
pub async fn check_paths_exist(paths: Vec<String>) -> Result<Vec<String>, GitError> {
    Ok(git_ops::check_paths_exist(&paths))
}

#[tauri::command]
pub async fn download_gitlab_project(
    project_id: i64,
    url: String,
    token: String,
    destination: String,
    sha: Option<String>,
) -> Result<(), GitError> {
    gitlab::download_project_archive(project_id, &url, &token, &destination, sha.as_deref())
        .await
        .map_err(GitError::gitlab)
}

#[tauri::command]
pub async fn copy_project_directory(
    source_path: String,
    destination_path: String,
) -> Result<(), GitError> {
    let result = tokio::task::spawn_blocking(move || {
        git_ops::copy_project_directory(&source_path, &destination_path)
    })
    .await
    .map_err(|e| GitError::git(format!("内部错误: {}", e)))?;

    result.map_err(GitError::git)
}
