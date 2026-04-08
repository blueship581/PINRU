package main

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/blueship581/pinru/internal/github"
	"github.com/blueship581/pinru/internal/gitops"
	"github.com/blueship581/pinru/internal/store"
	"github.com/blueship581/pinru/internal/util"
)

const mainBranch = "main"

type SubmitService struct {
	store *store.Store
}

type PublishSourceRepoRequest struct {
	TaskID         string `json:"taskId"`
	ModelName      string `json:"modelName"`
	TargetRepo     string `json:"targetRepo"`
	GitHubUsername string `json:"githubUsername"`
	GitHubToken    string `json:"githubToken"`
}

type PublishSourceRepoResult struct {
	BranchName string `json:"branchName"`
	RepoURL    string `json:"repoUrl"`
}

type SubmitModelRunRequest struct {
	TaskID         string `json:"taskId"`
	ModelName      string `json:"modelName"`
	TargetRepo     string `json:"targetRepo"`
	GitHubUsername string `json:"githubUsername"`
	GitHubToken    string `json:"githubToken"`
}

type SubmitModelRunResult struct {
	BranchName string `json:"branchName"`
	PrURL      string `json:"prUrl"`
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

	ghUser, err := github.GetAuthenticatedUser(strings.TrimSpace(req.GitHubToken))
	if err != nil {
		return nil, fmt.Errorf("GitHub 认证失败: %w", err)
	}
	authorEmail := fmt.Sprintf("%s@users.noreply.github.com", ghUser.Login)
	if ghUser.Email != nil {
		authorEmail = *ghUser.Email
	}

	repo, err := github.EnsureRepository(strings.TrimSpace(req.TargetRepo), strings.TrimSpace(req.GitHubToken), &task.ProjectName)
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
	if err := gitops.PushBranch(workspacePath, mainBranch, ghUser.Login, strings.TrimSpace(req.GitHubToken)); err != nil {
		return nil, fmt.Errorf("Git 推送失败: %w", err)
	}

	github.SetDefaultBranch(strings.TrimSpace(req.TargetRepo), mainBranch, strings.TrimSpace(req.GitHubToken))

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

	ghUser, err := github.GetAuthenticatedUser(strings.TrimSpace(req.GitHubToken))
	if err != nil {
		return nil, fmt.Errorf("GitHub 认证失败: %w", err)
	}
	authorEmail := fmt.Sprintf("%s@users.noreply.github.com", ghUser.Login)
	if ghUser.Email != nil {
		authorEmail = *ghUser.Email
	}

	branchName := strings.TrimSpace(req.ModelName)
	now := time.Now().Unix()
	s.store.UpdateModelRun(req.TaskID, req.ModelName, "running", &branchName, nil, &now, nil)

	if err := gitops.CreateOrResetBranch(workspacePath, branchName, mainBranch); err != nil {
		s.markError(req.TaskID, req.ModelName, branchName, now)
		return nil, fmt.Errorf("Git 操作失败: %w", err)
	}
	if err := gitops.CopyProjectContents(modelPath, workspacePath); err != nil {
		s.markError(req.TaskID, req.ModelName, branchName, now)
		return nil, fmt.Errorf("Git 操作失败: %w", err)
	}
	commitMsg := fmt.Sprintf("feat: %s 模型实现", branchName)
	committed, err := gitops.CommitAll(workspacePath, branchName, ghUser.Login, authorEmail, commitMsg)
	if err != nil {
		s.markError(req.TaskID, req.ModelName, branchName, now)
		return nil, fmt.Errorf("Git 操作失败: %w", err)
	}
	if !committed {
		s.markError(req.TaskID, req.ModelName, branchName, now)
		return nil, fmt.Errorf("模型 %s 与源码 main 无差异，无法创建 PR", branchName)
	}

	if err := gitops.PushBranch(workspacePath, branchName, ghUser.Login, strings.TrimSpace(req.GitHubToken)); err != nil {
		s.markError(req.TaskID, req.ModelName, branchName, now)
		return nil, fmt.Errorf("Git 推送失败: %w", err)
	}

	repoOwner := strings.SplitN(strings.TrimSpace(req.TargetRepo), "/", 2)[0]
	prURL, err := github.EnsurePullRequest(
		strings.TrimSpace(req.TargetRepo), repoOwner, branchName, branchName, branchName,
		strings.TrimSpace(req.GitHubToken))
	if err != nil {
		s.markError(req.TaskID, req.ModelName, branchName, now)
		return nil, fmt.Errorf("GitHub PR 创建失败: %w", err)
	}

	finishedAt := time.Now().Unix()
	s.store.UpdateModelRun(req.TaskID, req.ModelName, "done", &branchName, &prURL, &now, &finishedAt)

	return &SubmitModelRunResult{BranchName: branchName, PrURL: prURL}, nil
}

func (s *SubmitService) markError(taskID, modelName, branchName string, startedAt int64) {
	finishedAt := time.Now().Unix()
	s.store.UpdateModelRun(taskID, modelName, "error", &branchName, nil, &startedAt, &finishedAt)
}

func (s *SubmitService) markErrorMsg(taskID, modelName, branchName, errMsg string, startedAt int64) {
	finishedAt := time.Now().Unix()
	s.store.UpdateModelRun(taskID, modelName, "error", &branchName, nil, &startedAt, &finishedAt)
	s.store.SetModelRunError(taskID, modelName, errMsg)
}

// --- SubmitAll: single endpoint that handles origin push + all model PRs ---

type SubmitAllRequest struct {
	TaskID         string   `json:"taskId"`
	Models         []string `json:"models"` // selected non-ORIGIN model names
	TargetRepo     string   `json:"targetRepo"`
	GitHubUsername string   `json:"githubUsername"`
	GitHubToken    string   `json:"githubToken"`
}

type ModelSubmitResult struct {
	ModelName string `json:"modelName"`
	PrURL     string `json:"prUrl"`
	Error     string `json:"error"`
}

type SubmitAllResult struct {
	RepoURL   string              `json:"repoUrl"`
	RepoError string              `json:"repoError"`
	Models    []ModelSubmitResult `json:"models"`
}

func (s *SubmitService) SubmitAll(req SubmitAllRequest) (*SubmitAllResult, error) {
	if err := validateRepoAndAccount(req.TargetRepo, req.GitHubUsername, req.GitHubToken); err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.TaskID) == "" {
		return nil, fmt.Errorf("任务不能为空")
	}

	task, err := s.store.GetTask(req.TaskID)
	if err != nil || task == nil {
		return nil, fmt.Errorf("未找到任务: %s", req.TaskID)
	}

	originRun, err := s.store.GetModelRun(req.TaskID, "ORIGIN")
	if err != nil || originRun == nil {
		return nil, fmt.Errorf("未找到 ORIGIN 记录，请先在领题页下载项目")
	}
	if originRun.LocalPath == nil {
		return nil, fmt.Errorf("ORIGIN 缺少本地路径，无法推送源码")
	}

	token := strings.TrimSpace(req.GitHubToken)
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

	// ── Step 1: push origin to main ──
	s.store.UpdateModelRun(req.TaskID, "ORIGIN", "running", nil, nil, &now, nil)

	sourcePath := util.ExpandTilde(*originRun.LocalPath)
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
			} else if err := gitops.PushBranch(workspacePath, mainBranch, ghUser.Login, token); err != nil {
				repoErr = fmt.Errorf("Git 推送失败: %w", err)
			}
		}
		if repoErr == nil {
			github.SetDefaultBranch(targetRepo, mainBranch, token)
		}
	}

	if repoErr != nil {
		finishedAt := time.Now().Unix()
		s.store.UpdateModelRun(req.TaskID, "ORIGIN", "error", nil, nil, &now, &finishedAt)
		s.store.SetModelRunError(req.TaskID, "ORIGIN", repoErr.Error())
		s.store.UpdateTaskStatus(req.TaskID, "Error")
		result.RepoError = repoErr.Error()
		return result, nil
	}

	finishedAt := time.Now().Unix()
	repoURL := repo.HTMLURL
	s.store.UpdateModelRun(req.TaskID, "ORIGIN", "done", nil, nil, &now, &finishedAt)
	s.store.SetModelRunOriginURL(req.TaskID, "ORIGIN", repoURL)
	s.store.SetModelRunError(req.TaskID, "ORIGIN", "")
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

		// Ensure model_run exists
		run, _ := s.store.GetModelRun(req.TaskID, modelName)
		if run == nil {
			// Derive path from ORIGIN sibling
			var derivedPath *string
			if originRun.LocalPath != nil {
				lp := *originRun.LocalPath
				if idx := strings.LastIndex(lp, "/"); idx >= 0 {
					p := lp[:idx+1] + modelName
					derivedPath = &p
				}
			}
			newRun := store.ModelRun{
				ID:        fmt.Sprintf("%s-%s-%d", req.TaskID, modelName, time.Now().UnixNano()),
				TaskID:    req.TaskID,
				ModelName: modelName,
				LocalPath: derivedPath,
			}
			s.store.CreateModelRun(newRun)
			run, _ = s.store.GetModelRun(req.TaskID, modelName)
		}

		mResult := ModelSubmitResult{ModelName: modelName}

		if run == nil || run.LocalPath == nil {
			mResult.Error = fmt.Sprintf("缺少本地路径，无法创建 PR")
			result.Models = append(result.Models, mResult)
			allOK = false
			continue
		}

		modelPath := util.ExpandTilde(*run.LocalPath)
		branchName := modelName
		mNow := time.Now().Unix()
		s.store.UpdateModelRun(req.TaskID, modelName, "running", &branchName, nil, &mNow, nil)

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
			} else if err := gitops.PushBranch(workspacePath, branchName, ghUser.Login, token); err != nil {
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
			s.store.UpdateModelRun(req.TaskID, modelName, "error", &branchName, nil, &mNow, &mFinished)
			s.store.SetModelRunError(req.TaskID, modelName, mErr.Error())
			mResult.Error = mErr.Error()
			allOK = false
		} else {
			s.store.UpdateModelRun(req.TaskID, modelName, "done", &branchName, &mResult.PrURL, &mNow, &mFinished)
			s.store.SetModelRunError(req.TaskID, modelName, "")
		}
		result.Models = append(result.Models, mResult)
	}

	if allOK {
		s.store.UpdateTaskStatus(req.TaskID, "Submitted")
	} else {
		s.store.UpdateTaskStatus(req.TaskID, "Error")
	}
	return result, nil
}

func validatePublishRequest(req PublishSourceRepoRequest) error {
	if strings.TrimSpace(req.TaskID) == "" {
		return fmt.Errorf("任务不能为空")
	}
	if strings.TrimSpace(req.ModelName) == "" {
		return fmt.Errorf("源码文件夹不能为空")
	}
	return validateRepoAndAccount(req.TargetRepo, req.GitHubUsername, req.GitHubToken)
}

func validateSubmitRequest(req SubmitModelRunRequest) error {
	if strings.TrimSpace(req.TaskID) == "" {
		return fmt.Errorf("任务不能为空")
	}
	if strings.TrimSpace(req.ModelName) == "" {
		return fmt.Errorf("模型名称不能为空")
	}
	return validateRepoAndAccount(req.TargetRepo, req.GitHubUsername, req.GitHubToken)
}

func validateRepoAndAccount(targetRepo, username, token string) error {
	if strings.TrimSpace(targetRepo) == "" {
		return fmt.Errorf("源码仓库不能为空")
	}
	parts := strings.SplitN(strings.TrimSpace(targetRepo), "/", 3)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return fmt.Errorf("源码仓库格式应为 owner/repo")
	}
	if strings.TrimSpace(username) == "" || strings.TrimSpace(token) == "" {
		return fmt.Errorf("GitHub 账号信息不完整")
	}
	return nil
}
