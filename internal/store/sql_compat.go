package store

import "fmt"

func unixTimestampExpr(column string) string {
	return fmt.Sprintf(
		`COALESCE(CASE
			WHEN typeof(%[1]s) = 'integer' THEN %[1]s
			WHEN typeof(%[1]s) = 'text' AND trim(%[1]s) <> '' THEN CAST(strftime('%%s', %[1]s) AS INTEGER)
			ELSE NULL
		END, 0)`,
		column,
	)
}

func nullableUnixTimestampExpr(column string) string {
	return fmt.Sprintf(
		`CASE
			WHEN typeof(%[1]s) = 'integer' THEN %[1]s
			WHEN typeof(%[1]s) = 'text' AND trim(%[1]s) <> '' THEN CAST(strftime('%%s', %[1]s) AS INTEGER)
			ELSE NULL
		END`,
		column,
	)
}
