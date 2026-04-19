package gitlab

import (
	"archive/tar"
	"compress/gzip"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	neturl "net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/blueship581/pinru/internal/errs"
	"github.com/blueship581/pinru/internal/util"
	"github.com/google/uuid"
)

type Project struct {
	ID            int64   `json:"id"`
	Name          string  `json:"name"`
	Description   *string `json:"description"`
	WebURL        string  `json:"web_url"`
	DefaultBranch *string `json:"default_branch"`
	HTTPURLToRepo *string `json:"http_url_to_repo"`
}

func TestConnection(apiURL, token string, skipTLSVerify bool) (bool, error) {
	baseURL, err := normalizeAPIBaseURL(apiURL)
	if err != nil {
		return false, err
	}
	if strings.TrimSpace(token) == "" {
		return false, errors.New(errs.MsgGitLabTokenRequired)
	}

	req, err := http.NewRequest("GET", baseURL+"/api/v4/user", nil)
	if err != nil {
		return false, err
	}
	req.Header.Set("PRIVATE-TOKEN", token)
	resp, err := newHTTPClient(skipTLSVerify).Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	return resp.StatusCode == 200, nil
}

func FetchProject(projectRef, apiURL, token string, skipTLSVerify bool) (*Project, error) {
	baseURL, err := normalizeAPIBaseURL(apiURL)
	if err != nil {
		return nil, err
	}

	encoded := neturl.PathEscape(projectRef)
	req, err := http.NewRequest("GET", fmt.Sprintf("%s/api/v4/projects/%s", baseURL, encoded), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("PRIVATE-TOKEN", token)
	resp, err := newHTTPClient(skipTLSVerify).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf(errs.FmtGitLabAPIStatus, resp.StatusCode, string(body))
	}
	var p Project
	if err := json.NewDecoder(resp.Body).Decode(&p); err != nil {
		return nil, err
	}
	return &p, nil
}

func DownloadArchive(projectID int64, apiURL, token, destination string, sha *string, skipTLSVerify bool) error {
	baseURL, err := normalizeAPIBaseURL(apiURL)
	if err != nil {
		return err
	}

	dest := util.ExpandTilde(destination)
	if _, err := os.Stat(dest); err == nil {
		return fmt.Errorf(errs.FmtGitLabTargetExist, filepath.Base(dest))
	}
	parent := filepath.Dir(dest)
	os.MkdirAll(parent, 0755)

	archiveURL := fmt.Sprintf("%s/api/v4/projects/%d/repository/archive.tar.gz", baseURL, projectID)
	if sha != nil && *sha != "" {
		archiveURL += "?sha=" + neturl.QueryEscape(*sha)
	}
	req, err := http.NewRequest("GET", archiveURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("PRIVATE-TOKEN", token)
	resp, err := newHTTPClient(skipTLSVerify).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf(errs.FmtGitLabDownloadFail, resp.StatusCode, string(body))
	}

	tempDir := filepath.Join(parent, ".pinru-archive-"+uuid.New().String())
	os.MkdirAll(tempDir, 0755)
	defer os.RemoveAll(tempDir)

	gr, err := gzip.NewReader(resp.Body)
	if err != nil {
		return err
	}
	defer gr.Close()

	if err := extractTar(gr, tempDir); err != nil {
		return err
	}

	entries, _ := os.ReadDir(tempDir)
	extractedRoot := tempDir
	if len(entries) == 1 && entries[0].IsDir() {
		extractedRoot = filepath.Join(tempDir, entries[0].Name())
	}

	os.MkdirAll(dest, 0755)
	return moveContents(extractedRoot, dest)
}

func extractTar(r io.Reader, dest string) error {
	tr := tar.NewReader(r)
	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		target := filepath.Join(dest, header.Name)
		switch header.Typeflag {
		case tar.TypeDir:
			os.MkdirAll(target, 0755)
		case tar.TypeReg:
			os.MkdirAll(filepath.Dir(target), 0755)
			f, err := os.Create(target)
			if err != nil {
				return err
			}
			if _, err := io.Copy(f, tr); err != nil {
				f.Close()
				return err
			}
			f.Close()
		}
	}
	return nil
}

func moveContents(src, dst string) error {
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		srcPath := filepath.Join(src, entry.Name())
		dstPath := filepath.Join(dst, entry.Name())
		if err := os.Rename(srcPath, dstPath); err != nil {
			return err
		}
	}
	return nil
}

func newHTTPClient(skipTLSVerify bool) *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if transport.TLSClientConfig == nil {
		transport.TLSClientConfig = &tls.Config{}
	}
	//nolint:gosec // Controlled by an explicit user setting for temporary GitLab certificate bypass.
	transport.TLSClientConfig.InsecureSkipVerify = skipTLSVerify
	return &http.Client{
		Timeout:   20 * time.Second,
		Transport: transport,
	}
}

func trimURL(u string) string {
	for len(u) > 0 && u[len(u)-1] == '/' {
		u = u[:len(u)-1]
	}
	return u
}

func normalizeAPIBaseURL(raw string) (string, error) {
	baseURL := strings.TrimSpace(trimURL(raw))
	if baseURL == "" {
		return "", errors.New(errs.MsgGitLabURLRequired)
	}

	parsed, err := neturl.ParseRequestURI(baseURL)
	if err != nil || parsed.Host == "" {
		return "", errors.New(errs.MsgGitLabURLFormat)
	}

	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", errors.New(errs.MsgGitLabURLScheme)
	}

	return baseURL, nil
}
