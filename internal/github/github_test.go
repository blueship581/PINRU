package github

import (
	"net/http"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

func withTestClient(t *testing.T, fn roundTripFunc) {
	t.Helper()
	previousClient := client
	client = &http.Client{Transport: fn}
	t.Cleanup(func() {
		client = previousClient
	})
}

func TestDeleteRepositoryIfExistsDeletesExistingRepository(t *testing.T) {
	withTestClient(t, func(req *http.Request) (*http.Response, error) {
		if req.Method != http.MethodDelete {
			t.Fatalf("method = %s, want DELETE", req.Method)
		}
		if req.URL.String() != apiBase+"/repos/octo/demo" {
			t.Fatalf("url = %s, want %s", req.URL.String(), apiBase+"/repos/octo/demo")
		}
		return &http.Response{
			StatusCode: http.StatusNoContent,
			Body:       http.NoBody,
			Header:     make(http.Header),
		}, nil
	})

	deleted, err := DeleteRepositoryIfExists("octo/demo", "token")
	if err != nil {
		t.Fatalf("DeleteRepositoryIfExists() error = %v", err)
	}
	if !deleted {
		t.Fatalf("deleted = false, want true")
	}
}

func TestDeleteRepositoryIfExistsIgnoresMissingRepository(t *testing.T) {
	withTestClient(t, func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusNotFound,
			Body:       http.NoBody,
			Header:     make(http.Header),
		}, nil
	})

	deleted, err := DeleteRepositoryIfExists("octo/missing", "token")
	if err != nil {
		t.Fatalf("DeleteRepositoryIfExists() error = %v", err)
	}
	if deleted {
		t.Fatalf("deleted = true, want false")
	}
}

func TestDeleteRepositoryIfExistsReturnsPermissionErrors(t *testing.T) {
	withTestClient(t, func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusForbidden,
			Body:       http.NoBody,
			Header:     make(http.Header),
		}, nil
	})

	deleted, err := DeleteRepositoryIfExists("octo/private", "token")
	if err == nil {
		t.Fatalf("DeleteRepositoryIfExists() error = nil, want error")
	}
	if deleted {
		t.Fatalf("deleted = true, want false")
	}
	if !strings.Contains(err.Error(), "GitHub 拒绝") {
		t.Fatalf("error = %q, want permission message", err.Error())
	}
}
