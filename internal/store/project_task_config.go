package store

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

type ProjectTaskConfig struct {
	TaskTypes []string
	Quotas    map[string]int
	Totals    map[string]int
}

func normalizeTaskTypeList(taskTypes []string) []string {
	seen := make(map[string]struct{}, len(taskTypes))
	normalized := make([]string, 0, len(taskTypes))

	for _, taskType := range taskTypes {
		trimmed := strings.TrimSpace(taskType)
		if trimmed == "" {
			continue
		}
		if _, exists := seen[trimmed]; exists {
			continue
		}

		seen[trimmed] = struct{}{}
		normalized = append(normalized, trimmed)
	}

	return normalized
}

func parseTaskTypeList(raw string) ([]string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || trimmed == "[]" || strings.EqualFold(trimmed, "null") {
		return []string{}, nil
	}

	if strings.HasPrefix(trimmed, "[") {
		var parsed []any
		if err := json.Unmarshal([]byte(trimmed), &parsed); err != nil {
			return nil, fmt.Errorf("invalid task type JSON: %w", err)
		}

		taskTypes := make([]string, 0, len(parsed))
		for _, item := range parsed {
			taskTypes = append(taskTypes, fmt.Sprint(item))
		}
		return normalizeTaskTypeList(taskTypes), nil
	}

	taskTypes := strings.FieldsFunc(trimmed, func(r rune) bool {
		return r == ',' || r == '\n'
	})
	return normalizeTaskTypeList(taskTypes), nil
}

func marshalTaskTypeList(taskTypes []string) (string, error) {
	payload, err := json.Marshal(normalizeTaskTypeList(taskTypes))
	if err != nil {
		return "", err
	}
	return string(payload), nil
}

func cloneTaskTypeCountMap(source map[string]int) map[string]int {
	if len(source) == 0 {
		return make(map[string]int)
	}

	cloned := make(map[string]int, len(source))
	for taskType, count := range source {
		trimmed := strings.TrimSpace(taskType)
		if trimmed == "" {
			continue
		}
		cloned[trimmed] = count
	}
	return cloned
}

func mergeProjectTaskTypes(taskTypes []string, quotas, totals map[string]int) []string {
	merged := normalizeTaskTypeList(taskTypes)
	seen := make(map[string]struct{}, len(merged))
	for _, taskType := range merged {
		seen[taskType] = struct{}{}
	}

	extras := make([]string, 0, len(quotas)+len(totals))
	for _, counts := range []map[string]int{quotas, totals} {
		for taskType := range counts {
			trimmed := strings.TrimSpace(taskType)
			if trimmed == "" {
				continue
			}
			if _, exists := seen[trimmed]; exists {
				continue
			}

			seen[trimmed] = struct{}{}
			extras = append(extras, trimmed)
		}
	}

	sort.Strings(extras)
	return append(merged, extras...)
}

func parseProjectTaskConfig(taskTypesRaw, quotasRaw, totalsRaw string) (ProjectTaskConfig, error) {
	taskTypes, err := parseTaskTypeList(taskTypesRaw)
	if err != nil {
		return ProjectTaskConfig{}, err
	}

	quotas, err := parseTaskTypeCountMap(quotasRaw)
	if err != nil {
		return ProjectTaskConfig{}, err
	}

	totals, err := parseTaskTypeCountMap(totalsRaw)
	if err != nil {
		return ProjectTaskConfig{}, err
	}

	if len(totals) == 0 && len(quotas) > 0 {
		totals = cloneTaskTypeCountMap(quotas)
	}
	if len(quotas) == 0 && len(totals) > 0 {
		quotas = cloneTaskTypeCountMap(totals)
	}

	return ProjectTaskConfig{
		TaskTypes: mergeProjectTaskTypes(taskTypes, quotas, totals),
		Quotas:    quotas,
		Totals:    totals,
	}, nil
}

func (c ProjectTaskConfig) Serialize() (string, string, string, error) {
	quotas := cloneTaskTypeCountMap(c.Quotas)
	totals := cloneTaskTypeCountMap(c.Totals)

	if len(totals) == 0 && len(quotas) > 0 {
		totals = cloneTaskTypeCountMap(quotas)
	}
	if len(quotas) == 0 && len(totals) > 0 {
		quotas = cloneTaskTypeCountMap(totals)
	}

	taskTypesJSON, err := marshalTaskTypeList(mergeProjectTaskTypes(c.TaskTypes, quotas, totals))
	if err != nil {
		return "", "", "", err
	}

	quotasJSON, err := marshalTaskTypeCountMap(quotas)
	if err != nil {
		return "", "", "", err
	}

	totalsJSON, err := marshalTaskTypeCountMap(totals)
	if err != nil {
		return "", "", "", err
	}

	return taskTypesJSON, quotasJSON, totalsJSON, nil
}
