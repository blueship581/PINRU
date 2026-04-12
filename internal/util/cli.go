package util

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// ResolveCLI finds the named CLI binary, working around the stripped PATH that
// packaged GUI applications (Wails .app bundles) receive from the OS.
//
// Strategy:
//  1. Standard exec.LookPath – works in a terminal session.
//  2. Common install locations for npm/nvm/Homebrew/Volta binaries.
//  3. Login-shell probe – respects ~/.zprofile, ~/.bash_profile, etc.
func ResolveCLI(name string) (string, error) {
	// 1. Standard PATH lookup.
	if path, err := exec.LookPath(name); err == nil {
		return path, nil
	}

	// 2. Hardcoded candidate paths for packaged apps.
	home, _ := os.UserHomeDir()
	for _, p := range cliCandidatePaths(home, name) {
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}

	// 3. Ask a login shell (loads user profile, handles nvm/fnm/volta shims).
	if found := resolveViaLoginShell(name); found != "" {
		return found, nil
	}

	return "", &CLINotFoundError{Name: name}
}

// CLINotFoundError is returned by ResolveCLI when the binary cannot be found.
type CLINotFoundError struct {
	Name string
}

func (e *CLINotFoundError) Error() string {
	return e.Name + " 未找到，请先安装后重试"
}

// cliCandidatePaths returns a list of absolute paths to check for name.
func cliCandidatePaths(home, name string) []string {
	switch runtime.GOOS {
	case "darwin", "linux":
		paths := []string{
			"/usr/local/bin/" + name,
			"/opt/homebrew/bin/" + name,
			"/opt/homebrew/sbin/" + name,
			filepath.Join(home, ".volta", "bin", name),
			filepath.Join(home, ".npm-global", "bin", name),
			filepath.Join(home, ".local", "bin", name),
		}
		// nvm: read the default alias file to get the active Node version.
		if nvmBin := nvmBinPath(home, name); nvmBin != "" {
			paths = append(paths, nvmBin)
		}
		return paths

	case "windows":
		roaming := os.Getenv("APPDATA")
		if roaming == "" {
			roaming = filepath.Join(home, "AppData", "Roaming")
		}
		return []string{
			filepath.Join(roaming, "npm", name+".cmd"),
			filepath.Join(roaming, "npm", name),
			filepath.Join(home, "AppData", "Local", "npm", name+".cmd"),
		}

	default:
		return []string{
			"/usr/local/bin/" + name,
			filepath.Join(home, ".local", "bin", name),
		}
	}
}

// nvmBinPath resolves the active nvm Node version and returns the binary path.
// Returns empty string if nvm is not installed or the alias file cannot be read.
func nvmBinPath(home, name string) string {
	aliasFile := filepath.Join(home, ".nvm", "alias", "default")
	data, err := os.ReadFile(aliasFile)
	if err != nil {
		return ""
	}
	ver := strings.TrimSpace(string(data))
	// Skip empty, recursive, or non-version aliases.
	if ver == "" || strings.HasPrefix(ver, "->") || strings.Contains(ver, "/") {
		return ""
	}
	if !strings.HasPrefix(ver, "v") {
		ver = "v" + ver
	}
	return filepath.Join(home, ".nvm", "versions", "node", ver, "bin", name)
}

// resolveViaLoginShell runs `command -v <name>` in a login shell so that the
// user's profile (zprofile, bash_profile, etc.) is sourced. Returns the
// resolved path, or empty string on failure.
func resolveViaLoginShell(name string) string {
	// Build candidate shells in preference order.
	var shells []string
	if s := os.Getenv("SHELL"); s != "" {
		shells = append(shells, s)
	}
	switch runtime.GOOS {
	case "darwin":
		shells = append(shells, "/bin/zsh", "/bin/bash", "/bin/sh")
	default:
		shells = append(shells, "/bin/bash", "/bin/sh")
	}

	// name is always a hard-coded constant ("claude", "codex") – not user input.
	script := "command -v " + name + " 2>/dev/null"

	for _, shell := range shells {
		if _, err := os.Stat(shell); err != nil {
			continue
		}
		cmd := exec.Command(shell, "-l", "-c", script)
		out, err := cmd.Output()
		if err == nil {
			if p := strings.TrimSpace(string(out)); p != "" {
				return p
			}
		}
	}
	return ""
}
