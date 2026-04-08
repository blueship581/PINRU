package github

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const apiBase = "https://api.github.com"

var client = &http.Client{Timeout: 20 * time.Second}

type User struct {
	Login string  `json:"login"`
	Email *string `json:"email"`
}

type Repo struct {
	HTMLURL       string `json:"html_url"`
	DefaultBranch string `json:"default_branch"`
}

type pullRequest struct {
	HTMLURL string `json:"html_url"`
}

type apiError struct {
	Message string `json:"message"`
}

func TestConnection(username, token string) (bool, error) {
	if strings.TrimSpace(username) == "" {
		return false, fmt.Errorf("GitHub 用户名不能为空")
	}
	if strings.TrimSpace(token) == "" {
		return false, fmt.Errorf("GitHub 访问令牌不能为空")
	}

	user, err := GetAuthenticatedUser(token)
	if err != nil {
		return false, err
	}
	return strings.EqualFold(user.Login, strings.TrimSpace(username)), nil
}

func GetAuthenticatedUser(token string) (*User, error) {
	if strings.TrimSpace(token) == "" {
		return nil, fmt.Errorf("GitHub 访问令牌不能为空")
	}

	resp, err := doRequest("GET", apiBase+"/user", token, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if err := checkStatus(resp); err != nil {
		return nil, err
	}
	var u User
	json.NewDecoder(resp.Body).Decode(&u)
	return &u, nil
}

func EnsureRepository(targetRepo, token string, description *string) (*Repo, error) {
	repo, err := getRepository(targetRepo, token)
	if err == nil {
		return repo, nil
	}
	if !strings.Contains(err.Error(), "Not Found") {
		return nil, err
	}
	return createRepository(targetRepo, token, description)
}

func SetDefaultBranch(targetRepo, branch, token string) error {
	body, _ := json.Marshal(map[string]string{"default_branch": branch})
	resp, err := doRequest("PATCH", apiBase+"/repos/"+targetRepo, token, body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return checkStatus(resp)
}

func EnsurePullRequest(targetRepo, repoOwner, headBranch, title, prBody, token string) (string, error) {
	if existing, err := findExistingPR(targetRepo, repoOwner, headBranch, "main", token); err == nil && existing != "" {
		return existing, nil
	}

	payload, _ := json.Marshal(map[string]string{
		"title": title,
		"body":  prBody,
		"head":  fmt.Sprintf("%s:%s", repoOwner, headBranch),
		"base":  "main",
	})
	resp, err := doRequest("POST", apiBase+"/repos/"+targetRepo+"/pulls", token, payload)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if err := checkStatus(resp); err != nil {
		return "", err
	}
	var pr pullRequest
	json.NewDecoder(resp.Body).Decode(&pr)
	return pr.HTMLURL, nil
}

func getRepository(targetRepo, token string) (*Repo, error) {
	resp, err := doRequest("GET", apiBase+"/repos/"+targetRepo, token, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if err := checkStatus(resp); err != nil {
		return nil, err
	}
	var r Repo
	json.NewDecoder(resp.Body).Decode(&r)
	return &r, nil
}

func createRepository(targetRepo, token string, description *string) (*Repo, error) {
	parts := strings.SplitN(targetRepo, "/", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return nil, fmt.Errorf("源码仓库格式应为 owner/repo")
	}
	owner, repoName := parts[0], parts[1]

	user, err := GetAuthenticatedUser(token)
	if err != nil {
		return nil, err
	}

	desc := ""
	if description != nil {
		desc = *description
	}

	var url string
	if strings.EqualFold(owner, user.Login) {
		url = apiBase + "/user/repos"
	} else {
		url = apiBase + "/orgs/" + owner + "/repos"
	}

	payload, _ := json.Marshal(map[string]interface{}{
		"name":        repoName,
		"description": desc,
		"private":     false,
		"auto_init":   false,
	})
	resp, err := doRequest("POST", url, token, payload)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if err := checkStatus(resp); err != nil {
		return nil, err
	}
	var r Repo
	json.NewDecoder(resp.Body).Decode(&r)
	return &r, nil
}

func findExistingPR(targetRepo, repoOwner, headBranch, baseBranch, token string) (string, error) {
	url := fmt.Sprintf("%s/repos/%s/pulls?state=open&head=%s:%s&base=%s",
		apiBase, targetRepo, repoOwner, headBranch, baseBranch)
	resp, err := doRequest("GET", url, token, nil)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if err := checkStatus(resp); err != nil {
		return "", err
	}
	var prs []pullRequest
	json.NewDecoder(resp.Body).Decode(&prs)
	if len(prs) > 0 {
		return prs[0].HTMLURL, nil
	}
	return "", nil
}

func doRequest(method, url, token string, body []byte) (*http.Response, error) {
	var bodyReader io.Reader
	if body != nil {
		bodyReader = bytes.NewReader(body)
	}
	req, err := http.NewRequest(method, url, bodyReader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "pinru")
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(token))
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return client.Do(req)
}

func checkStatus(resp *http.Response) error {
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}
	body, _ := io.ReadAll(resp.Body)
	var ae apiError
	if json.Unmarshal(body, &ae) == nil && ae.Message != "" {
		return fmt.Errorf("%s", ae.Message)
	}
	switch resp.StatusCode {
	case 401:
		return fmt.Errorf("GitHub 认证失败，请检查访问令牌")
	case 403:
		return fmt.Errorf("GitHub 拒绝了本次操作，请确认令牌权限")
	case 404:
		return fmt.Errorf("Not Found")
	case 422:
		return fmt.Errorf("GitHub 无法创建 PR，请检查分支是否有实际改动")
	default:
		return fmt.Errorf("GitHub API 请求失败: HTTP %d", resp.StatusCode)
	}
}
