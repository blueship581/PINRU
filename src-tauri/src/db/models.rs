use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
pub struct Task {
    pub id: String,
    pub gitlab_project_id: i64,
    pub project_name: String,
    pub status: String,
    pub local_path: Option<String>,
    pub prompt_text: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub notes: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
pub struct ModelRun {
    pub id: String,
    pub task_id: String,
    pub model_name: String,
    pub branch_name: Option<String>,
    pub local_path: Option<String>,
    pub pr_url: Option<String>,
    pub origin_url: Option<String>,
    pub gsb_score: Option<String>,
    pub status: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateTaskRequest {
    pub gitlab_project_id: i64,
    pub project_name: String,
    pub local_path: Option<String>,
    pub models: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateModelRunRequest {
    pub task_id: String,
    pub model_name: String,
    pub status: String,
    pub branch_name: Option<String>,
    pub pr_url: Option<String>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitModelRunRequest {
    pub task_id: String,
    pub model_name: String,
    pub target_repo: String,
    pub github_username: String,
    pub github_token: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishSourceRepoRequest {
    pub task_id: String,
    pub model_name: String,
    pub target_repo: String,
    pub github_username: String,
    pub github_token: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishSourceRepoResult {
    pub branch_name: String,
    pub repo_url: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitModelRunResult {
    pub branch_name: String,
    pub pr_url: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitLabProject {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub web_url: String,
    pub default_branch: Option<String>,
    pub http_url_to_repo: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize)]
pub struct Config {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub enum LlmProviderType {
    #[serde(rename = "openai_compatible", alias = "open_ai_compatible")]
    OpenAiCompatible,
    #[serde(rename = "anthropic")]
    Anthropic,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LlmProviderConfig {
    pub id: String,
    pub name: String,
    pub provider_type: LlmProviderType,
    pub model: String,
    pub base_url: Option<String>,
    pub api_key: String,
    pub is_default: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GeneratePromptRequest {
    pub task_id: String,
    pub provider_id: Option<String>,
    pub task_type: String,
    pub scopes: Vec<String>,
    pub constraints: Vec<String>,
    pub additional_notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzedFileSnippet {
    pub path: String,
    pub snippet: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CodeAnalysisSummary {
    pub repo_path: String,
    pub total_files: usize,
    pub detected_stack: Vec<String>,
    pub file_tree: Vec<String>,
    pub key_files: Vec<AnalyzedFileSnippet>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PromptGenerationResult {
    pub prompt_text: String,
    pub analysis: CodeAnalysisSummary,
    pub provider_name: String,
    pub model: String,
    pub status: String,
}
