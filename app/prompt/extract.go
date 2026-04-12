package prompt

import (
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"
)

// ── CLI 输出中提取提示词 ─────────────────────────────────────────────────────

// GeneratedPromptPayload 是 CLI 输出中 JSON 格式提示词的结构。
type GeneratedPromptPayload struct {
	Version         int    `json:"version"`
	Prompt          string `json:"prompt"`
	PromptText      string `json:"promptText"`
	ArtifactPath    string `json:"artifactPath"`
	ArtifactPathAlt string `json:"artifact_path"`
	FileWritten     *bool  `json:"fileWritten"`
	FileWrittenAlt  *bool  `json:"file_written"`
}

const (
	PromptOutputStartMarker = "<<<PINRU_PROMPT_START>>>"
	PromptOutputEndMarker   = "<<<PINRU_PROMPT_END>>>"
)

func (p GeneratedPromptPayload) PromptValue() string {
	if strings.TrimSpace(p.Prompt) != "" {
		return strings.TrimSpace(p.Prompt)
	}
	return strings.TrimSpace(p.PromptText)
}

// ExtractPromptFromCLIOutput 从 CLI 输出中提取提示词文本。
// 支持 JSON payload、标记之间、启发式提取三种方式。
func ExtractPromptFromCLIOutput(output string) (string, error) {
	normalized := strings.TrimSpace(strings.ReplaceAll(output, "\r\n", "\n"))
	if normalized == "" {
		return "", fmt.Errorf("模型输出为空")
	}

	if payload, ok, err := ExtractPromptJSONPayload(normalized); ok {
		if err != nil {
			return "", err
		}
		return payload.PromptValue(), nil
	}

	if candidate, ok := ExtractPromptBetweenMarkers(normalized); ok {
		if cleaned := CleanPromptCandidate(candidate); PromptCandidateScore(cleaned) >= 4 {
			return cleaned, nil
		}
	}

	candidate := CleanPromptCandidate(normalized)
	if PromptCandidateScore(candidate) >= 4 {
		return candidate, nil
	}

	best := ""
	bestScore := 0
	for _, block := range strings.Split(normalized, "\n\n") {
		cleaned := CleanPromptCandidate(block)
		score := PromptCandidateScore(cleaned)
		if score > bestScore {
			best = cleaned
			bestScore = score
		}
	}
	if bestScore >= 4 {
		return best, nil
	}

	return "", fmt.Errorf("模型输出中没有识别到可用的提示词正文")
}

func ExtractPromptJSONPayload(output string) (GeneratedPromptPayload, bool, error) {
	candidates := []string{strings.TrimSpace(output)}
	if trimmedFence := strings.TrimSpace(TrimPromptCodeFence(output)); trimmedFence != "" && trimmedFence != candidates[0] {
		candidates = append(candidates, trimmedFence)
	}
	if jsonObject, ok := extractFirstJSONObject(output); ok {
		jsonObject = strings.TrimSpace(jsonObject)
		alreadyIncluded := false
		for _, candidate := range candidates {
			if candidate == jsonObject {
				alreadyIncluded = true
				break
			}
		}
		if !alreadyIncluded {
			candidates = append(candidates, jsonObject)
		}
	}

	var jsonErr error
	for _, candidate := range candidates {
		payload, ok, err := tryParsePromptJSONPayload(candidate)
		if ok {
			if err != nil {
				return GeneratedPromptPayload{}, true, err
			}
			return payload, true, nil
		}
		if err != nil && jsonErr == nil {
			jsonErr = err
		}
	}

	if jsonErr != nil {
		return GeneratedPromptPayload{}, false, nil
	}
	return GeneratedPromptPayload{}, false, nil
}

func tryParsePromptJSONPayload(candidate string) (GeneratedPromptPayload, bool, error) {
	trimmed := strings.TrimSpace(candidate)
	if trimmed == "" || !strings.HasPrefix(trimmed, "{") {
		return GeneratedPromptPayload{}, false, nil
	}

	var payload GeneratedPromptPayload
	if err := json.Unmarshal([]byte(trimmed), &payload); err != nil {
		return GeneratedPromptPayload{}, true, fmt.Errorf("JSON 解析失败: %w", err)
	}

	promptText := payload.PromptValue()
	if promptText == "" {
		return GeneratedPromptPayload{}, true, fmt.Errorf("JSON 中 prompt 为空")
	}

	payload.Prompt = promptText
	return payload, true, nil
}

func extractFirstJSONObject(text string) (string, bool) {
	for start := 0; start < len(text); start++ {
		if text[start] != '{' {
			continue
		}
		if candidate, ok := extractBalancedJSONObject(text[start:]); ok {
			return candidate, true
		}
	}
	return "", false
}

func extractBalancedJSONObject(text string) (string, bool) {
	depth := 0
	inString := false
	escaped := false

	for index, r := range text {
		if escaped {
			escaped = false
			continue
		}
		if inString {
			switch r {
			case '\\':
				escaped = true
			case '"':
				inString = false
			}
			continue
		}

		switch r {
		case '"':
			inString = true
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return text[:index+utf8.RuneLen(r)], true
			}
			if depth < 0 {
				return "", false
			}
		}
	}

	return "", false
}

func ExtractPromptBetweenMarkers(output string) (string, bool) {
	start := strings.Index(output, PromptOutputStartMarker)
	if start < 0 {
		return "", false
	}
	afterStart := output[start+len(PromptOutputStartMarker):]
	end := strings.Index(afterStart, PromptOutputEndMarker)
	if end < 0 {
		return "", false
	}
	return strings.TrimSpace(afterStart[:end]), true
}

func CleanPromptCandidate(raw string) string {
	text := strings.TrimSpace(strings.ReplaceAll(raw, "\r\n", "\n"))
	if text == "" {
		return ""
	}

	text = TrimPromptCodeFence(text)
	lines := strings.Split(text, "\n")
	cleaned := make([]string, 0, len(lines))
	lastWasBlank := false

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			if len(cleaned) == 0 || lastWasBlank {
				continue
			}
			cleaned = append(cleaned, "")
			lastWasBlank = true
			continue
		}

		lastWasBlank = false
		if line == PromptOutputStartMarker || line == PromptOutputEndMarker {
			continue
		}

		line = strings.TrimSpace(StripPromptLeadIn(line))
		if line == "" || IsPromptStatusLine(line) || IsPromptNoiseLine(line) {
			continue
		}

		cleaned = append(cleaned, line)
	}

	return strings.TrimSpace(strings.Join(cleaned, "\n"))
}

func TrimPromptCodeFence(text string) string {
	if !strings.HasPrefix(text, "```") {
		return text
	}

	lines := strings.Split(text, "\n")
	if len(lines) < 2 {
		return text
	}
	if !strings.HasPrefix(strings.TrimSpace(lines[0]), "```") {
		return text
	}
	lastLine := strings.TrimSpace(lines[len(lines)-1])
	if lastLine != "```" {
		return text
	}

	return strings.TrimSpace(strings.Join(lines[1:len(lines)-1], "\n"))
}

func StripPromptLeadIn(line string) string {
	prefixes := []string{
		"最终提示词：",
		"最终提示词:",
		"提示词：",
		"提示词:",
		"润色后提示词：",
		"润色后提示词:",
		"以下是最终提示词：",
		"以下是最终提示词:",
		"以下是提示词：",
		"以下是提示词:",
		"以下是润色后的提示词：",
		"以下是润色后的提示词:",
		"回显提示词：",
		"回显提示词:",
	}
	for _, prefix := range prefixes {
		if strings.HasPrefix(line, prefix) {
			return strings.TrimSpace(strings.TrimPrefix(line, prefix))
		}
	}
	return line
}

func IsPromptStatusLine(line string) bool {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return false
	}

	lower := strings.ToLower(trimmed)
	if strings.Contains(trimmed, "任务提示词.md") {
		return true
	}
	if strings.HasPrefix(trimmed, "/") && strings.HasSuffix(lower, ".md") {
		return true
	}
	if len(trimmed) > 2 && trimmed[1] == ':' && (trimmed[2] == '\\' || trimmed[2] == '/') && strings.HasSuffix(lower, ".md") {
		return true
	}

	prefixes := []string{
		"已写入",
		"已保存到",
		"写入路径",
		"保存路径",
		"输出路径",
		"文件路径",
		"绝对路径",
		"path:",
		"路径:",
		"pwd:",
		"写入到",
		"文件已保存",
		"生成文件",
	}
	for _, prefix := range prefixes {
		if strings.HasPrefix(lower, strings.ToLower(prefix)) {
			return true
		}
	}

	return false
}

func IsPromptNoiseLine(line string) bool {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return false
	}

	if utf8.RuneCountInString(trimmed) <= 24 && (strings.HasSuffix(trimmed, "：") || strings.HasSuffix(trimmed, ":")) {
		if strings.Contains(trimmed, "提示词") || strings.Contains(trimmed, "结果") {
			return true
		}
	}

	prefixes := []string{
		"已完成，结果如下",
		"已完成，提示词如下",
		"生成完成，结果如下",
		"以下是最终提示词",
		"以下是提示词",
		"以下是润色后的提示词",
		"最终提示词如下",
		"润色后的提示词如下",
		"这是最终提示词",
		"这是润色后的提示词",
		"任务提示词如下",
		"回显提示词如下",
		"请查收",
	}
	for _, prefix := range prefixes {
		if strings.HasPrefix(trimmed, prefix) {
			return true
		}
	}

	return false
}

func PromptCandidateScore(text string) int {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return 0
	}

	score := 0
	runeCount := utf8.RuneCountInString(trimmed)
	switch {
	case runeCount >= 30:
		score += 2
	case runeCount >= 12:
		score += 1
	}

	if containsHanRune(trimmed) {
		score += 2
	}
	if strings.ContainsAny(trimmed, "。！？") {
		score += 2
	}
	if strings.Contains(trimmed, "约束") {
		score += 1
	}

	nonEmptyLines := 0
	for _, line := range strings.Split(trimmed, "\n") {
		if strings.TrimSpace(line) != "" {
			nonEmptyLines++
		}
	}
	switch {
	case nonEmptyLines >= 2 && nonEmptyLines <= 6:
		score += 2
	case nonEmptyLines == 1:
		score += 1
	case nonEmptyLines > 8:
		score--
	}

	if strings.Contains(trimmed, "任务提示词.md") {
		score -= 6
	}
	if IsPromptStatusLine(trimmed) {
		score -= 6
	}

	return score
}

func containsHanRune(text string) bool {
	for _, r := range text {
		if r >= 0x4E00 && r <= 0x9FFF {
			return true
		}
	}
	return false
}
