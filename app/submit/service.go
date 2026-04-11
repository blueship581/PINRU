package submit

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/blueship581/pinru/internal/github"
	"github.com/blueship581/pinru/internal/gitops"
	"github.com/blueship581/pinru/internal/store"
	"github.com/blueship581/pinru/internal/util"
)

const mainBranch = "main"

// Service handles publishing source repos and creating model PRs on GitHub.
type SubmitService struct {
	store *store.Store
}

// NewService creates a new submit service.
func New(store *store.Store) *SubmitService {
	return &SubmitService{store: store}
}

// PublishSourceRepoRequest describes a source-repo publish operation.
type PublishSourceRepoRequest struct {
	GitHubAccountID string `json:"githubAccountId"`
	TaskID          string `json:"taskId"`
	ModelName       string `json:"modelName"`
	TargetRepo      string `json:"targetRepo"`
	GitHubUsername  string `json:"githubUsername"`
	GitHubToken     string `json:"githubToken"`
}

// PublishSourceRepoResult holds the result of a source-repo publish.
type PublishSourceRepoResult struct {
	BranchName string `json:"branchName"`
	RepoURL    string `json:"repoUrl"`
}

// SubmitModelRunRequest describes a model-run PR submission.
type SubmitModelRunRequest struct {
	GitHubAccountID string `json:"githubAccountId"`
	TaskID          string `json:"taskId"`
	ModelName       string `json:"modelName"`
	TargetRepo      string `json:"targetRepo"`
	GitHubUsername  string `json:"githubUsername"`
	GitHubToken     string `json:"githubToken"`
}

// SubmitModelRunResult holds the result of a model-run PR submission.
type SubmitModelRunResult struct {
	BranchName string `json:"branchName"`
	PrURL      string `json:"prUrl"`
}

// SubmitAllRequest describes a combined source-push + all-model-PR operation.
type SubmitAllRequest struct {
	GitHubAccountID string   `json:"githubAccountId"`
	TaskID          string   `json:"taskId"`
	Models          []string `json:"models"` // selected non-ORIGIN model names
	TargetRepo      string   `json:"targetRepo"`
	SourceModelName string   `json:"sourceModelName"`
	GitHubUsername  string   `json:"githubUsername"`
	GitHubToken     string   `json:"githubToken"`
}

// ModelSubmitResult is the per-model outcome within a SubmitAll call.
type ModelSubmitResult struct {
	ModelName string `json:"modelName"`
	PrURL     string `json:"prUrl"`
	Error     string `json:"error"`
}

// SubmitAllResult aggregates source and model submission results.
type SubmitAllResult struct {
	RepoURL   string              `json:"repoUrl"`
	RepoError string              `json:"repoError"`
	Models    []ModelSubmitResult `json:"models"`
}

func (s *SubmitService) PublishSourceRepo(req PublishSourceRepoRequest) (*PublishSourceRepoResult, error) {
	if err := validatePublishRequest(req); err != nil {
		return nil, err
	}

	task, err := s.store.GetTask(req.TaskID)
	if err != nil || task == nil {
		return nil, fmt.Errorf("未找到任务: %s", req.TaskID)
	}

	sourceRun, err := s.store.GetModelRun(req.TaskID, req.ModelName)
	if err != nil || sourceRun == nil {
		return nil, fmt.Errorf("未找到模型记录: %s / %s", req.TaskID, req.ModelName)
	}
	if sourceRun.LocalPath == nil {
		return nil, fmt.Errorf("源码文件夹缺少本地仓库路径，无法上传源码")
	}
	sourcePath := util.ExpandTilde(*sourceRun.LocalPath)

	authUsername, authToken, err := s.resolveGitHubCredentials(req.GitHubAccountID, req.GitHubUsername, req.GitHubToken)
	if err != nil {
		return nil, err
	}

	ghUser, err := github.GetAuthenticatedUser(authToken)
	if err != nil {
		return nil, fmt.Errorf("GitHub 认证失败: %w", err)
	}
	authorEmail := fmt.Sprintf("%s@users.noreply.github.com", ghUser.Login)
	if ghUser.Email != nil {
		authorEmail = *ghUser.Email
	}

	repo, err := github.EnsureRepository(strings.TrimSpace(req.TargetRepo), authToken, &task.ProjectName)
	if err != nil {
		return nil, fmt.Errorf("确保 GitHub 仓库可用失败: %w", err)
	}

	workspacePath := gitops.WorkspacePath(strings.TrimSpace(req.TargetRepo))
	remoteURL := fmt.Sprintf("https://github.com/%s.git", strings.TrimSpace(req.TargetRepo))

	if err := gitops.RecreateWorkspace(workspacePath, remoteURL, ghUser.Login, authorEmail); err != nil {
		return nil, fmt.Errorf("Git 操作失败: %w", err)
	}
	if err := gitops.CopyProjectContents(sourcePath, workspacePath); err != nil {
		return nil, fmt.Errorf("Git 操作失败: %w", err)
	}
	committed, err := gitops.CommitAll(workspacePath, mainBranch, ghUser.Login, authorEmail, "init: 原始项目初始化")
	if err != nil {
		return nil, fmt.Errorf("Git 操作失败: %w", err)
	}
	if !committed {
		return nil, fmt.Errorf("源码目录没有可提交的文件")
	}
	if err := gitops.EnsureBranch(workspacePath, mainBranch); err != nil {
		return nil, fmt.Errorf("Git 操作失败: %w", err)
	}
	if err := gitops.PushBranch(workspacePath, mainBranch, authUsername, authToken); err != nil {
		return nil, fmt.Errorf("Git 推送失败: %w", err)
	}

	if err := github.SetDefaultBranch(strings.TrimSpace(req.TargetRepo), mainBranch, authToken); err != nil {
		return nil, fmt.Errorf("设置默认分支失败: %w", err)
	}

	return &PublishSourceRepoResult{
		BranchName: mainBranch,
		RepoURL:    repo.HTMLURL,
	}, nil
}

func (s *SubmitService) SubmitModelRun(req SubmitModelRunRequest) (*SubmitModelRunResult, error) {
	if err := validateSubmitRequest(req); err != nil {
		return nil, err
	}

	_, err := s.store.GetTask(req.TaskID)
	if err != nil {
		return nil, fmt.Errorf("未找到任务: %s", req.TaskID)
	}

	modelRun, err := s.store.GetModelRun(req.TaskID, req.ModelName)
	if err != nil || modelRun == nil {
		return nil, fmt.Errorf("未找到模型记录: %s / %s", req.TaskID, req.ModelName)
	}
	if modelRun.LocalPath == nil {
		return nil, fmt.Errorf("模型副本缺少本地目录，无法创建 PR")
	}
	modelPath := util.ExpandTilde(*modelRun.LocalPath)

	workspacePath := gitops.WorkspacePath(strings.TrimSpace(req.TargetRepo))
	if _, err := os.Stat(workspacePath); os.IsNotExist(err) {
		return nil, fmt.Errorf("源码尚未上传，请先执行源码上传步骤后再创建模型 PR")
	}

	authUsername, authToken, err := s.resolveGitHubCredentials(req.GitHubAccountID, req.GitHubUsername, req.GitHubToken)
	if err != nil {
		return nil, err
	}

	ghUser, err := github.GetAuthenticatedUser(authToken)
	if err != nil {
		return nil, fmt.Errorf("GitHub 认证失败: %w", err)
	}
	authorEmail := fmt.Sprintf("%s@users.noreply.github.com", ghUser.Login)
	if ghUser.Email != nil {
		authorEmail = *ghUser.Email
	}

	branchName := strings.TrimSpace(req.ModelName)
	now := time.Now().Unix()
	if err := s.store.UpdateModelRun(req.TaskID, req.ModelName, "running", &branchName, nil, &now, nil); err != nil {
		return nil, fmt.Errorf("模型状态写回失败: %w", err)
	}

	if err := gitops.CreateOrResetBranch(workspacePath, branchName, mainBranch); err != nil {
		return nil, s.failModelRun(req.TaskID, req.ModelName, &branchName, now, fmt.Errorf("Git 操作失败: %w", err))
	}
	if err := gitops.CopyProjectContents(modelPath, workspacePath); err != nil {
		return nil, s.failModelRun(req.TaskID, req.ModelName, &branchName, now, fmt.Errorf("Git 操作失败: %w", err))
	}
	commitMsg := fmt.Sprintf("feat: %s 模型实现", branchName)
	committed, err := gitops.CommitAll(workspacePath, branchName, ghUser.Login, authorEmail, commitMsg)
	if err != nil {
		return nil, s.failModelRun(req.TaskID, req.ModelName, &branchName, now, fmt.Errorf("Git 操作失败: %w", err))
	}
	if !committed {
		return nil, s.failModelRun(req.TaskID, req.ModelName, &branchName, now, fmt.Errorf("模型 %s 与源码 main 无差异，无法创建 PR", branchName))
	}

	if err := gitops.PushBranch(workspacePath, branchName, authUsername, authToken); err != nil {
		return nil, s.failModelRun(req.TaskID, req.ModelName, &branchName, now, fmt.Errorf("Git 推送失败: %w", err))
	}

	repoOwner := strings.SplitN(strings.TrimSpace(req.TargetRepo), "/", 2)[0]
	prURL, err := github.EnsurePullRequest(
		strings.TrimSpace(req.TargetRepo), repoOwner, branchName, branchName, branchName,
		authToken)
	if err != nil {
		return nil, s.failModelRun(req.TaskID, req.ModelName, &branchName, now, fmt.Errorf("GitHub PR 创建失败: %w", err))
	}

	finishedAt := time.Now().Unix()
	if err := s.persistModelRunState(req.TaskID, req.ModelName, "done", &branchName, &prURL, &now, &finishedAt, stringPtr(""), nil); err != nil {
		return nil, fmt.Errorf("PR 已创建，但模型状态写回失败: %w", err)
	}

	return &SubmitModelRunResult{BranchName: branchName, PrURL: prURL}, nil
}

func (s *SubmitService) markErrorMsg(taskID, modelName string, branchName *string, errMsg string, startedAt int64) error {
	finishedAt := time.Now().Unix()
	return s.persistModelRunState(taskID, modelName, "error", branchName, nil, &startedAt, &finishedAt, &errMsg, nil)
}

func (s *SubmitService) failModelRun(taskID, modelName string, branchName *string, startedAt int64, cause error) error {
	errMsg := cause.Error()
	if markErr := s.markErrorMsg(taskID, modelName, branchName, errMsg, startedAt); markErr != nil {
		return fmt.Errorf("%w；模型状态写回失败: %v", cause, markErr)
	}
	return cause
}

func (s *SubmitService) SubmitAll(req SubmitAllRequest) (*SubmitAllResult, error) {
	if err := validateRepoAndAccount(req.TargetRepo, req.GitHubUsername, req.GitHubToken, req.GitHubAccountID); err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.TaskID) == "" {
		return nil, fmt.Errorf("任务不能为空")
	}

	task, err := s.store.GetTask(req.TaskID)
	if err != nil || task == nil {
		return nil, fmt.Errorf("未找到任务: %s", req.TaskID)
	}

	sourceModelName := strings.TrimSpace(req.SourceModelName)
	if sourceModelName == "" {
		sourceModelName = "ORIGIN"
	}

	sourceRun, err := s.store.GetModelRun(req.TaskID, sourceModelName)
	if err != nil || sourceRun == nil {
		return nil, fmt.Errorf("未找到源码记录 %s，请先在领题页下载项目", sourceModelName)
	}
	if sourceRun.LocalPath == nil {
		return nil, fmt.Errorf("源码记录 %s 缺少本地路径，无法推送源码", sourceModelName)
	}

	authUsername, token, err := s.resolveGitHubCredentials(req.GitHubAccountID, req.GitHubUsername, req.GitHubToken)
	if err != nil {
		return nil, err
	}

	targetRepo := strings.TrimSpace(req.TargetRepo)

	ghUser, err := github.GetAuthenticatedUser(token)
	if err != nil {
		return nil, fmt.Errorf("GitHub 认证失败: %w", err)
	}
	authorEmail := fmt.Sprintf("%s@users.noreply.github.com", ghUser.Login)
	if ghUser.Email != nil {
		authorEmail = *ghUser.Email
	}

	result := &SubmitAllResult{}
	now := time.Now().Unix()

	// ── Step 1: push configured source folder to main ──
	if err := s.persistModelRunState(req.TaskID, sourceModelName, "running", nil, nil, &now, nil, stringPtr(""), nil); err != nil {
		return nil, fmt.Errorf("源码记录状态写回失败: %w", err)
	}

	sourcePath := util.ExpandTilde(*sourceRun.LocalPath)
	repo, repoErr := github.EnsureRepository(targetRepo, token, &task.ProjectName)
	if repoErr == nil {
		workspacePath := gitops.WorkspacePath(targetRepo)
		remoteURL := fmt.Sprintf("https://github.com/%s.git", targetRepo)

		if err := gitops.RecreateWorkspace(workspacePath, remoteURL, ghUser.Login, authorEmail); err != nil {
			repoErr = fmt.Errorf("Git 操作失败: %w", err)
		} else if err := gitops.CopyProjectContents(sourcePath, workspacePath); err != nil {
			repoErr = fmt.Errorf("Git 操作失败: %w", err)
		} else {
			committed, err := gitops.CommitAll(workspacePath, mainBranch, ghUser.Login, authorEmail, "init: 原始项目初始化")
			if err != nil {
				repoErr = fmt.Errorf("Git 操作失败: %w", err)
			} else if !committed {
				repoErr = fmt.Errorf("源码目录没有可提交的文件")
			} else if err := gitops.EnsureBranch(workspacePath, mainBranch); err != nil {
				repoErr = fmt.Errorf("Git 操作失败: %w", err)
			} else if err := gitops.PushBranch(workspacePath, mainBranch, authUsername, token); err != nil {
				repoErr = fmt.Errorf("Git 推送失败: %w", err)
			}
			if repoErr == nil {
				if err := github.SetDefaultBranch(targetRepo, mainBranch, token); err != nil {
					repoErr = fmt.Errorf("设置默认分支失败: %w", err)
				}
			}
		}
	}

	if repoErr != nil {
		if err := s.failTaskAndModelRun(req.TaskID, "Error", sourceModelName, nil, now, repoErr); err != nil {
			return nil, err
		}
		result.RepoError = repoErr.Error()
		return result, nil
	}

	finishedAt := time.Now().Unix()
	repoURL := repo.HTMLURL
	if err := s.persistModelRunState(req.TaskID, sourceModelName, "done", nil, nil, &now, &finishedAt, stringPtr(""), &repoURL); err != nil {
		return nil, fmt.Errorf("源码记录状态写回失败: %w", err)
	}
	result.RepoURL = repoURL

	// ── Step 2: submit each model as PR ──
	workspacePath := gitops.WorkspacePath(targetRepo)
	repoOwner := strings.SplitN(targetRepo, "/", 2)[0]
	allOK := true

	for _, modelName := range req.Models {
		modelName = strings.TrimSpace(modelName)
		if modelName == "" {
			continue
		}
		if strings.EqualFold(modelName, "ORIGIN") || strings.EqualFold(modelName, sourceModelName) {
			continue
		}

		mResult := ModelSubmitResult{ModelName: modelName}

		// Ensure model_run exists
		run, err := s.store.GetModelRun(req.TaskID, modelName)
		if err != nil {
			return nil, fmt.Errorf("读取模型记录失败 %s: %w", modelName, err)
		}
		if run == nil {
			// Derive path from ORIGIN sibling
			var derivedPath *string
			if sourceRun.LocalPath != nil {
				lp := *sourceRun.LocalPath
				p := filepath.Join(filepath.Dir(lp), modelName)
				derivedPath = &p
			}
			newRun := store.ModelRun{
				ID:        fmt.Sprintf("%s-%s-%d", req.TaskID, modelName, time.Now().UnixNano()),
				TaskID:    req.TaskID,
				ModelName: modelName,
				LocalPath: derivedPath,
			}
			if err := s.store.CreateModelRun(newRun); err != nil {
				mResult.Error = fmt.Sprintf("创建模型记录失败: %v", err)
				result.Models = append(result.Models, mResult)
				allOK = false
				continue
			}
			run, err = s.store.GetModelRun(req.TaskID, modelName)
			if err != nil {
				mResult.Error = fmt.Sprintf("读取模型记录失败: %v", err)
				result.Models = append(result.Models, mResult)
				allOK = false
				continue
			}
		}

		if run == nil || run.LocalPath == nil {
			mResult.Error = "缺少本地路径，无法创建 PR"
			result.Models = append(result.Models, mResult)
			allOK = false
			continue
		}

		modelPath := util.ExpandTilde(*run.LocalPath)
		branchName := modelName
		mNow := time.Now().Unix()
		if err := s.persistModelRunState(req.TaskID, modelName, "running", &branchName, nil, &mNow, nil, stringPtr(""), nil); err != nil {
			mResult.Error = fmt.Sprintf("模型状态写回失败: %v", err)
			result.Models = append(result.Models, mResult)
			allOK = false
			continue
		}

		var mErr error
		if err := gitops.CreateOrResetBranch(workspacePath, branchName, mainBranch); err != nil {
			mErr = fmt.Errorf("Git 操作失败: %w", err)
		} else if err := gitops.CopyProjectContents(modelPath, workspacePath); err != nil {
			mErr = fmt.Errorf("Git 操作失败: %w", err)
		} else {
			commitMsg := fmt.Sprintf("feat: %s 模型实现", branchName)
			committed, err := gitops.CommitAll(workspacePath, branchName, ghUser.Login, authorEmail, commitMsg)
			if err != nil {
				mErr = fmt.Errorf("Git 操作失败: %w", err)
			} else if !committed {
				mErr = fmt.Errorf("与 main 无差异，无法创建 PR")
			} else if err := gitops.PushBranch(workspacePath, branchName, authUsername, token); err != nil {
				mErr = fmt.Errorf("Git 推送失败: %w", err)
			} else {
				prURL, err := github.EnsurePullRequest(targetRepo, repoOwner, branchName, branchName, branchName, token)
				if err != nil {
					mErr = fmt.Errorf("PR 创建失败: %w", err)
				} else {
					mResult.PrURL = prURL
				}
			}
		}

		mFinished := time.Now().Unix()
		if mErr != nil {
			if err := s.persistModelRunState(req.TaskID, modelName, "error", &branchName, nil, &mNow, &mFinished, stringPtr(mErr.Error()), nil); err != nil {
				mResult.Error = fmt.Sprintf("%s；模型状态写回失败: %v", mErr.Error(), err)
			} else {
				mResult.Error = mErr.Error()
			}
			allOK = false
		} else {
			if err := s.persistModelRunState(req.TaskID, modelName, "done", &branchName, &mResult.PrURL, &mNow, &mFinished, stringPtr(""), nil); err != nil {
				mResult.Error = fmt.Sprintf("PR 已创建，但模型状态写回失败: %v", err)
				allOK = false
			}
		}
		result.Models = append(result.Models, mResult)
	}

	if allOK {
		if err := s.store.UpdateTaskStatus(req.TaskID, "Submitted"); err != nil {
			return nil, fmt.Errorf("任务状态写回失败: %w", err)
		}
	} else {
		if err := s.store.UpdateTaskStatus(req.TaskID, "Error"); err != nil {
			return nil, fmt.Errorf("任务状态写回失败: %w", err)
		}
	}
	return result, nil
}

func (s *SubmitService) persistModelRunState(
	taskID, modelName, status string,
	branchName, prURL *string,
	startedAt, finishedAt *int64,
	submitError *string,
	originURL *string,
) error {
	if err := s.store.UpdateModelRun(taskID, modelName, status, branchName, prURL, startedAt, finishedAt); err != nil {
		return err
	}
	if submitError != nil {
		if err := s.store.SetModelRunError(taskID, modelName, *submitError); err != nil {
			return err
		}
	}
	if originURL != nil {
		if err := s.store.SetModelRunOriginURL(taskID, modelName, *originURL); err != nil {
			return err
		}
	}
	return nil
}

func (s *SubmitService) failTaskAndModelRun(taskID, taskStatus, modelName string, branchName *string, startedAt int64, cause error) error {
	if err := s.markErrorMsg(taskID, modelName, branchName, cause.Error(), startedAt); err != nil {
		return fmt.Errorf("%w；模型状态写回失败: %v", cause, err)
	}
	if err := s.store.UpdateTaskStatus(taskID, taskStatus); err != nil {
		return fmt.Errorf("%w；任务状态写回失败: %v", cause, err)
	}
	return nil
}

func stringPtr(value string) *string {
	return &value
}

func validatePublishRequest(req PublishSourceRepoRequest) error {
	if strings.TrimSpace(req.TaskID) == "" {
		return fmt.Errorf("任务不能为空")
	}
	if strings.TrimSpace(req.ModelName) == "" {
		return fmt.Errorf("源码文件夹不能为空")
	}
	return validateRepoAndAccount(req.TargetRepo, req.GitHubUsername, req.GitHubToken, req.GitHubAccountID)
}

func validateSubmitRequest(req SubmitModelRunRequest) error {
	if strings.TrimSpace(req.TaskID) == "" {
		return fmt.Errorf("任务不能为空")
	}
	if strings.TrimSpace(req.ModelName) == "" {
		return fmt.Errorf("模型名称不能为空")
	}
	return validateRepoAndAccount(req.TargetRepo, req.GitHubUsername, req.GitHubToken, req.GitHubAccountID)
}

func validateRepoAndAccount(targetRepo, username, token, accountID string) error {
	if strings.TrimSpace(targetRepo) == "" {
		return fmt.Errorf("源码仓库不能为空")
	}
	parts := strings.SplitN(strings.TrimSpace(targetRepo), "/", 3)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return fmt.Errorf("源码仓库格式应为 owner/repo")
	}
	if strings.TrimSpace(accountID) != "" {
		return nil
	}
	if strings.TrimSpace(username) == "" || strings.TrimSpace(token) == "" {
		return fmt.Errorf("GitHub 账号信息不完整")
	}
	return nil
}

func (s *SubmitService) resolveGitHubCredentials(accountID, username, token string) (string, string, error) {
	username = strings.TrimSpace(username)
	token = strings.TrimSpace(token)
	accountID = strings.TrimSpace(accountID)

	if accountID != "" {
		account, err := s.store.GetGitHubAccount(accountID)
		if err != nil {
			return "", "", err
		}
		if account == nil {
			return "", "", fmt.Errorf("未找到 GitHub 账号: %s", accountID)
		}
		if username == "" {
			username = strings.TrimSpace(account.Username)
		}
		if token == "" {
			token = strings.TrimSpace(account.Token)
		}
	}

	if username == "" || token == "" {
		return "", "", fmt.Errorf("GitHub 账号信息不完整")
	}

	return username, token, nil
}
