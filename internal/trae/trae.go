// Package trae 提供 PINRU 对外部 trae MySQL 数据库 solo_coder_smartsheet_records
// 的只读访问，用于跨用户/跨设备的题目使用情况统计与提示词去重。
package trae

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

// Config 表示连接 trae MySQL 的参数。
type Config struct {
	Host     string
	Port     int
	User     string
	Password string
	DBName   string
}

// Client 封装一个已建立的连接池及配置中允许统计的 trae_user_id 集合。
// 当 UserIDs 为空时，所有查询都不会附加 trae_user_id 过滤（视为全量统计）。
type Client struct {
	db      *sql.DB
	userIDs []string
}

// SiblingPrompt 表示同一题源 (question_id) 下，单个 trae 会话窗口的首轮提示词。
type SiblingPrompt struct {
	RepoID     string
	WindowID   string
	TaskType   string
	UserPrompt string
	SubmitTime int64
}

func (c Config) dsn() string {
	host := strings.TrimSpace(c.Host)
	if host == "" {
		host = "127.0.0.1"
	}
	port := c.Port
	if port <= 0 {
		port = 3306
	}
	dbName := strings.TrimSpace(c.DBName)
	return fmt.Sprintf(
		"%s:%s@tcp(%s:%d)/%s?parseTime=true&charset=utf8mb4&loc=Local&readTimeout=10s&writeTimeout=10s",
		strings.TrimSpace(c.User), c.Password, host, port, dbName,
	)
}

// Open 建立 MySQL 连接池并 Ping 一次验证连通性。
func Open(cfg Config, userIDs []string) (*Client, error) {
	db, err := sql.Open("mysql", cfg.dsn())
	if err != nil {
		return nil, fmt.Errorf("打开 trae 数据库失败：%w", err)
	}
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(2)
	db.SetConnMaxLifetime(30 * time.Minute)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("连接 trae 数据库失败：%w", err)
	}

	return &Client{db: db, userIDs: normalizeUserIDs(userIDs)}, nil
}

func (c *Client) Close() error {
	if c == nil || c.db == nil {
		return nil
	}
	return c.db.Close()
}

func (c *Client) Ping(ctx context.Context) error {
	if c == nil || c.db == nil {
		return errors.New("trae 客户端未初始化")
	}
	return c.db.PingContext(ctx)
}

// NewClientFromDB 用现成 *sql.DB 包装客户端，便于在测试中注入 sqlmock。
func NewClientFromDB(db *sql.DB, userIDs []string) *Client {
	return &Client{db: db, userIDs: normalizeUserIDs(userIDs)}
}

// TestConnection 仅尝试建立连接并立即关闭，用于 settings 页测试连接按钮。
func TestConnection(cfg Config) error {
	client, err := Open(cfg, nil)
	if err != nil {
		return err
	}
	return client.Close()
}

func normalizeUserIDs(ids []string) []string {
	seen := make(map[string]struct{}, len(ids))
	result := make([]string, 0, len(ids))
	for _, raw := range ids {
		v := strings.TrimSpace(raw)
		if v == "" {
			continue
		}
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		result = append(result, v)
	}
	return result
}

// userFilterClause 拼接 "AND trae_user_id IN (?, ?, …)"，并把对应实参追加到 args。
// 当未配置 userIDs 时，返回空字符串和原 args（统计全量）。
func (c *Client) userFilterClause(args []any) (string, []any) {
	if len(c.userIDs) == 0 {
		return "", args
	}
	placeholders := strings.Repeat("?,", len(c.userIDs))
	placeholders = placeholders[:len(placeholders)-1]
	for _, id := range c.userIDs {
		args = append(args, id)
	}
	return " AND trae_user_id IN (" + placeholders + ")", args
}

// repoIDQuestionExpr 把 repo_id 中段（A-1565-7 中的 1565）解析为整数 question_id。
// 用 SUBSTRING_INDEX 截取，与本地 question_bank_project_ids 数字 ID 对齐。
const repoIDQuestionExpr = "CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(repo_id,'-',2),'-',-1) AS UNSIGNED)"

// repoIDPrefixFilter 限定 repo_id 以 'A-' 开头，避免误匹配 label-01496 等其他格式记录。
const repoIDPrefixFilter = "repo_id LIKE 'A-%'"

// CountUsedWindows 返回指定 questionID + taskType 下、被配置中 trae_user_id 使用过的
// 不同 trae_window_id 数量。一个 window 视为一次"题目复用"。
func (c *Client) CountUsedWindows(ctx context.Context, questionID int64, taskType string) (int, error) {
	if c == nil || c.db == nil {
		return 0, errors.New("trae 客户端未初始化")
	}
	if questionID <= 0 {
		return 0, nil
	}
	taskType = strings.TrimSpace(taskType)
	args := []any{questionID, taskType}
	userClause, args := c.userFilterClause(args)
	query := "SELECT COUNT(DISTINCT trae_window_id) FROM solo_coder_smartsheet_records WHERE " +
		repoIDPrefixFilter + " AND " + repoIDQuestionExpr + " = ? AND task_type = ?" + userClause

	var count int
	if err := c.db.QueryRowContext(ctx, query, args...).Scan(&count); err != nil {
		return 0, fmt.Errorf("统计 trae 已用窗口失败：%w", err)
	}
	return count, nil
}

// MaxVersionForQuestion 返回指定 questionID 下 repo_id 最末尾数字（version）的最大值。
// 用于在领题时跨设备推进 -N 序号。无记录时返回 0。
func (c *Client) MaxVersionForQuestion(ctx context.Context, questionID int64) (int, error) {
	if c == nil || c.db == nil {
		return 0, errors.New("trae 客户端未初始化")
	}
	if questionID <= 0 {
		return 0, nil
	}
	args := []any{questionID}
	userClause, args := c.userFilterClause(args)
	query := "SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(repo_id,'-',-1) AS UNSIGNED)), 0) " +
		"FROM solo_coder_smartsheet_records WHERE " + repoIDPrefixFilter + " AND " + repoIDQuestionExpr + " = ?" + userClause

	var max int
	if err := c.db.QueryRowContext(ctx, query, args...).Scan(&max); err != nil {
		return 0, fmt.Errorf("查询 trae 最大版本号失败：%w", err)
	}
	return max, nil
}

// ListFirstRoundPromptsByQuestion 返回同一 questionID 下，每个 trae_window_id
// 最早一次提交（最小 trae_submit_time）的 user_prompt。一个 window = 一道兄弟题。
func (c *Client) ListFirstRoundPromptsByQuestion(ctx context.Context, questionID int64) ([]SiblingPrompt, error) {
	if c == nil || c.db == nil {
		return nil, errors.New("trae 客户端未初始化")
	}
	if questionID <= 0 {
		return nil, nil
	}
	args := []any{questionID}
	userClause, args := c.userFilterClause(args)

	// 自连接：内层取每个 window 最早提交时间，外层拿对应行。
	query := `
SELECT r.repo_id, r.trae_window_id, r.task_type, r.user_prompt, r.trae_submit_time
  FROM solo_coder_smartsheet_records r
  JOIN (
        SELECT trae_window_id, MIN(trae_submit_time) AS first_t
          FROM solo_coder_smartsheet_records
         WHERE ` + repoIDPrefixFilter + ` AND ` + repoIDQuestionExpr + ` = ?` + userClause + `
         GROUP BY trae_window_id
       ) f ON r.trae_window_id = f.trae_window_id AND r.trae_submit_time = f.first_t
 WHERE ` + repoIDPrefixFilter + ` AND ` + repoIDQuestionExpr + ` = ?` + userClause + `
 ORDER BY r.trae_submit_time ASC`

	combined := append([]any{}, args...)            // inner: questionID + userIDs
	combined = append(combined, args...)            // outer: questionID + userIDs

	rows, err := c.db.QueryContext(ctx, query, combined...)
	if err != nil {
		return nil, fmt.Errorf("读取 trae 兄弟提示词失败：%w", err)
	}
	defer rows.Close()

	results := make([]SiblingPrompt, 0)
	for rows.Next() {
		var sp SiblingPrompt
		var submitTime sql.NullInt64
		var prompt sql.NullString
		var taskType sql.NullString
		if err := rows.Scan(&sp.RepoID, &sp.WindowID, &taskType, &prompt, &submitTime); err != nil {
			return nil, err
		}
		if taskType.Valid {
			sp.TaskType = taskType.String
		}
		if prompt.Valid {
			sp.UserPrompt = prompt.String
		}
		if submitTime.Valid {
			sp.SubmitTime = submitTime.Int64
		}
		if strings.TrimSpace(sp.UserPrompt) == "" {
			continue
		}
		results = append(results, sp)
	}
	return results, rows.Err()
}

// QuestionUsedVariants 表示某题在 trae 中已经被使用过的"变体"（版本号）数。
// 与 pr-manager 一致：variant 由 repo_id 末尾的 -N 标识，每个 (questionID, taskType,
// version) 三元组算一个变体。同一 version 在同一 taskType 下被提交多次只算一个。
type QuestionUsedVariants struct {
	UsedByTaskType map[string]int
}

// CountUsedVariantsByQuestions 批量统计每题、每类型已用的不同 version 数。
// 仅统计 repo_id 形如 A-{questionID}-{version} 的记录。questionIDs 去重后批量查询。
func (c *Client) CountUsedVariantsByQuestions(ctx context.Context, questionIDs []int64) (map[int64]QuestionUsedVariants, error) {
	if c == nil || c.db == nil {
		return nil, errors.New("trae 客户端未初始化")
	}
	uniq := uniqPositiveInt64s(questionIDs)
	result := make(map[int64]QuestionUsedVariants, len(uniq))
	if len(uniq) == 0 {
		return result, nil
	}

	placeholders := strings.Repeat("?,", len(uniq))
	placeholders = placeholders[:len(placeholders)-1]
	args := make([]any, 0, len(uniq))
	for _, id := range uniq {
		args = append(args, id)
	}
	userClause, args := c.userFilterClause(args)

	versionExpr := "CAST(SUBSTRING_INDEX(repo_id,'-',-1) AS UNSIGNED)"
	query := "SELECT " + repoIDQuestionExpr + " AS qid, task_type, " + versionExpr + " AS version" +
		" FROM solo_coder_smartsheet_records WHERE " + repoIDPrefixFilter +
		" AND " + repoIDQuestionExpr + " IN (" + placeholders + ")" + userClause +
		" GROUP BY qid, task_type, version"

	rows, err := c.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("统计 trae 已用变体失败：%w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var qid int64
		var taskType sql.NullString
		var version int64
		if err := rows.Scan(&qid, &taskType, &version); err != nil {
			return nil, err
		}
		t := strings.TrimSpace(taskType.String)
		if t == "" {
			continue
		}
		t = normalizeTaskTypeForPINRU(t)
		entry, ok := result[qid]
		if !ok {
			entry = QuestionUsedVariants{UsedByTaskType: map[string]int{}}
		}
		entry.UsedByTaskType[t]++
		result[qid] = entry
	}
	return result, rows.Err()
}

// normalizeTaskTypeForPINRU 把 trae 表中的 task_type 名归一到 PINRU 项目配置使用的命名。
// trae 沿用了 pr-manager 的早期约定（"0-1代码生成"），PINRU 用更简洁的"代码生成"，
// 直接字符串比对会漏掉所有代码生成类记录（这正是题库面板剩余数对不上的根因）。
func normalizeTaskTypeForPINRU(t string) string {
	switch t {
	case "0-1代码生成":
		return "代码生成"
	}
	return t
}

// QuestionMeta 描述 solo_coder_submitted_question_list 中的题目元数据。
// PINRU 仅消费 BusinessDomain（项目类型），其余字段保留为后续扩展。
type QuestionMeta struct {
	QuestionID      int64
	BusinessDomain  string
	ProjectType     string
	FrontendStack   string
	BackendStack    string
	DatabaseStack   string
	FileCount       int
}

// GetQuestionMetaByIDs 批量从 solo_coder_submitted_question_list 拉题目元数据。
// repo_id 形如 "A-1231"，提取中段数字与 questionID 比对。
func (c *Client) GetQuestionMetaByIDs(ctx context.Context, questionIDs []int64) (map[int64]QuestionMeta, error) {
	if c == nil || c.db == nil {
		return nil, errors.New("trae 客户端未初始化")
	}
	uniq := uniqPositiveInt64s(questionIDs)
	result := make(map[int64]QuestionMeta, len(uniq))
	if len(uniq) == 0 {
		return result, nil
	}

	placeholders := strings.Repeat("?,", len(uniq))
	placeholders = placeholders[:len(placeholders)-1]
	args := make([]any, 0, len(uniq))
	for _, id := range uniq {
		args = append(args, id)
	}

	// solo_coder_submitted_question_list.repo_id 形如 "A-1231"，无 -N 后缀。
	questionExpr := "CAST(SUBSTRING_INDEX(repo_id,'-',-1) AS UNSIGNED)"
	query := "SELECT " + questionExpr + " AS qid, business_domain, project_type, frontend_stack, backend_stack, database_stack, file_count" +
		" FROM solo_coder_submitted_question_list" +
		" WHERE repo_id REGEXP '^[AB]-[0-9]+$' AND " + questionExpr + " IN (" + placeholders + ")"

	rows, err := c.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("查询 trae 题目元数据失败：%w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var qid int64
		var bd, pt, fs, bs, ds sql.NullString
		var fc sql.NullInt64
		if err := rows.Scan(&qid, &bd, &pt, &fs, &bs, &ds, &fc); err != nil {
			return nil, err
		}
		// 同一 questionID 在 list 表里通常唯一；若有多行，后写入覆盖前者，本质等价。
		result[qid] = QuestionMeta{
			QuestionID:     qid,
			BusinessDomain: strings.TrimSpace(bd.String),
			ProjectType:    strings.TrimSpace(pt.String),
			FrontendStack:  strings.TrimSpace(fs.String),
			BackendStack:   strings.TrimSpace(bs.String),
			DatabaseStack:  strings.TrimSpace(ds.String),
			FileCount:      int(fc.Int64),
		}
	}
	return result, rows.Err()
}

// ListUsedVersionsForQuestion 返回 trae 中指定 questionID 出现过的全部 -N 版本号集合。
// 用于本地领题序号规划：把 trae 的版本与本地已用集合求并集后再分配空位，避免跨设备冲突。
func (c *Client) ListUsedVersionsForQuestion(ctx context.Context, questionID int64) (map[int]struct{}, error) {
	if c == nil || c.db == nil {
		return nil, errors.New("trae 客户端未初始化")
	}
	result := map[int]struct{}{}
	if questionID <= 0 {
		return result, nil
	}
	args := []any{questionID}
	userClause, args := c.userFilterClause(args)
	versionExpr := "CAST(SUBSTRING_INDEX(repo_id,'-',-1) AS UNSIGNED)"
	query := "SELECT DISTINCT " + versionExpr +
		" FROM solo_coder_smartsheet_records WHERE " + repoIDPrefixFilter +
		" AND " + repoIDQuestionExpr + " = ?" + userClause
	rows, err := c.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("查询 trae 版本号集合失败：%w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var v int64
		if err := rows.Scan(&v); err != nil {
			return nil, err
		}
		if v > 0 {
			result[int(v)] = struct{}{}
		}
	}
	return result, rows.Err()
}

func uniqPositiveInt64s(ids []int64) []int64 {
	seen := make(map[int64]struct{}, len(ids))
	out := make([]int64, 0, len(ids))
	for _, id := range ids {
		if id <= 0 {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}
