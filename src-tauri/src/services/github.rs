use reqwest::{Client, Response, StatusCode};
use serde::{Deserialize, Serialize};

const GITHUB_API_BASE: &str = "https://api.github.com";
const GITHUB_ACCEPT: &str = "application/vnd.github+json";
const GITHUB_USER_AGENT: &str = "pinru-tauri";

#[derive(Debug, thiserror::Error)]
pub enum GitHubError {
    #[error("HTTP request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("{0}")]
    Api(String),
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct GitHubUser {
    pub login: String,
    pub email: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct GitHubRepo {
    pub html_url: String,
    pub default_branch: String,
}

#[derive(Debug, Deserialize)]
struct GitHubPullRequest {
    html_url: String,
}

#[derive(Debug, Deserialize)]
struct GitHubApiErrorBody {
    message: Option<String>,
}

pub async fn test_connection(username: &str, token: &str) -> Result<bool, GitHubError> {
    let body = get_authenticated_user(token).await?;
    Ok(body.login.eq_ignore_ascii_case(username.trim()))
}

pub async fn get_authenticated_user(token: &str) -> Result<GitHubUser, GitHubError> {
    let response = github_client()
        .get(format!("{GITHUB_API_BASE}/user"))
        .bearer_auth(token.trim())
        .send()
        .await?;

    let response = ensure_success(response).await?;
    Ok(response.json().await?)
}

pub async fn ensure_repository(
    target_repo: &str,
    token: &str,
    description: Option<&str>,
) -> Result<GitHubRepo, GitHubError> {
    match get_repository(target_repo, token).await {
        Ok(repo) => Ok(repo),
        Err(GitHubError::Api(message)) if message == "Not Found" => {
            create_repository(target_repo, token, description).await
        }
        Err(error) => Err(error),
    }
}

pub async fn set_default_branch(
    target_repo: &str,
    branch_name: &str,
    token: &str,
) -> Result<(), GitHubError> {
    let response = github_client()
        .patch(format!("{GITHUB_API_BASE}/repos/{target_repo}"))
        .bearer_auth(token.trim())
        .json(&serde_json::json!({
            "default_branch": branch_name,
        }))
        .send()
        .await?;

    ensure_success(response).await?;
    Ok(())
}

pub async fn ensure_pull_request(
    target_repo: &str,
    repo_owner: &str,
    head_branch: &str,
    title: &str,
    body: &str,
    token: &str,
) -> Result<String, GitHubError> {
    if let Some(existing_url) =
        find_existing_pull_request(target_repo, repo_owner, head_branch, "main", token).await?
    {
        return Ok(existing_url);
    }

    let response = github_client()
        .post(format!("{GITHUB_API_BASE}/repos/{target_repo}/pulls"))
        .bearer_auth(token.trim())
        .json(&serde_json::json!({
            "title": title,
            "body": body,
            "head": format!("{repo_owner}:{head_branch}"),
            "base": "main",
        }))
        .send()
        .await?;

    let response = ensure_success(response).await?;
    let pull_request: GitHubPullRequest = response.json().await?;
    Ok(pull_request.html_url)
}

async fn get_repository(target_repo: &str, token: &str) -> Result<GitHubRepo, GitHubError> {
    let response = github_client()
        .get(format!("{GITHUB_API_BASE}/repos/{target_repo}"))
        .bearer_auth(token.trim())
        .send()
        .await?;

    let response = ensure_success(response).await?;
    Ok(response.json().await?)
}

async fn create_repository(
    target_repo: &str,
    token: &str,
    description: Option<&str>,
) -> Result<GitHubRepo, GitHubError> {
    let (owner, repo_name) = split_target_repo(target_repo)?;
    let authenticated_user = get_authenticated_user(token).await?;

    let (url, payload) = if owner.eq_ignore_ascii_case(&authenticated_user.login) {
        (
            format!("{GITHUB_API_BASE}/user/repos"),
            serde_json::json!({
                "name": repo_name,
                "description": description.unwrap_or_default(),
                "private": false,
                "auto_init": false,
            }),
        )
    } else {
        (
            format!("{GITHUB_API_BASE}/orgs/{owner}/repos"),
            serde_json::json!({
                "name": repo_name,
                "description": description.unwrap_or_default(),
                "private": false,
                "auto_init": false,
            }),
        )
    };

    let response = github_client()
        .post(url)
        .bearer_auth(token.trim())
        .json(&payload)
        .send()
        .await?;

    let response = ensure_success(response).await?;
    Ok(response.json().await?)
}

async fn find_existing_pull_request(
    target_repo: &str,
    repo_owner: &str,
    head_branch: &str,
    base_branch: &str,
    token: &str,
) -> Result<Option<String>, GitHubError> {
    let response = github_client()
        .get(format!("{GITHUB_API_BASE}/repos/{target_repo}/pulls"))
        .query(&[
            ("state", "open"),
            ("head", &format!("{repo_owner}:{head_branch}")),
            ("base", base_branch),
        ])
        .bearer_auth(token.trim())
        .send()
        .await?;

    let response = ensure_success(response).await?;
    let pull_requests: Vec<GitHubPullRequest> = response.json().await?;

    Ok(pull_requests.into_iter().next().map(|pr| pr.html_url))
}

fn github_client() -> Client {
    Client::builder()
        .default_headers({
            let mut headers = reqwest::header::HeaderMap::new();
            headers.insert(
                reqwest::header::ACCEPT,
                reqwest::header::HeaderValue::from_static(GITHUB_ACCEPT),
            );
            headers
        })
        .user_agent(GITHUB_USER_AGENT)
        .build()
        .expect("failed to build github client")
}

async fn ensure_success(response: Response) -> Result<Response, GitHubError> {
    if response.status().is_success() {
        return Ok(response);
    }

    let status = response.status();
    let body = response
        .json::<GitHubApiErrorBody>()
        .await
        .ok()
        .and_then(|payload| payload.message)
        .unwrap_or_else(|| fallback_message(status));

    Err(GitHubError::Api(body))
}

fn split_target_repo(target_repo: &str) -> Result<(&str, &str), GitHubError> {
    let mut segments = target_repo.split('/');
    let owner = segments.next().unwrap_or_default().trim();
    let repo = segments.next().unwrap_or_default().trim();

    if owner.is_empty() || repo.is_empty() || segments.next().is_some() {
        return Err(GitHubError::Api("源码仓库格式应为 owner/repo".to_string()));
    }

    Ok((owner, repo))
}

fn fallback_message(status: StatusCode) -> String {
    match status {
        StatusCode::UNAUTHORIZED => "GitHub 认证失败，请检查访问令牌".to_string(),
        StatusCode::FORBIDDEN => "GitHub 拒绝了本次操作，请确认令牌权限和仓库访问权限".to_string(),
        StatusCode::NOT_FOUND => "Not Found".to_string(),
        StatusCode::UNPROCESSABLE_ENTITY => "GitHub 无法创建 PR，请检查分支是否有实际改动".to_string(),
        _ => format!("GitHub API 请求失败: HTTP {}", status.as_u16()),
    }
}
