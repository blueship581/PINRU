package prompt

import "testing"

func TestSplitPromptSectionsSeparatesConstraintLines(t *testing.T) {
	raw := "筛选条件切换后列表偶尔还停留在上一轮结果，需要保证页面只展示最后一次筛选结果。\n业务逻辑约束：已下架商品不能重新出现在可售列表。\n非代码回复约束：只描述用户看到的结果。"

	body, constraints := SplitPromptSections(raw)

	if body != "筛选条件切换后列表偶尔还停留在上一轮结果，需要保证页面只展示最后一次筛选结果。" {
		t.Fatalf("body = %q", body)
	}
	if len(constraints) != 2 {
		t.Fatalf("len(constraints) = %d, want 2", len(constraints))
	}
}

func TestPromptBodyRuneCountIgnoresConstraintLinesAndWhitespace(t *testing.T) {
	raw := "  登录后首页偶尔还是游客状态，需要保证刷新后立刻展示会员身份。 \n\n业务逻辑约束：游客缓存不能覆盖登录态。\n"

	if got := PromptBodyRuneCount(raw); got != 30 {
		t.Fatalf("PromptBodyRuneCount() = %d, want 30", got)
	}
}
