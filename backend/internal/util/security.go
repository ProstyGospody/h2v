package util

import (
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"

	"golang.org/x/crypto/argon2"
)

const (
	argonTime    uint32 = 3
	argonMemory  uint32 = 64 * 1024
	argonThreads uint8  = 4
	argonKeyLen  uint32 = 32

	defaultArgonMaxParallel = 2
	maxArgonMaxParallel     = 16
)

var argonLimiter struct {
	once  sync.Once
	slots chan struct{}
}

func HashPassword(password string) (string, error) {
	salt, err := RandomBytes(16)
	if err != nil {
		return "", err
	}
	release := acquireArgonSlot()
	defer release()

	hash := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return fmt.Sprintf("$argon2id$v=19$m=%d,t=%d,p=%d$%s$%s",
		argonMemory,
		argonTime,
		argonThreads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(hash),
	), nil
}

func VerifyPassword(encodedHash, password string) bool {
	parts := strings.Split(encodedHash, "$")
	if len(parts) != 6 {
		return false
	}
	var memory, timeCost uint32
	var threads uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &timeCost, &threads); err != nil {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false
	}
	expected, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false
	}
	release := acquireArgonSlot()
	defer release()

	actual := argon2.IDKey([]byte(password), salt, timeCost, memory, threads, uint32(len(expected)))
	return subtle.ConstantTimeCompare(actual, expected) == 1
}

func acquireArgonSlot() func() {
	argonLimiter.once.Do(func() {
		argonLimiter.slots = make(chan struct{}, configuredArgonMaxParallel())
	})
	argonLimiter.slots <- struct{}{}
	return func() {
		<-argonLimiter.slots
	}
}

func configuredArgonMaxParallel() int {
	raw := strings.TrimSpace(os.Getenv("PANEL_ARGON2_MAX_PARALLEL"))
	if raw == "" {
		return defaultArgonMaxParallel
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 1 {
		return defaultArgonMaxParallel
	}
	if value > maxArgonMaxParallel {
		return maxArgonMaxParallel
	}
	return value
}
