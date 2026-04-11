package store

import (
	"database/sql"
	"fmt"
)

func ensureRowsAffected(res sql.Result, err error, format string, args ...any) error {
	if err != nil {
		return err
	}
	rowsAffected, rowsErr := res.RowsAffected()
	if rowsErr != nil {
		return rowsErr
	}
	if rowsAffected == 0 {
		return fmt.Errorf(format, args...)
	}
	return nil
}
