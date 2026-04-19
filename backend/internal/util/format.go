package util

import (
	"fmt"
	"time"
)

func FormatSubscriptionUserInfo(used, total int64, expiresAt *time.Time) string {
	expire := int64(0)
	if expiresAt != nil {
		expire = expiresAt.Unix()
	}
	return fmt.Sprintf("upload=0; download=%d; total=%d; expire=%d", used, total, expire)
}

