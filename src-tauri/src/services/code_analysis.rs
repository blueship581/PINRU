use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use crate::db::models::{AnalyzedFileSnippet, CodeAnalysisSummary};

const MAX_DEPTH: usize = 5;
const MAX_TRACKED_FILES: usize = 240;
const MAX_TREE_ENTRIES: usize = 72;
const MAX_KEY_FILES: usize = 6;
const MAX_SNIPPET_LINES: usize = 60;
const MAX_SNIPPET_CHARS: usize = 2200;
const MAX_FILE_SIZE_BYTES: u64 = 48 * 1024;

const IGNORED_DIRS: &[&str] = &[
    ".git",
    ".idea",
    ".vscode",
    ".next",
    ".turbo",
    "node_modules",
    "dist",
    "build",
    "coverage",
    "target",
    "__pycache__",
];

#[derive(Debug, thiserror::Error)]
pub enum CodeAnalysisError {
    #[error("未找到可分析的代码目录，请确认任务已经完成 Clone")]
    RepoMissing,
    #[error("代码扫描失败: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone)]
struct FileEntry {
    relative_path: String,
    absolute_path: PathBuf,
}

pub fn analyze_repository(base_path: &str) -> Result<CodeAnalysisSummary, CodeAnalysisError> {
    let expanded = expand_tilde(base_path);
    let base = PathBuf::from(expanded);
    let repo_root = resolve_repo_root(&base)?;

    let mut files = Vec::new();
    collect_files(&repo_root, &repo_root, 0, &mut files)?;

    files.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));

    let total_files = files.len();
    let file_tree = files
        .iter()
        .take(MAX_TREE_ENTRIES)
        .map(|entry| format_tree_line(&entry.relative_path))
        .collect::<Vec<_>>();

    let detected_stack = detect_stack(&files);
    let key_files = collect_key_files(&files)?;

    Ok(CodeAnalysisSummary {
        repo_path: repo_root.display().to_string(),
        total_files,
        detected_stack,
        file_tree,
        key_files,
    })
}

fn resolve_repo_root(base: &Path) -> Result<PathBuf, CodeAnalysisError> {
    if base.join("ORIGIN").is_dir() {
        return Ok(base.join("ORIGIN"));
    }

    if base.join("origin").is_dir() {
        return Ok(base.join("origin"));
    }

    if base.join(".git").exists() {
        return Ok(base.to_path_buf());
    }

    if base.is_dir() {
        let mut child_dirs = fs::read_dir(base)?
            .filter_map(Result::ok)
            .filter(|entry| entry.path().is_dir())
            .map(|entry| entry.path())
            .collect::<Vec<_>>();
        child_dirs.sort();

        if let Some(repo_dir) = child_dirs.iter().find(|path| path.join(".git").exists()) {
            return Ok(repo_dir.clone());
        }

        if let Some(first_dir) = child_dirs.into_iter().next() {
            return Ok(first_dir);
        }
    }

    Err(CodeAnalysisError::RepoMissing)
}

fn collect_files(
    root: &Path,
    current: &Path,
    depth: usize,
    files: &mut Vec<FileEntry>,
) -> Result<(), CodeAnalysisError> {
    if depth > MAX_DEPTH || files.len() >= MAX_TRACKED_FILES {
        return Ok(());
    }

    let mut entries = fs::read_dir(current)?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        if files.len() >= MAX_TRACKED_FILES {
            break;
        }

        let path = entry.path();
        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();

        if path.is_dir() {
            if IGNORED_DIRS.iter().any(|ignored| *ignored == file_name) {
                continue;
            }
            collect_files(root, &path, depth + 1, files)?;
            continue;
        }

        if !path.is_file() || !is_text_candidate(&path) {
            continue;
        }

        let relative_path = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");

        files.push(FileEntry {
            relative_path,
            absolute_path: path,
        });
    }

    Ok(())
}

fn detect_stack(files: &[FileEntry]) -> Vec<String> {
    let paths = files
        .iter()
        .map(|entry| entry.relative_path.as_str())
        .collect::<BTreeSet<_>>();

    let mut stack = Vec::new();

    if paths.contains("package.json") {
        stack.push("Node.js".to_string());
    }
    if paths.contains("pnpm-lock.yaml") || paths.contains("yarn.lock") || paths.contains("package-lock.json") {
        stack.push("JavaScript 包管理".to_string());
    }
    if paths.contains("tsconfig.json") || files.iter().any(|entry| entry.relative_path.ends_with(".ts") || entry.relative_path.ends_with(".tsx")) {
        stack.push("TypeScript".to_string());
    }
    if files.iter().any(|entry| entry.relative_path.ends_with(".tsx")) {
        stack.push("React".to_string());
    }
    if paths.contains("Cargo.toml") {
        stack.push("Rust".to_string());
    }
    if files.iter().any(|entry| entry.relative_path.ends_with(".rs")) {
        stack.push("Rust 源码".to_string());
    }
    if paths.contains("pyproject.toml") || paths.contains("requirements.txt") {
        stack.push("Python".to_string());
    }
    if paths.contains("go.mod") {
        stack.push("Go".to_string());
    }
    if paths.contains("pom.xml") || paths.contains("build.gradle") {
        stack.push("JVM".to_string());
    }
    if paths.contains("Dockerfile") || files.iter().any(|entry| entry.relative_path.ends_with(".dockerfile")) {
        stack.push("Docker".to_string());
    }

    if stack.is_empty() {
        stack.push("待识别项目".to_string());
    }

    stack
}

fn collect_key_files(files: &[FileEntry]) -> Result<Vec<AnalyzedFileSnippet>, CodeAnalysisError> {
    let mut sorted = files.to_vec();
    sorted.sort_by(|a, b| {
        file_priority(&a.relative_path)
            .cmp(&file_priority(&b.relative_path))
            .then_with(|| a.relative_path.len().cmp(&b.relative_path.len()))
            .then_with(|| a.relative_path.cmp(&b.relative_path))
    });

    let mut selected = Vec::new();
    for entry in sorted.into_iter().take(MAX_KEY_FILES) {
        let metadata = fs::metadata(&entry.absolute_path)?;
        if metadata.len() > MAX_FILE_SIZE_BYTES {
            continue;
        }

        let snippet = read_snippet(&entry.absolute_path)?;
        if snippet.is_empty() {
            continue;
        }

        selected.push(AnalyzedFileSnippet {
            path: entry.relative_path,
            snippet,
        });
    }

    Ok(selected)
}

fn file_priority(relative_path: &str) -> usize {
    let file_name = Path::new(relative_path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(relative_path);

    match relative_path {
        "README.md" => 0,
        "package.json" => 1,
        "Cargo.toml" => 2,
        "tsconfig.json" => 3,
        "vite.config.ts" | "vite.config.js" => 4,
        "src/main.tsx" | "src/main.ts" | "src/main.rs" => 5,
        "src/App.tsx" | "src/App.ts" | "src/lib.rs" => 6,
        _ => match file_name {
            "README.md" => 7,
            "package.json" => 8,
            "Cargo.toml" => 9,
            "tsconfig.json" => 10,
            _ if relative_path.starts_with("src/") => 20,
            _ => 50,
        },
    }
}

fn read_snippet(path: &Path) -> Result<String, CodeAnalysisError> {
    let content = fs::read_to_string(path)?;
    let mut snippet = String::new();

    for line in content.lines().take(MAX_SNIPPET_LINES) {
        if snippet.len() + line.len() + 1 > MAX_SNIPPET_CHARS {
            break;
        }
        snippet.push_str(line);
        snippet.push('\n');
    }

    Ok(snippet.trim().to_string())
}

fn format_tree_line(relative_path: &str) -> String {
    let depth = relative_path.matches('/').count();
    let indent = "  ".repeat(depth);
    let file_name = Path::new(relative_path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(relative_path);

    format!("{indent}- {file_name} ({relative_path})")
}

fn is_text_candidate(path: &Path) -> bool {
    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase());

    match extension.as_deref() {
        Some(
            "ts" | "tsx" | "js" | "jsx" | "json" | "rs" | "py" | "go" | "java" | "kt"
            | "swift" | "m" | "mm" | "md" | "txt" | "yml" | "yaml" | "toml" | "css"
            | "scss" | "less" | "html" | "xml" | "sql" | "sh" | "rb" | "php" | "c"
            | "cc" | "cpp" | "h" | "hpp" | "vue"
        ) => true,
        None => matches!(
            path.file_name().and_then(|name| name.to_str()),
            Some("Dockerfile") | Some("Makefile")
        ),
        _ => false,
    }
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
