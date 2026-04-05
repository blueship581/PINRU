use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

use crate::db::AppDb;
use crate::services::{github, gitlab};

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("{0}")]
    Db(String),
    #[error("{0}")]
    Connection(String),
}

impl ConfigError {
    pub fn db(e: impl std::fmt::Display) -> Self {
        log::error!("Database error in config: {}", e);
        ConfigError::Db("数据读写异常，请重启应用后重试".to_string())
    }
    pub fn gitlab_connection(e: impl std::fmt::Display) -> Self {
        log::error!("GitLab connection error: {}", e);
        ConfigError::Connection("无法连接到 GitLab 服务器，请检查地址和令牌是否正确".to_string())
    }
    pub fn github_connection(e: impl std::fmt::Display) -> Self {
        log::error!("GitHub connection error: {}", e);
        ConfigError::Connection("无法连接到 GitHub，请检查用户名和访问令牌是否正确".to_string())
    }
}

impl serde::Serialize for ConfigError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[tauri::command]
pub async fn get_config(app: AppHandle, key: String) -> Result<Option<String>, ConfigError> {
    let db = &app.state::<AppDb>().0;

    let row: Option<(String,)> = sqlx::query_as("SELECT value FROM configs WHERE key = ?1")
        .bind(&key)
        .fetch_optional(db)
        .await
        .map_err(ConfigError::db)?;

    Ok(row.map(|r| r.0))
}

#[tauri::command]
pub async fn set_config(
    app: AppHandle,
    key: String,
    value: String,
) -> Result<(), ConfigError> {
    let db = &app.state::<AppDb>().0;

    sqlx::query("INSERT OR REPLACE INTO configs (key, value) VALUES (?1, ?2)")
        .bind(&key)
        .bind(&value)
        .execute(db)
        .await
        .map_err(ConfigError::db)?;

    Ok(())
}

#[tauri::command]
pub async fn test_gitlab_connection(url: String, token: String) -> Result<bool, ConfigError> {
    gitlab::test_connection(&url, &token)
        .await
        .map_err(ConfigError::gitlab_connection)
}

#[tauri::command]
pub async fn test_github_connection(
    username: String,
    token: String,
) -> Result<bool, ConfigError> {
    github::test_connection(&username, &token)
        .await
        .map_err(ConfigError::github_connection)
}

#[tauri::command]
pub async fn pick_directory(app: AppHandle) -> Result<Option<String>, ConfigError> {
    let folder = app.dialog().file().blocking_pick_folder();
    let path = folder
        .and_then(|value| value.into_path().ok())
        .map(|value| value.display().to_string());
    Ok(path)
}
