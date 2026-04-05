use crate::db::models::GitLabProject;
use flate2::read::GzDecoder;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tar::Archive;

#[derive(Debug, thiserror::Error)]
pub enum GitLabError {
    #[error("HTTP request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("API returned error status: {0}")]
    ApiError(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Archive error: {0}")]
    Archive(String),
}

fn build_client() -> Result<reqwest::Client, GitLabError> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(GitLabError::Request)
}

pub async fn test_connection(url: &str, token: &str) -> Result<bool, GitLabError> {
    let client = build_client()?;
    let response = client
        .get(format!("{}/api/v4/user", url.trim_end_matches('/')))
        .header("PRIVATE-TOKEN", token)
        .send()
        .await?;

    Ok(response.status().is_success())
}

pub async fn fetch_project(
    project_ref: &str,
    url: &str,
    token: &str,
) -> Result<GitLabProject, GitLabError> {
    let encoded_ref = urlencoding::encode(project_ref);
    let client = build_client()?;
    let response = client
        .get(format!(
            "{}/api/v4/projects/{}",
            url.trim_end_matches('/'),
            encoded_ref
        ))
        .header("PRIVATE-TOKEN", token)
        .send()
        .await?;

    if !response.status().is_success() {
        return Err(GitLabError::ApiError(format!(
            "Status: {}, Body: {}",
            response.status(),
            response.text().await.unwrap_or_default()
        )));
    }

    let project: GitLabProject = response.json().await?;
    Ok(project)
}

pub async fn download_project_archive(
    project_id: i64,
    url: &str,
    token: &str,
    destination: &str,
    sha: Option<&str>,
) -> Result<(), GitLabError> {
    let destination_path = PathBuf::from(expand_tilde(destination));
    if destination_path.exists() {
        let folder_name = destination_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(destination);
        return Err(GitLabError::Archive(format!(
            "目标目录“{}”已存在，请先删除或更换目录",
            folder_name
        )));
    }

    let parent = destination_path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;

    let mut archive_url = format!(
        "{}/api/v4/projects/{}/repository/archive.tar.gz",
        url.trim_end_matches('/'),
        project_id
    );

    if let Some(sha) = sha.filter(|value| !value.trim().is_empty()) {
        archive_url.push_str("?sha=");
        archive_url.push_str(&urlencoding::encode(sha));
    }

    let client = build_client()?;
    let response = client
        .get(archive_url)
        .header("PRIVATE-TOKEN", token)
        .send()
        .await?;

    if !response.status().is_success() {
        return Err(GitLabError::ApiError(format!(
            "Status: {}, Body: {}",
            response.status(),
            response.text().await.unwrap_or_default()
        )));
    }

    let archive_bytes = response.bytes().await?;
    let temp_root = parent.join(format!(".pinru-archive-{}", uuid::Uuid::new_v4()));

    let unpack_result = (|| -> Result<(), GitLabError> {
        fs::create_dir_all(&temp_root)?;
        let decoder = GzDecoder::new(Cursor::new(archive_bytes));
        let mut archive = Archive::new(decoder);
        archive
            .unpack(&temp_root)
            .map_err(|error| GitLabError::Archive(error.to_string()))?;

        let extracted_root = resolve_extracted_root(&temp_root)?;
        fs::create_dir_all(&destination_path)?;
        move_dir_contents(&extracted_root, &destination_path)?;
        Ok(())
    })();

    let cleanup_result = fs::remove_dir_all(&temp_root);

    if let Err(error) = unpack_result {
        let _ = cleanup_result;
        let _ = fs::remove_dir_all(&destination_path);
        return Err(error);
    }

    if let Err(error) = cleanup_result {
        return Err(GitLabError::Io(error));
    }

    Ok(())
}

fn resolve_extracted_root(temp_root: &Path) -> Result<PathBuf, GitLabError> {
    let entries = fs::read_dir(temp_root)?
        .collect::<Result<Vec<_>, _>>()?;

    if entries.len() == 1 && entries[0].file_type()?.is_dir() {
        return Ok(entries[0].path());
    }

    Ok(temp_root.to_path_buf())
}

fn move_dir_contents(source: &Path, destination: &Path) -> Result<(), std::io::Error> {
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        fs::rename(source_path, destination_path)?;
    }

    Ok(())
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
