package analysis

import (
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/blueship581/pinru/internal/errs"
	"github.com/blueship581/pinru/internal/util"
)

const (
	maxDepth        = 5
	maxTrackedFiles = 240
	maxTreeEntries  = 72
	maxKeyFiles     = 6
	maxSnippetLines = 60
	maxSnippetChars = 2200
	maxFileSizeBytes = 48 * 1024
)

var ignoredDirs = map[string]bool{
	".git": true, ".idea": true, ".vscode": true, ".next": true,
	".turbo": true, "node_modules": true, "dist": true, "build": true,
	"coverage": true, "target": true, "__pycache__": true,
}

type FileSnippet struct {
	Path    string `json:"path"`
	Snippet string `json:"snippet"`
}

type Summary struct {
	RepoPath      string        `json:"repoPath"`
	TotalFiles    int           `json:"totalFiles"`
	DetectedStack []string      `json:"detectedStack"`
	FileTree      []string      `json:"fileTree"`
	KeyFiles      []FileSnippet `json:"keyFiles"`
}

type fileEntry struct {
	relativePath string
	absolutePath string
}

func AnalyzeRepository(basePath string) (*Summary, error) {
	expanded := util.ExpandTilde(basePath)
	repoRoot, err := resolveRepoRoot(expanded)
	if err != nil {
		return nil, err
	}

	var files []fileEntry
	collectFiles(repoRoot, repoRoot, 0, &files)

	sort.Slice(files, func(i, j int) bool {
		return files[i].relativePath < files[j].relativePath
	})

	totalFiles := len(files)
	var fileTree []string
	for i, entry := range files {
		if i >= maxTreeEntries {
			break
		}
		fileTree = append(fileTree, formatTreeLine(entry.relativePath))
	}

	detectedStack := detectStack(files)
	keyFiles := collectKeyFiles(files)

	return &Summary{
		RepoPath:      repoRoot,
		TotalFiles:    totalFiles,
		DetectedStack: detectedStack,
		FileTree:      fileTree,
		KeyFiles:      keyFiles,
	}, nil
}

func resolveRepoRoot(base string) (string, error) {
	for _, sub := range []string{"ORIGIN", "origin"} {
		p := filepath.Join(base, sub)
		if info, err := os.Stat(p); err == nil && info.IsDir() {
			return p, nil
		}
	}
	if _, err := os.Stat(filepath.Join(base, ".git")); err == nil {
		return base, nil
	}
	info, err := os.Stat(base)
	if err != nil || !info.IsDir() {
		return "", errors.New(errs.MsgNoAnalyzableCodeDir)
	}
	entries, _ := os.ReadDir(base)
	var dirs []string
	for _, e := range entries {
		if e.IsDir() {
			dirs = append(dirs, filepath.Join(base, e.Name()))
		}
	}
	sort.Strings(dirs)
	for _, d := range dirs {
		if _, err := os.Stat(filepath.Join(d, ".git")); err == nil {
			return d, nil
		}
	}
	if len(dirs) > 0 {
		return dirs[0], nil
	}
	return "", errors.New(errs.MsgNoAnalyzableCodeDir)
}

func collectFiles(root, current string, depth int, files *[]fileEntry) {
	if depth > maxDepth || len(*files) >= maxTrackedFiles {
		return
	}
	entries, err := os.ReadDir(current)
	if err != nil {
		return
	}
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Name() < entries[j].Name()
	})
	for _, entry := range entries {
		if len(*files) >= maxTrackedFiles {
			break
		}
		name := entry.Name()
		path := filepath.Join(current, name)
		if entry.IsDir() {
			if ignoredDirs[name] {
				continue
			}
			collectFiles(root, path, depth+1, files)
			continue
		}
		if !isTextCandidate(path) {
			continue
		}
		rel, _ := filepath.Rel(root, path)
		rel = strings.ReplaceAll(rel, "\\", "/")
		*files = append(*files, fileEntry{relativePath: rel, absolutePath: path})
	}
}

func detectStack(files []fileEntry) []string {
	paths := make(map[string]bool)
	for _, f := range files {
		paths[f.relativePath] = true
	}

	var stack []string
	if paths["package.json"] {
		stack = append(stack, "Node.js")
	}
	if paths["pnpm-lock.yaml"] || paths["yarn.lock"] || paths["package-lock.json"] {
		stack = append(stack, "JavaScript 包管理")
	}
	hasTS := paths["tsconfig.json"]
	if !hasTS {
		for _, f := range files {
			if strings.HasSuffix(f.relativePath, ".ts") || strings.HasSuffix(f.relativePath, ".tsx") {
				hasTS = true
				break
			}
		}
	}
	if hasTS {
		stack = append(stack, "TypeScript")
	}
	for _, f := range files {
		if strings.HasSuffix(f.relativePath, ".tsx") {
			stack = append(stack, "React")
			break
		}
	}
	if paths["Cargo.toml"] {
		stack = append(stack, "Rust")
	}
	if paths["pyproject.toml"] || paths["requirements.txt"] {
		stack = append(stack, "Python")
	}
	if paths["go.mod"] {
		stack = append(stack, "Go")
	}
	if paths["pom.xml"] || paths["build.gradle"] {
		stack = append(stack, "JVM")
	}
	if paths["Dockerfile"] {
		stack = append(stack, "Docker")
	}
	if len(stack) == 0 {
		stack = append(stack, "待识别项目")
	}
	return stack
}

func collectKeyFiles(files []fileEntry) []FileSnippet {
	sorted := make([]fileEntry, len(files))
	copy(sorted, files)
	sort.Slice(sorted, func(i, j int) bool {
		pi, pj := filePriority(sorted[i].relativePath), filePriority(sorted[j].relativePath)
		if pi != pj {
			return pi < pj
		}
		if len(sorted[i].relativePath) != len(sorted[j].relativePath) {
			return len(sorted[i].relativePath) < len(sorted[j].relativePath)
		}
		return sorted[i].relativePath < sorted[j].relativePath
	})

	var selected []FileSnippet
	for _, entry := range sorted {
		if len(selected) >= maxKeyFiles {
			break
		}
		info, err := os.Stat(entry.absolutePath)
		if err != nil || info.Size() > maxFileSizeBytes {
			continue
		}
		snippet := readSnippet(entry.absolutePath)
		if snippet == "" {
			continue
		}
		selected = append(selected, FileSnippet{Path: entry.relativePath, Snippet: snippet})
	}
	return selected
}

func filePriority(relativePath string) int {
	switch relativePath {
	case "README.md":
		return 0
	case "package.json":
		return 1
	case "Cargo.toml":
		return 2
	case "tsconfig.json":
		return 3
	case "vite.config.ts", "vite.config.js":
		return 4
	case "src/main.tsx", "src/main.ts", "src/main.rs":
		return 5
	case "src/App.tsx", "src/App.ts", "src/lib.rs":
		return 6
	}
	name := filepath.Base(relativePath)
	switch name {
	case "README.md":
		return 7
	case "package.json":
		return 8
	case "Cargo.toml":
		return 9
	case "tsconfig.json":
		return 10
	}
	if strings.HasPrefix(relativePath, "src/") {
		return 20
	}
	return 50
}

func readSnippet(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	lines := strings.SplitAfter(string(data), "\n")
	var sb strings.Builder
	for i, line := range lines {
		if i >= maxSnippetLines || sb.Len()+len(line) > maxSnippetChars {
			break
		}
		sb.WriteString(line)
	}
	return strings.TrimSpace(sb.String())
}

func formatTreeLine(relativePath string) string {
	depth := strings.Count(relativePath, "/")
	indent := strings.Repeat("  ", depth)
	name := filepath.Base(relativePath)
	return indent + "- " + name + " (" + relativePath + ")"
}

func isTextCandidate(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".ts", ".tsx", ".js", ".jsx", ".json", ".rs", ".py", ".go", ".java", ".kt",
		".swift", ".m", ".mm", ".md", ".txt", ".yml", ".yaml", ".toml", ".css",
		".scss", ".less", ".html", ".xml", ".sql", ".sh", ".rb", ".php", ".c",
		".cc", ".cpp", ".h", ".hpp", ".vue":
		return true
	}
	name := filepath.Base(path)
	return name == "Dockerfile" || name == "Makefile"
}
