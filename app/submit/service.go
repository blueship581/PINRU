package submit

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/blueship581/pinru/internal/errs"
	"github.com/blueship581/pinru/internal/github"
	"github.com/blueship581/pinru/internal/gitops"
	"github.com/blueship581/pinru/internal/store"
	"github.com/blueship581/pinru/internal/util"
)

const mainBranch = "main"
const sourcePublishAttempts = 2

var (
	ensureGitHubRepository   = github.EnsureRepository
	recreateGitHubRepository = github.RecreateRepository
)

type submitGitHubAuth struct {
	GitUsername string
	Token       string
	Login       string
	Email       string
}

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
	RecreateRepo    bool   `json:"recreateRepo"`
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
	RecreateRepo    bool     `json:"recreateRepo"`
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
		return nil, fmt.Errorf(errs.FmtTaskNotFound, req.TaskID)
	}

	auth, err := s.resolveSubmitGitHubAuth(req.GitHubAccountID, req.GitHubUsername, req.GitHubToken)
	if err != nil {
		return nil, err
	}

	repo, err := s.publishSourceRepoForTask(task, req.ModelName, strings.TrimSpace(req.TargetRepo), auth, req.RecreateRepo)
	if err != nil {
		return nil, err
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

	task, err := s.store.GetTask(req.TaskID)
	if err != nil || task == nil {
		return nil, fmt.Errorf(errs.FmtTaskNotFound, req.TaskID)
	}

	modelRun, err := s.store.GetModelRun(req.TaskID, req.ModelName)
	if err != nil || modelRun == nil {
		return nil, fmt.Errorf(errs.FmtModelRunNotFound, req.TaskID, req.ModelName)
	}
	sourceRun, _ := s.store.GetModelRun(req.TaskID, s.resolveTaskSourceModelName(task, ""))
	modelPath, err := s.resolveModelRunPathForSubmit(task, sourceRun, modelRun, req.ModelName)
	if err != nil {
		return nil, err
	}
	modelPath = util.ExpandTilde(modelPath)

	auth, err := s.resolveSubmitGitHubAuth(req.GitHubAccountID, req.GitHubUsername, req.GitHubToken)
	if err != nil {
		return nil, err
	}

	targetRepo := strings.TrimSpace(req.TargetRepo)
	workspacePath := gitops.WorkspacePath(targetRepo)
	if !gitops.WorkspaceHasBranch(workspacePath, mainBranch) {
		sourceModelName := s.resolveTaskSourceModelName(task, "")
		if _, prepErr := s.publishSourceRepoForTask(task, sourceModelName, targetRepo, auth, false); prepErr != nil {
			if _, recoverErr := s.recoverSourceWorkspaceFromRemote(targetRepo, auth); recoverErr != nil {
				return nil, fmt.Errorf("%s：源码重新上传失败：%v；远端 main 恢复失败：%w", errs.MsgSourceNotUploaded, prepErr, recoverErr)
			}
		}
	}

	branchName := strings.TrimSpace(req.ModelName)
	now := time.Now().Unix()
	if err := s.store.UpdateModelRun(req.TaskID, req.ModelName, "running", &branchName, nil, &now, nil); err != nil {
		return nil, fmt.Errorf(errs.FmtModelStateBackFail, err)
	}

	if err := gitops.CreateOrResetBranch(workspacePath, branchName, mainBranch); err != nil {
		return nil, s.failModelRun(req.TaskID, req.ModelName, &branchName, now, fmt.Errorf("%s：%w", errs.MsgGitOpFailed, err))
	}
	if err := gitops.CopyProjectContents(modelPath, workspacePath); err != nil {
		return nil, s.failModelRun(req.TaskID, req.ModelName, &branchName, now, fmt.Errorf("%s：%w", errs.MsgGitOpFailed, err))
	}
	commitMsg := fmt.Sprintf("feat: %s 模型实现", branchName)
	committed, err := gitops.CommitAll(workspacePath, branchName, auth.Login, auth.Email, commitMsg)
	if err != nil {
		return nil, s.failModelRun(req.TaskID, req.ModelName, &branchName, now, fmt.Errorf("%s：%w", errs.MsgGitOpFailed, err))
	}
	if !committed {
		return nil, s.failModelRun(req.TaskID, req.ModelName, &branchName, now, fmt.Errorf(errs.FmtModelNoDiff, branchName))
	}

	if err := gitops.PushBranch(workspacePath, branchName, auth.GitUsername, auth.Token); err != nil {
		return nil, s.failModelRun(req.TaskID, req.ModelName, &branchName, now, fmt.Errorf("%s：%w", errs.MsgGitPushFailed, err))
	}

	repoOwner := strings.SplitN(targetRepo, "/", 2)[0]
	prURL, err := github.EnsurePullRequest(
		targetRepo, repoOwner, branchName, branchName, branchName,
		auth.Token)
	if err != nil {
		return nil, s.failModelRun(req.TaskID, req.ModelName, &branchName, now, fmt.Errorf(errs.FmtGitHubPRCreateWrap, err))
	}

	finishedAt := time.Now().Unix()
	if err := s.persistModelRunState(req.TaskID, req.ModelName, "done", &branchName, &prURL, &now, &finishedAt, stringPtr(""), nil); err != nil {
		return nil, fmt.Errorf(errs.FmtPRCreatedButStateFail, err)
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
		return fmt.Errorf(errs.FmtModelStateBackInline, cause, markErr)
	}
	return cause
}

func (s *SubmitService) SubmitAll(req SubmitAllRequest) (*SubmitAllResult, error) {
	if err := validateRepoAndAccount(req.TargetRepo, req.GitHubUsername, req.GitHubToken, req.GitHubAccountID); err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.TaskID) == "" {
		return nil, errors.New(errs.MsgTaskRequired)
	}

	task, err := s.store.GetTask(req.TaskID)
	if err != nil || task == nil {
		return nil, fmt.Errorf(errs.FmtTaskNotFound, req.TaskID)
	}

	sourceModelName := strings.TrimSpace(req.SourceModelName)
	if sourceModelName == "" {
		sourceModelName = "ORIGIN"
	}

	sourceRun, err := s.store.GetModelRun(req.TaskID, sourceModelName)
	if err != nil || sourceRun == nil {
		return nil, fmt.Errorf(errs.FmtSourceModelMissing, sourceModelName)
	}
	if sourceRun.LocalPath == nil {
		return nil, fmt.Errorf(errs.FmtSourceModelNoPath, sourceModelName)
	}

	auth, err := s.resolveSubmitGitHubAuth(req.GitHubAccountID, req.GitHubUsername, req.GitHubToken)
	if err != nil {
		return nil, err
	}

	targetRepo := strings.TrimSpace(req.TargetRepo)

	result := &SubmitAllResult{}
	now := time.Now().Unix()

	// ── Step 1: push configured source folder to main ──
	if err := s.persistModelRunState(req.TaskID, sourceModelName, "running", nil, nil, &now, nil, stringPtr(""), nil); err != nil {
		return nil, fmt.Errorf(errs.FmtSourceStateBackFail, err)
	}

	repo, repoErr := s.publishSourceRepoForTask(task, sourceModelName, targetRepo, auth, req.RecreateRepo)

	if repoErr != nil {
		recoveredRepo, recoverErr := s.recoverSourceWorkspaceFromRemote(targetRepo, auth)
		if recoverErr != nil {
			combinedErr := fmt.Errorf("源码重新上传失败：%v；远端 main 恢复失败：%w", repoErr, recoverErr)
			if err := s.failTaskAndModelRun(req.TaskID, "Error", sourceModelName, nil, now, combinedErr); err != nil {
				return nil, err
			}
			result.RepoError = combinedErr.Error()
			return result, nil
		}
		repo = recoveredRepo
	}

	finishedAt := time.Now().Unix()
	repoURL := repo.HTMLURL
	if err := s.persistModelRunState(req.TaskID, sourceModelName, "done", nil, nil, &now, &finishedAt, stringPtr(""), &repoURL); err != nil {
		return nil, fmt.Errorf(errs.FmtSourceStateBackFail, err)
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
			return nil, fmt.Errorf(errs.FmtReadModelRunFail, modelName, err)
		}
		if run == nil {
			derivedPath, pathErr := s.resolveModelRunPathForSubmit(task, sourceRun, nil, modelName)
			var derivedPathPtr *string
			if pathErr == nil && strings.TrimSpace(derivedPath) != "" {
				derivedPathPtr = &derivedPath
			}
			newRun := store.ModelRun{
				ID:        fmt.Sprintf("%s-%s-%d", req.TaskID, modelName, time.Now().UnixNano()),
				TaskID:    req.TaskID,
				ModelName: modelName,
				LocalPath: derivedPathPtr,
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

		modelPath, err := s.resolveModelRunPathForSubmit(task, sourceRun, run, modelName)
		if err != nil {
			mResult.Error = fmt.Sprintf("解析模型目录失败: %v", err)
			result.Models = append(result.Models, mResult)
			allOK = false
			continue
		}
		modelPath = util.ExpandTilde(modelPath)
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
			mErr = fmt.Errorf("%s：%w", errs.MsgGitOpFailed, err)
		} else if err := gitops.CopyProjectContents(modelPath, workspacePath); err != nil {
			mErr = fmt.Errorf("%s：%w", errs.MsgGitOpFailed, err)
		} else {
			commitMsg := fmt.Sprintf("feat: %s 模型实现", branchName)
			committed, err := gitops.CommitAll(workspacePath, branchName, auth.Login, auth.Email, commitMsg)
			if err != nil {
				mErr = fmt.Errorf("%s：%w", errs.MsgGitOpFailed, err)
			} else if !committed {
				mErr = errors.New(errs.MsgNoDiffToMain)
			} else if err := gitops.PushBranch(workspacePath, branchName, auth.GitUsername, auth.Token); err != nil {
				mErr = fmt.Errorf("%s：%w", errs.MsgGitPushFailed, err)
			} else {
				prURL, err := github.EnsurePullRequest(targetRepo, repoOwner, branchName, branchName, branchName, auth.Token)
				if err != nil {
					mErr = fmt.Errorf(errs.FmtPRCreateFail, err)
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
			return nil, fmt.Errorf(errs.FmtTaskStateBackFail, err)
		}
	} else {
		if err := s.store.UpdateTaskStatus(req.TaskID, "Error"); err != nil {
			return nil, fmt.Errorf(errs.FmtTaskStateBackFail, err)
		}
	}
	return result, nil
}

func (s *SubmitService) resolveModelRunPathForSubmit(task *store.Task, sourceRun, run *store.ModelRun, modelName string) (string, error) {
	selectedPath := findModelRunFolderForSubmit(task, sourceRun, run, modelName)
	if strings.TrimSpace(selectedPath) == "" {
		return "", errors.New(errs.MsgModelMissingLocalDir)
	}

	if run != nil {
		currentPath := ""
		if run.LocalPath != nil {
			currentPath = strings.TrimSpace(*run.LocalPath)
		}
		if util.NormalizePath(currentPath) != util.NormalizePath(selectedPath) {
			pathValue := selectedPath
			if err := s.store.UpdateModelRunLocalPath(task.ID, run.ModelName, &pathValue); err != nil {
				return "", err
			}
			run.LocalPath = &pathValue
		}
	}
	return selectedPath, nil
}

func findModelRunFolderForSubmit(task *store.Task, sourceRun, run *store.ModelRun, modelName string) string {
	trimmedModelName := strings.TrimSpace(modelName)
	if trimmedModelName == "" {
		return ""
	}

	if taskDir := submitTaskDirectory(task, sourceRun, run); taskDir != "" {
		exactPath := filepath.Join(taskDir, trimmedModelName)
		if submitDirectoryExists(exactPath) {
			return exactPath
		}
		if containingPath := findContainingModelFolder(taskDir, trimmedModelName); containingPath != "" {
			return containingPath
		}
	}

	if run != nil && run.LocalPath != nil {
		runPath := strings.TrimSpace(*run.LocalPath)
		if runPath != "" {
			return runPath
		}
	}
	if sourceRun != nil && sourceRun.LocalPath != nil && strings.TrimSpace(*sourceRun.LocalPath) != "" {
		return filepath.Join(filepath.Dir(strings.TrimSpace(*sourceRun.LocalPath)), trimmedModelName)
	}
	return ""
}

func submitTaskDirectory(task *store.Task, sourceRun, run *store.ModelRun) string {
	if task != nil && task.LocalPath != nil && strings.TrimSpace(*task.LocalPath) != "" {
		return strings.TrimSpace(*task.LocalPath)
	}
	if sourceRun != nil && sourceRun.LocalPath != nil && strings.TrimSpace(*sourceRun.LocalPath) != "" {
		return filepath.Dir(strings.TrimSpace(*sourceRun.LocalPath))
	}
	if run != nil && run.LocalPath != nil && strings.TrimSpace(*run.LocalPath) != "" {
		return filepath.Dir(strings.TrimSpace(*run.LocalPath))
	}
	return ""
}

func findContainingModelFolder(taskDir, modelName string) string {
	entries, err := os.ReadDir(util.ExpandTilde(taskDir))
	if err != nil {
		return ""
	}

	needle := strings.ToLower(strings.TrimSpace(modelName))
	candidates := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		name := entry.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}
		if strings.Contains(strings.ToLower(name), needle) {
			candidates = append(candidates, name)
		}
	}
	if len(candidates) == 0 {
		return ""
	}
	sort.Slice(candidates, func(i, j int) bool {
		if len(candidates[i]) != len(candidates[j]) {
			return len(candidates[i]) < len(candidates[j])
		}
		return candidates[i] < candidates[j]
	})
	return filepath.Join(taskDir, candidates[0])
}

func submitDirectoryExists(path string) bool {
	info, err := os.Stat(util.ExpandTilde(path))
	return err == nil && info.IsDir()
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
		return fmt.Errorf(errs.FmtModelStateBackInline, cause, err)
	}
	if err := s.store.UpdateTaskStatus(taskID, taskStatus); err != nil {
		return fmt.Errorf(errs.FmtTaskStateBackInline, cause, err)
	}
	return nil
}

func stringPtr(value string) *string {
	return &value
}

func validatePublishRequest(req PublishSourceRepoRequest) error {
	if strings.TrimSpace(req.TaskID) == "" {
		return errors.New(errs.MsgTaskRequired)
	}
	if strings.TrimSpace(req.ModelName) == "" {
		return errors.New(errs.MsgSourceDirRequired)
	}
	return validateRepoAndAccount(req.TargetRepo, req.GitHubUsername, req.GitHubToken, req.GitHubAccountID)
}

func validateSubmitRequest(req SubmitModelRunRequest) error {
	if strings.TrimSpace(req.TaskID) == "" {
		return errors.New(errs.MsgTaskRequired)
	}
	if strings.TrimSpace(req.ModelName) == "" {
		return errors.New(errs.MsgModelNameRequired)
	}
	return validateRepoAndAccount(req.TargetRepo, req.GitHubUsername, req.GitHubToken, req.GitHubAccountID)
}

func validateRepoAndAccount(targetRepo, username, token, accountID string) error {
	if strings.TrimSpace(targetRepo) == "" {
		return errors.New(errs.MsgSourceRepoRequired)
	}
	parts := strings.SplitN(strings.TrimSpace(targetRepo), "/", 3)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return errors.New(errs.MsgSourceRepoFormat)
	}
	if strings.TrimSpace(accountID) != "" {
		return nil
	}
	if strings.TrimSpace(username) == "" || strings.TrimSpace(token) == "" {
		return errors.New(errs.MsgGitHubAccountInfoIncomplete)
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
			return "", "", fmt.Errorf(errs.FmtGitHubAccountNotFound, accountID)
		}
		if username == "" {
			username = strings.TrimSpace(account.Username)
		}
		if token == "" {
			token = strings.TrimSpace(account.Token)
		}
	}

	if username == "" || token == "" {
		return "", "", errors.New(errs.MsgGitHubAccountInfoIncomplete)
	}

	return username, token, nil
}

func (s *SubmitService) resolveSubmitGitHubAuth(accountID, username, token string) (*submitGitHubAuth, error) {
	authUsername, authToken, err := s.resolveGitHubCredentials(accountID, username, token)
	if err != nil {
		return nil, err
	}

	ghUser, err := github.GetAuthenticatedUser(authToken)
	if err != nil {
		return nil, fmt.Errorf(errs.FmtGitHubAuthWrap, err)
	}

	auth := &submitGitHubAuth{
		GitUsername: ghUser.Login,
		Token:       authToken,
		Login:       ghUser.Login,
		Email:       fmt.Sprintf("%s@users.noreply.github.com", ghUser.Login),
	}
	if strings.TrimSpace(auth.GitUsername) == "" {
		auth.GitUsername = authUsername
	}
	if ghUser.Email != nil && strings.TrimSpace(*ghUser.Email) != "" {
		auth.Email = strings.TrimSpace(*ghUser.Email)
	}
	return auth, nil
}

func (s *SubmitService) publishSourceRepoForTask(task *store.Task, sourceModelName, targetRepo string, auth *submitGitHubAuth, recreateRepo bool) (*github.Repo, error) {
	sourceRun, err := s.store.GetModelRun(task.ID, sourceModelName)
	if err != nil || sourceRun == nil {
		return nil, fmt.Errorf(errs.FmtSourceModelMissing, sourceModelName)
	}
	if sourceRun.LocalPath == nil {
		return nil, errors.New(errs.MsgSourceMissingLocalRepo)
	}

	repo, err := prepareGitHubRepository(targetRepo, auth.Token, &task.ProjectName, recreateRepo)
	if err != nil {
		return nil, fmt.Errorf(errs.FmtEnsureGitHubRepoFail, err)
	}

	sourcePath := util.ExpandTilde(*sourceRun.LocalPath)
	workspacePath := gitops.WorkspacePath(targetRepo)
	remoteURL := fmt.Sprintf("https://github.com/%s.git", targetRepo)

	var lastErr error
	for attempt := 1; attempt <= sourcePublishAttempts; attempt++ {
		if err := gitops.RecreateWorkspace(workspacePath, remoteURL, auth.Login, auth.Email); err != nil {
			lastErr = fmt.Errorf("%s：%w", errs.MsgGitOpFailed, err)
		} else if err := gitops.CopyProjectContents(sourcePath, workspacePath); err != nil {
			lastErr = fmt.Errorf("%s：%w", errs.MsgGitOpFailed, err)
		} else {
			committed, err := gitops.CommitAll(workspacePath, mainBranch, auth.Login, auth.Email, "init: 原始项目初始化")
			if err != nil {
				lastErr = fmt.Errorf("%s：%w", errs.MsgGitOpFailed, err)
			} else if !committed {
				lastErr = errors.New(errs.MsgSourceDirNoCommit)
			} else if err := gitops.EnsureBranch(workspacePath, mainBranch); err != nil {
				lastErr = fmt.Errorf("%s：%w", errs.MsgGitOpFailed, err)
			} else if err := gitops.PushBranch(workspacePath, mainBranch, auth.GitUsername, auth.Token); err != nil {
				lastErr = fmt.Errorf("%s：%w", errs.MsgGitPushFailed, err)
			} else if err := github.SetDefaultBranch(targetRepo, mainBranch, auth.Token); err != nil {
				lastErr = fmt.Errorf("%s：%w", errs.MsgDefaultBranchFail, err)
			} else {
				return repo, nil
			}
		}
		if attempt < sourcePublishAttempts {
			time.Sleep(700 * time.Millisecond)
		}
	}

	return repo, lastErr
}

func prepareGitHubRepository(targetRepo, token string, description *string, recreateRepo bool) (*github.Repo, error) {
	if recreateRepo {
		return recreateGitHubRepository(targetRepo, token, description)
	}
	return ensureGitHubRepository(targetRepo, token, description)
}

func (s *SubmitService) recoverSourceWorkspaceFromRemote(targetRepo string, auth *submitGitHubAuth) (*github.Repo, error) {
	repo, err := github.GetRepository(targetRepo, auth.Token)
	if err != nil {
		return nil, fmt.Errorf("%s：%w", errs.MsgSourceNotUploaded, err)
	}
	if repo == nil {
		return nil, fmt.Errorf("%s：远端仓库不存在", errs.MsgSourceNotUploaded)
	}

	workspacePath := gitops.WorkspacePath(targetRepo)
	remoteURL := fmt.Sprintf("https://github.com/%s.git", targetRepo)
	if err := gitops.RecreateWorkspaceFromRemote(workspacePath, remoteURL, mainBranch, auth.GitUsername, auth.Token, auth.Login, auth.Email); err != nil {
		return nil, fmt.Errorf("%s：%w", errs.MsgSourceNotUploaded, err)
	}
	return repo, nil
}

func (s *SubmitService) resolveTaskSourceModelName(task *store.Task, fallback string) string {
	if task != nil && task.ProjectConfigID != nil && strings.TrimSpace(*task.ProjectConfigID) != "" {
		project, err := s.store.GetProject(strings.TrimSpace(*task.ProjectConfigID))
		if err == nil && project != nil && strings.TrimSpace(project.SourceModelFolder) != "" {
			return strings.TrimSpace(project.SourceModelFolder)
		}
	}
	if strings.TrimSpace(fallback) != "" {
		return strings.TrimSpace(fallback)
	}
	return "ORIGIN"
}
