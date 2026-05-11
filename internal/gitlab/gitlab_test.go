package gitlab

import (
	"archive/tar"
	"compress/gzip"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestDownloadArchiveByRefEscapesProjectPath(t *testing.T) {
	var requestedPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestedPath = r.URL.EscapedPath()
		if requestedPath != "/api/v4/projects/prompt2repo%2Flabel-02362/repository/archive.tar.gz" {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Type", "application/gzip")
		gz := gzip.NewWriter(w)
		tw := tar.NewWriter(gz)
		if err := tw.WriteHeader(&tar.Header{Name: "repo/README.md", Mode: 0o644, Size: int64(len("demo"))}); err != nil {
			t.Fatalf("WriteHeader() error = %v", err)
		}
		if _, err := tw.Write([]byte("demo")); err != nil {
			t.Fatalf("Write() error = %v", err)
		}
		if err := tw.Close(); err != nil {
			t.Fatalf("tar Close() error = %v", err)
		}
		if err := gz.Close(); err != nil {
			t.Fatalf("gzip Close() error = %v", err)
		}
	}))
	defer server.Close()

	destination := filepath.Join(t.TempDir(), "source")
	if err := DownloadArchiveByRef("prompt2repo/label-02362", server.URL, "glpat-test", destination, nil, false); err != nil {
		t.Fatalf("DownloadArchiveByRef() error = %v", err)
	}

	if requestedPath != "/api/v4/projects/prompt2repo%2Flabel-02362/repository/archive.tar.gz" {
		t.Fatalf("requestedPath = %q, want escaped project ref path", requestedPath)
	}
	content, err := os.ReadFile(filepath.Join(destination, "README.md"))
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	if string(content) != "demo" {
		t.Fatalf("README.md = %q, want demo", string(content))
	}
}
