package trae

import (
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"sync"

	"github.com/blueship581/pinru/internal/store"
)

// 与 app/config/service.go 中保存的 key 保持一致；放在 trae 包内便于其他服务直接 Reload。
const (
	ConfigKeyHost     = "trae_db_host"
	ConfigKeyPort     = "trae_db_port"
	ConfigKeyUser     = "trae_db_user"
	ConfigKeyPassword = "trae_db_password"
	ConfigKeyDBName   = "trae_db_name"
	ConfigKeyUserIDs  = "trae_user_ids"
)

// Provider 按需建立 trae 客户端：首次访问时根据 store 配置建立，配置变更后调用
// Reload() 关闭旧连接、强制下次 Get() 重新打开。配置不完整时 Get 返回错误，但
// 上层应将错误降级为"trae 不可用，按本地数据兜底"，而非中断主流程。
type Provider struct {
	store  *store.Store
	mu     sync.Mutex
	client *Client
	loaded bool // true 表示已经尝试过加载（成功或失败），避免反复重连
	err    error
}

func NewProvider(s *store.Store) *Provider {
	return &Provider{store: s}
}

// Get 返回当前的 trae 客户端，如未加载则尝试建立一次。
func (p *Provider) Get() (*Client, error) {
	if p == nil {
		return nil, errors.New("trae provider 未初始化")
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.loaded {
		return p.client, p.err
	}
	p.loadLocked()
	return p.client, p.err
}

// Reload 关闭已有连接并清除缓存，下次 Get 时重新读配置建立连接。
// 在 ConfigService.SaveTraeDBSettings 之后调用。
func (p *Provider) Reload() {
	if p == nil {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.client != nil {
		_ = p.client.Close()
	}
	p.client = nil
	p.err = nil
	p.loaded = false
}

func (p *Provider) loadLocked() {
	cfg, userIDs, ok, err := loadConfig(p.store)
	if err != nil {
		p.err = err
		p.loaded = true
		return
	}
	if !ok {
		p.err = errors.New("trae 数据库未配置")
		p.loaded = true
		return
	}
	client, err := Open(cfg, userIDs)
	if err != nil {
		p.err = err
		p.loaded = true
		return
	}
	p.client = client
	p.err = nil
	p.loaded = true
}

// loadConfig 从 store 读取连接参数。所有必填字段都填了才认为"已配置"。
func loadConfig(s *store.Store) (Config, []string, bool, error) {
	if s == nil {
		return Config{}, nil, false, nil
	}
	host, err := s.GetConfig(ConfigKeyHost)
	if err != nil {
		return Config{}, nil, false, err
	}
	portRaw, err := s.GetConfig(ConfigKeyPort)
	if err != nil {
		return Config{}, nil, false, err
	}
	user, err := s.GetConfig(ConfigKeyUser)
	if err != nil {
		return Config{}, nil, false, err
	}
	password, err := s.GetConfig(ConfigKeyPassword)
	if err != nil {
		return Config{}, nil, false, err
	}
	dbName, err := s.GetConfig(ConfigKeyDBName)
	if err != nil {
		return Config{}, nil, false, err
	}
	userIDsRaw, err := s.GetConfig(ConfigKeyUserIDs)
	if err != nil {
		return Config{}, nil, false, err
	}

	host = strings.TrimSpace(host)
	user = strings.TrimSpace(user)
	dbName = strings.TrimSpace(dbName)
	if host == "" || user == "" || dbName == "" {
		return Config{}, nil, false, nil
	}
	port := 3306
	if v := strings.TrimSpace(portRaw); v != "" {
		parsed, perr := strconv.Atoi(v)
		if perr == nil && parsed > 0 {
			port = parsed
		}
	}

	return Config{
			Host:     host,
			Port:     port,
			User:     user,
			Password: password,
			DBName:   dbName,
		},
		ParseUserIDs(userIDsRaw),
		true,
		nil
}

// ParseUserIDs 把存于 store 的 trae_user_ids JSON 数组（或逗号分隔回退）解析为字符串数组。
func ParseUserIDs(raw string) []string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || trimmed == "[]" || strings.EqualFold(trimmed, "null") {
		return nil
	}
	if strings.HasPrefix(trimmed, "[") {
		var ids []string
		if err := json.Unmarshal([]byte(trimmed), &ids); err == nil {
			return normalizeUserIDs(ids)
		}
	}
	parts := strings.FieldsFunc(trimmed, func(r rune) bool { return r == ',' || r == '\n' })
	return normalizeUserIDs(parts)
}

// MarshalUserIDs 把字符串数组规范化后序列化成 JSON。
func MarshalUserIDs(ids []string) (string, error) {
	normalized := normalizeUserIDs(ids)
	if normalized == nil {
		normalized = []string{}
	}
	payload, err := json.Marshal(normalized)
	if err != nil {
		return "", err
	}
	return string(payload), nil
}
