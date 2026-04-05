use git2::{
    build::CheckoutBuilder, BranchType, Cred, IndexAddOption, PushOptions,
    RemoteCallbacks, Repository, Signature, StatusOptions,
};
use std::ffi::OsStr;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const EXCLUDED_DIRS: &[&str] = &["node_modules", "dist", "dist-ssr", ".git"];
const EXCLUDED_FILES: &[&str] = &[".DS_Store"];

#[derive(Debug, thiserror::Error)]
#[allow(dead_code)]
pub enum GitOpsError {
    #[error("Git error: {0}")]
    Git(#[from] git2::Error),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Path error: {0}")]
    Path(String),
}

/// Check which paths already exist from a list. Returns the existing ones.
pub fn check_paths_exist(paths: &[String]) -> Vec<String> {
    paths
        .iter()
        .filter(|p| {
            let expanded = expand_tilde(p);
            Path::new(&expanded).exists()
        })
        .cloned()
        .collect()
}

/// Clone a repo using the git CLI with `--progress`, calling `on_progress` for
/// each line of stderr so the caller can forward it to the frontend.
pub fn clone_repo_with_progress(
    url: &str,
    path: &str,
    username: &str,
    token: &str,
    on_progress: impl Fn(&str),
) -> Result<(), GitOpsError> {
    let expanded = expand_tilde(path);
    let target_path = Path::new(&expanded);

    if target_path.exists() {
        let folder_name = target_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(path);
        return Err(GitOpsError::Path(format!(
            "目标目录「{}」已存在，请先删除或更换目录",
            folder_name
        )));
    }

    if let Some(parent) = target_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    // Build an authenticated URL: https://user:token@host/path.git
    let auth_url = build_auth_url(url, username, token);

    on_progress("正在启动 git clone …");

    let mut child = Command::new("git")
        .args(["clone", "--depth", "1", "--progress", &auth_url])
        .arg(&expanded)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| GitOpsError::Path(format!("无法启动 git 命令: {e}")))?;

    // git clone writes progress to stderr
    if let Some(stderr) = child.stderr.take() {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(line) = line {
                // Strip credentials from any echoed URL
                let safe = line.replace(&auth_url, url);
                on_progress(&safe);
            }
        }
    }

    let status = child.wait()?;
    if !status.success() {
        return Err(GitOpsError::Path(format!(
            "git clone 退出码 {}，克隆失败",
            status.code().unwrap_or(-1)
        )));
    }

    on_progress("克隆完成");
    Ok(())
}

/// Insert `user:token@` into an HTTPS URL right after the scheme.
fn build_auth_url(url: &str, username: &str, token: &str) -> String {
    if let Some(rest) = url.strip_prefix("https://") {
        format!("https://{}:{}@{}", username, token, rest)
    } else if let Some(rest) = url.strip_prefix("http://") {
        format!("http://{}:{}@{}", username, token, rest)
    } else {
        url.to_string()
    }
}

pub fn copy_project_directory(source_path: &str, destination_path: &str) -> Result<(), GitOpsError> {
    let expanded_source = expand_tilde(source_path);
    let expanded_destination = expand_tilde(destination_path);
    let source = Path::new(&expanded_source);
    let destination = Path::new(&expanded_destination);

    if !source.exists() {
        return Err(GitOpsError::Path(format!(
            "源目录不存在: {}",
            source.display()
        )));
    }

    if destination.exists() {
        let folder_name = destination
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(destination_path);
        return Err(GitOpsError::Path(format!(
            "目标目录「{}」已存在，请先删除或更换目录",
            folder_name
        )));
    }

    std::fs::create_dir_all(destination)?;
    copy_dir_contents_recursive(source, destination, CopyMode::Workspace)?;
    Ok(())
}

pub fn workspace_path(target_repo: &str) -> PathBuf {
    let sanitized = target_repo
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>();

    std::env::temp_dir().join(format!("pinru-github-pr-{sanitized}"))
}

pub fn recreate_workspace(
    path: &Path,
    remote_url: &str,
    author_name: &str,
    author_email: &str,
) -> Result<(), GitOpsError> {
    if path.exists() {
        std::fs::remove_dir_all(path)?;
    }

    std::fs::create_dir_all(path)?;
    let repo = Repository::init(path)?;
    configure_user(&repo, author_name, author_email)?;
    repo.remote("origin", remote_url)?;

    Ok(())
}

pub fn create_or_reset_branch_from(
    path: &Path,
    branch_name: &str,
    base_branch: &str,
) -> Result<(), GitOpsError> {
    let repo = Repository::open(path)?;
    checkout_branch(&repo, base_branch)?;

    if let Ok(mut existing_branch) = repo.find_branch(branch_name, BranchType::Local) {
        existing_branch.delete()?;
    }

    let base_commit = repo
        .find_branch(base_branch, BranchType::Local)?
        .get()
        .peel_to_commit()?;
    repo.branch(branch_name, &base_commit, true)?;
    checkout_branch(&repo, branch_name)?;
    clear_workspace_contents(path)?;

    Ok(())
}

pub fn copy_project_contents(source: &Path, destination: &Path) -> Result<(), GitOpsError> {
    if !source.exists() {
        return Err(GitOpsError::Path(format!(
            "源目录不存在: {}",
            source.display()
        )));
    }

    copy_dir_contents_recursive(source, destination, CopyMode::Publish)?;
    Ok(())
}

pub fn commit_all(
    path: &Path,
    branch_name: &str,
    author_name: &str,
    author_email: &str,
    commit_message: &str,
) -> Result<bool, GitOpsError> {
    let repo = Repository::open(path)?;
    configure_user(&repo, author_name, author_email)?;
    ensure_checked_out(&repo, branch_name)?;

    if !has_worktree_changes(&repo)? {
        return Ok(false);
    }

    let mut index = repo.index()?;
    index.add_all(["*"].iter(), IndexAddOption::DEFAULT, None)?;
    index.write()?;

    let tree_id = index.write_tree()?;
    let tree = repo.find_tree(tree_id)?;
    let signature = Signature::now(author_name, author_email)?;
    let parent_commit = repo
        .head()
        .ok()
        .and_then(|head| head.target())
        .and_then(|oid| repo.find_commit(oid).ok());

    match parent_commit {
        Some(parent) => {
            repo.commit(
                Some("HEAD"),
                &signature,
                &signature,
                commit_message,
                &tree,
                &[&parent],
            )?;
        }
        None => {
            repo.commit(
                Some("HEAD"),
                &signature,
                &signature,
                commit_message,
                &tree,
                &[],
            )?;
        }
    }

    Ok(true)
}

pub fn ensure_branch_exists(path: &Path, branch_name: &str) -> Result<(), GitOpsError> {
    let repo = Repository::open(path)?;
    if repo.find_branch(branch_name, BranchType::Local).is_ok() {
        return Ok(());
    }

    let head_commit = repo.head()?.peel_to_commit()?;
    repo.branch(branch_name, &head_commit, true)?;
    Ok(())
}

pub fn push_branch(
    path: &Path,
    branch_name: &str,
    username: &str,
    token: &str,
) -> Result<(), GitOpsError> {
    let repo = Repository::open(path)?;
    let mut remote = repo.find_remote("origin")?;
    let mut callbacks = RemoteCallbacks::new();
    let username = username.to_string();
    let token = token.to_string();

    callbacks.credentials(move |_url, username_from_url, _allowed_types| {
        Cred::userpass_plaintext(username_from_url.unwrap_or(&username), &token)
    });

    let mut push_options = PushOptions::new();
    push_options.remote_callbacks(callbacks);

    let refspec = format!("refs/heads/{branch_name}:refs/heads/{branch_name}");
    remote.push(&[refspec.as_str()], Some(&mut push_options))?;

    Ok(())
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

fn configure_user(
    repo: &Repository,
    author_name: &str,
    author_email: &str,
) -> Result<(), GitOpsError> {
    let mut config = repo.config()?;
    config.set_str("user.name", author_name)?;
    config.set_str("user.email", author_email)?;
    Ok(())
}

fn checkout_branch(repo: &Repository, branch_name: &str) -> Result<(), GitOpsError> {
    let reference_name = format!("refs/heads/{branch_name}");
    ensure_checked_out(repo, branch_name)?;
    let object = repo.revparse_single(&reference_name)?;
    let mut checkout = CheckoutBuilder::new();
    checkout.force();
    repo.checkout_tree(&object, Some(&mut checkout))?;
    repo.set_head(&reference_name)?;
    Ok(())
}

fn ensure_checked_out(repo: &Repository, branch_name: &str) -> Result<(), GitOpsError> {
    let current_branch = repo
        .head()
        .ok()
        .and_then(|head| head.shorthand().map(str::to_string));

    if current_branch.as_deref() == Some(branch_name) {
        return Ok(());
    }

    if repo.find_branch(branch_name, BranchType::Local).is_err() {
        let head_commit = repo
            .head()
            .ok()
            .and_then(|head| head.target())
            .and_then(|oid| repo.find_commit(oid).ok())
            .ok_or_else(|| {
                GitOpsError::Path(format!("本地仓库缺少分支 {branch_name}，且没有可用的 HEAD"))
            })?;
        repo.branch(branch_name, &head_commit, true)?;
    }

    Ok(())
}

fn clear_workspace_contents(path: &Path) -> Result<(), GitOpsError> {
    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        let entry_path = entry.path();
        let Some(name) = entry_path.file_name().and_then(OsStr::to_str) else {
            continue;
        };

        if name == ".git" {
            continue;
        }

        if entry.file_type()?.is_dir() {
            std::fs::remove_dir_all(entry_path)?;
        } else {
            std::fs::remove_file(entry_path)?;
        }
    }

    Ok(())
}

#[derive(Clone, Copy)]
enum CopyMode {
    Workspace,
    Publish,
}

fn copy_dir_contents_recursive(
    source: &Path,
    destination: &Path,
    mode: CopyMode,
) -> Result<(), std::io::Error> {
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let file_name = entry.file_name();
        let file_type = entry.file_type()?;

        if should_skip(&file_name, file_type.is_dir(), mode) {
            continue;
        }

        let destination_path = destination.join(&file_name);
        if file_type.is_dir() {
            std::fs::create_dir_all(&destination_path)?;
            copy_dir_contents_recursive(&source_path, &destination_path, mode)?;
        } else {
            if let Some(parent) = destination_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::copy(&source_path, &destination_path)?;
        }
    }

    Ok(())
}

fn should_skip(file_name: &OsStr, is_dir: bool, mode: CopyMode) -> bool {
    let Some(name) = file_name.to_str() else {
        return false;
    };

    if is_dir {
        return match mode {
            CopyMode::Workspace => name == ".git",
            CopyMode::Publish => EXCLUDED_DIRS.contains(&name),
        };
    }

    if EXCLUDED_FILES.contains(&name) {
        return true;
    }

    if matches!(mode, CopyMode::Publish) && name.ends_with(".log") {
        return true;
    }

    if matches!(mode, CopyMode::Workspace) && name == ".git" {
        return true;
    }

    false
}

fn has_worktree_changes(repo: &Repository) -> Result<bool, GitOpsError> {
    let mut options = StatusOptions::new();
    options
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true);

    let statuses = repo.statuses(Some(&mut options))?;
    Ok(!statuses.is_empty())
}
