package trae

import (
	"context"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestCountUsedWindows(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock new: %v", err)
	}
	defer db.Close()

	client := NewClientFromDB(db, []string{"u1", "u2"})

	mock.ExpectQuery(regexp.QuoteMeta("SELECT COUNT(DISTINCT trae_window_id) FROM solo_coder_smartsheet_records WHERE repo_id LIKE 'A-%' AND CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(repo_id,'-',2),'-',-1) AS UNSIGNED) = ? AND task_type = ? AND trae_user_id IN (?,?)")).
		WithArgs(int64(1565), "代码生成", "u1", "u2").
		WillReturnRows(sqlmock.NewRows([]string{"c"}).AddRow(3))

	got, err := client.CountUsedWindows(context.Background(), 1565, "代码生成")
	if err != nil {
		t.Fatalf("CountUsedWindows: %v", err)
	}
	if got != 3 {
		t.Fatalf("got %d, want 3", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCountUsedWindowsNoUserFilter(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock new: %v", err)
	}
	defer db.Close()

	client := NewClientFromDB(db, nil)

	mock.ExpectQuery(regexp.QuoteMeta("SELECT COUNT(DISTINCT trae_window_id) FROM solo_coder_smartsheet_records WHERE repo_id LIKE 'A-%' AND CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(repo_id,'-',2),'-',-1) AS UNSIGNED) = ? AND task_type = ?")).
		WithArgs(int64(42), "Feature迭代").
		WillReturnRows(sqlmock.NewRows([]string{"c"}).AddRow(0))

	got, err := client.CountUsedWindows(context.Background(), 42, "Feature迭代")
	if err != nil {
		t.Fatal(err)
	}
	if got != 0 {
		t.Fatalf("got %d, want 0", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestMaxVersionForQuestion(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock new: %v", err)
	}
	defer db.Close()

	client := NewClientFromDB(db, []string{"u1"})

	mock.ExpectQuery(regexp.QuoteMeta("SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(repo_id,'-',-1) AS UNSIGNED)), 0) FROM solo_coder_smartsheet_records WHERE repo_id LIKE 'A-%' AND CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(repo_id,'-',2),'-',-1) AS UNSIGNED) = ? AND trae_user_id IN (?)")).
		WithArgs(int64(9999), "u1").
		WillReturnRows(sqlmock.NewRows([]string{"m"}).AddRow(7))

	got, err := client.MaxVersionForQuestion(context.Background(), 9999)
	if err != nil {
		t.Fatal(err)
	}
	if got != 7 {
		t.Fatalf("got %d, want 7", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestListFirstRoundPromptsByQuestion(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock new: %v", err)
	}
	defer db.Close()

	client := NewClientFromDB(db, []string{"u1"})

	rows := sqlmock.NewRows([]string{"repo_id", "trae_window_id", "task_type", "user_prompt", "trae_submit_time"}).
		AddRow("A-1565-1", "w1", "代码生成", "首轮 prompt 1", int64(100)).
		AddRow("A-1565-2", "w2", "Feature迭代", "首轮 prompt 2", int64(200))

	mock.ExpectQuery(`SELECT r\.repo_id, r\.trae_window_id, r\.task_type, r\.user_prompt, r\.trae_submit_time`).
		WithArgs(int64(1565), "u1", int64(1565), "u1").
		WillReturnRows(rows)

	got, err := client.ListFirstRoundPromptsByQuestion(context.Background(), 1565)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("len = %d, want 2", len(got))
	}
	if got[0].RepoID != "A-1565-1" || got[0].UserPrompt != "首轮 prompt 1" {
		t.Fatalf("row 0 mismatch: %+v", got[0])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestParseUserIDs(t *testing.T) {
	cases := []struct {
		in  string
		out []string
	}{
		{`["u1","u2","u1"]`, []string{"u1", "u2"}},
		{"", nil},
		{"u1, u2 , u3", []string{"u1", "u2", "u3"}},
	}
	for _, c := range cases {
		got := ParseUserIDs(c.in)
		if len(got) != len(c.out) {
			t.Fatalf("ParseUserIDs(%q) len=%d, want %d (%v)", c.in, len(got), len(c.out), got)
		}
		for i := range got {
			if got[i] != c.out[i] {
				t.Fatalf("ParseUserIDs(%q)[%d] = %q, want %q", c.in, i, got[i], c.out[i])
			}
		}
	}
}
