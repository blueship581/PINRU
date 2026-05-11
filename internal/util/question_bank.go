package util

import "fmt"

// FormatQuestionBankLabel returns the managed GitLab project label for a question ID.
func FormatQuestionBankLabel(questionID int64) string {
	return fmt.Sprintf("label-%05d", questionID)
}

// BuildQuestionBankGitLabProjectRef returns the GitLab project path used by prompt2repo.
func BuildQuestionBankGitLabProjectRef(questionID int64) string {
	return "prompt2repo/" + FormatQuestionBankLabel(questionID)
}
