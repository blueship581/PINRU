use std::future::Future;
use std::pin::Pin;

use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use reqwest::Client;
use serde_json::json;
use sqlx::{Pool, Sqlite};

use crate::db::models::{LlmProviderConfig, LlmProviderType};

const ANTHROPIC_VERSION: &str = "2023-06-01";

#[derive(Debug, thiserror::Error)]
pub enum LlmServiceError {
    #[error("{0}")]
    Config(String),
    #[error("{0}")]
    Request(String),
    #[error("{0}")]
    Response(String),
}

pub trait LlmProvider: Send + Sync {
    fn config(&self) -> &LlmProviderConfig;
    fn test_connection<'a>(
        &'a self,
    ) -> Pin<Box<dyn Future<Output = Result<(), LlmServiceError>> + Send + 'a>>;
    fn generate<'a>(
        &'a self,
        system_prompt: &'a str,
        user_prompt: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<String, LlmServiceError>> + Send + 'a>>;
}

pub async fn load_provider_configs(
    db: &Pool<Sqlite>,
) -> Result<Vec<LlmProviderConfig>, LlmServiceError> {
    let row: Option<(String,)> = sqlx::query_as("SELECT value FROM configs WHERE key = ?1")
        .bind("llm_providers")
        .fetch_optional(db)
        .await
        .map_err(|error| LlmServiceError::Config(format!("读取模型配置失败: {error}")))?;

    let Some((raw,)) = row else {
        return Ok(Vec::new());
    };

    serde_json::from_str::<Vec<LlmProviderConfig>>(&raw)
        .map_err(|error| LlmServiceError::Config(format!("模型配置格式无效: {error}")))
}

pub fn select_provider(
    providers: &[LlmProviderConfig],
    requested_id: Option<&str>,
) -> Result<LlmProviderConfig, LlmServiceError> {
    if providers.is_empty() {
        return Err(LlmServiceError::Config(
            "请先在设置中配置至少一个大语言模型提供商".to_string(),
        ));
    }

    if let Some(provider_id) = requested_id.filter(|value| !value.trim().is_empty()) {
        return providers
            .iter()
            .find(|provider| provider.id == provider_id)
            .cloned()
            .ok_or_else(|| {
                LlmServiceError::Config(format!("未找到指定的大语言模型配置: {provider_id}"))
            });
    }

    providers
        .iter()
        .find(|provider| provider.is_default)
        .or_else(|| providers.first())
        .cloned()
        .ok_or_else(|| LlmServiceError::Config("没有可用的大语言模型配置".to_string()))
}

pub fn build_provider(
    config: LlmProviderConfig,
) -> Result<Box<dyn LlmProvider>, LlmServiceError> {
    validate_provider_config(&config)?;

    match config.provider_type {
        LlmProviderType::OpenAiCompatible => Ok(Box::new(OpenAiCompatibleProvider::new(config))),
        LlmProviderType::Anthropic => Ok(Box::new(AnthropicProvider::new(config))),
    }
}

fn validate_provider_config(config: &LlmProviderConfig) -> Result<(), LlmServiceError> {
    if config.name.trim().is_empty() {
        return Err(LlmServiceError::Config("模型配置名称不能为空".to_string()));
    }
    if config.model.trim().is_empty() {
        return Err(LlmServiceError::Config("模型名称不能为空".to_string()));
    }
    if config.api_key.trim().is_empty() {
        return Err(LlmServiceError::Config("API Key 不能为空".to_string()));
    }

    Ok(())
}

struct OpenAiCompatibleProvider {
    client: Client,
    config: LlmProviderConfig,
}

impl OpenAiCompatibleProvider {
    fn new(config: LlmProviderConfig) -> Self {
        Self {
            client: Client::new(),
            config,
        }
    }

    fn base_url(&self) -> String {
        self.config
            .base_url
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("https://api.openai.com/v1")
            .trim_end_matches('/')
            .to_string()
    }
}

impl LlmProvider for OpenAiCompatibleProvider {
    fn config(&self) -> &LlmProviderConfig {
        &self.config
    }

    fn test_connection<'a>(
        &'a self,
    ) -> Pin<Box<dyn Future<Output = Result<(), LlmServiceError>> + Send + 'a>> {
        Box::pin(async move {
            let response = self
                .client
                .post(format!("{}/chat/completions", self.base_url()))
                .header(AUTHORIZATION, format!("Bearer {}", self.config.api_key.trim()))
                .header(CONTENT_TYPE, "application/json")
                .json(&json!({
                    "model": self.config.model,
                    "max_tokens": 1,
                    "temperature": 0,
                    "messages": [
                        { "role": "user", "content": "ping" }
                    ]
                }))
                .send()
                .await
                .map_err(map_request_error)?;

            let json = ensure_success(response).await?;
            extract_openai_text(&json).map(|_| ())
        })
    }

    fn generate<'a>(
        &'a self,
        system_prompt: &'a str,
        user_prompt: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<String, LlmServiceError>> + Send + 'a>> {
        Box::pin(async move {
            let response = self
                .client
                .post(format!("{}/chat/completions", self.base_url()))
                .header(AUTHORIZATION, format!("Bearer {}", self.config.api_key.trim()))
                .header(CONTENT_TYPE, "application/json")
                .json(&json!({
                    "model": self.config.model,
                    "temperature": 0.2,
                    "messages": [
                        { "role": "system", "content": system_prompt },
                        { "role": "user", "content": user_prompt }
                    ]
                }))
                .send()
                .await
                .map_err(map_request_error)?;

            let json = ensure_success(response).await?;
            extract_openai_text(&json)
        })
    }
}

struct AnthropicProvider {
    client: Client,
    config: LlmProviderConfig,
}

impl AnthropicProvider {
    fn new(config: LlmProviderConfig) -> Self {
        Self {
            client: Client::new(),
            config,
        }
    }

    fn base_url(&self) -> String {
        self.config
            .base_url
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("https://api.anthropic.com/v1")
            .trim_end_matches('/')
            .to_string()
    }
}

impl LlmProvider for AnthropicProvider {
    fn config(&self) -> &LlmProviderConfig {
        &self.config
    }

    fn test_connection<'a>(
        &'a self,
    ) -> Pin<Box<dyn Future<Output = Result<(), LlmServiceError>> + Send + 'a>> {
        Box::pin(async move {
            let response = self
                .client
                .post(format!("{}/messages", self.base_url()))
                .header("x-api-key", self.config.api_key.trim())
                .header("anthropic-version", ANTHROPIC_VERSION)
                .header(CONTENT_TYPE, "application/json")
                .json(&json!({
                    "model": self.config.model,
                    "max_tokens": 1,
                    "messages": [
                        {
                            "role": "user",
                            "content": "ping"
                        }
                    ]
                }))
                .send()
                .await
                .map_err(map_request_error)?;

            let json = ensure_success(response).await?;
            extract_anthropic_text(&json).map(|_| ())
        })
    }

    fn generate<'a>(
        &'a self,
        system_prompt: &'a str,
        user_prompt: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<String, LlmServiceError>> + Send + 'a>> {
        Box::pin(async move {
            let response = self
                .client
                .post(format!("{}/messages", self.base_url()))
                .header("x-api-key", self.config.api_key.trim())
                .header("anthropic-version", ANTHROPIC_VERSION)
                .header(CONTENT_TYPE, "application/json")
                .json(&json!({
                    "model": self.config.model,
                    "max_tokens": 1800,
                    "temperature": 0.2,
                    "system": system_prompt,
                    "messages": [
                        {
                            "role": "user",
                            "content": user_prompt
                        }
                    ]
                }))
                .send()
                .await
                .map_err(map_request_error)?;

            let json = ensure_success(response).await?;
            extract_anthropic_text(&json)
        })
    }
}

async fn ensure_success(
    response: reqwest::Response,
) -> Result<serde_json::Value, LlmServiceError> {
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| LlmServiceError::Response(format!("读取模型响应失败: {error}")))?;

    if !status.is_success() {
        return Err(LlmServiceError::Request(format!(
            "模型请求失败（{}）: {}",
            status,
            truncate_message(&body)
        )));
    }

    serde_json::from_str::<serde_json::Value>(&body)
        .map_err(|error| LlmServiceError::Response(format!("解析模型响应失败: {error}")))
}

fn extract_openai_text(json: &serde_json::Value) -> Result<String, LlmServiceError> {
    let content = json
        .get("choices")
        .and_then(|choices| choices.as_array())
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"));

    extract_string_or_parts(content).ok_or_else(|| {
        LlmServiceError::Response("OpenAI 兼容模型未返回可用的文本内容".to_string())
    })
}

fn extract_anthropic_text(json: &serde_json::Value) -> Result<String, LlmServiceError> {
    let content = json.get("content");
    extract_string_or_parts(content).ok_or_else(|| {
        LlmServiceError::Response("Anthropic 模型未返回可用的文本内容".to_string())
    })
}

fn extract_string_or_parts(value: Option<&serde_json::Value>) -> Option<String> {
    match value {
        Some(serde_json::Value::String(text)) => {
            let trimmed = text.trim();
            (!trimmed.is_empty()).then(|| trimmed.to_string())
        }
        Some(serde_json::Value::Array(parts)) => {
            let text = parts
                .iter()
                .filter_map(|item| {
                    item.get("text")
                        .and_then(|value| value.as_str())
                        .map(str::trim)
                })
                .filter(|text| !text.is_empty())
                .collect::<Vec<_>>()
                .join("\n\n");

            (!text.trim().is_empty()).then(|| text)
        }
        _ => None,
    }
}

fn map_request_error(error: reqwest::Error) -> LlmServiceError {
    if error.is_timeout() {
        return LlmServiceError::Request("连接模型服务超时，请稍后重试".to_string());
    }

    LlmServiceError::Request(format!("连接模型服务失败: {error}"))
}

fn truncate_message(message: &str) -> String {
    const LIMIT: usize = 320;
    if message.len() <= LIMIT {
        return message.trim().to_string();
    }

    format!("{}...", message[..LIMIT].trim())
}
