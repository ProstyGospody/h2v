package telegramd

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Enabled      bool   `json:"enabled"`
	Listen       string `json:"listen"`
	PublicHost   string `json:"public_host"`
	PublicPort   int    `json:"public_port"`
	Secret       string `json:"secret"`
	MaskDomain   string `json:"mask_domain"`
	FallbackAddr string `json:"fallback_addr"`
}

func LoadConfig(path string) (Config, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return Config{}, err
	}
	var cfg Config
	if err := json.Unmarshal(content, &cfg); err != nil {
		return Config{}, err
	}
	cfg.normalize()
	if err := cfg.Validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func (c *Config) normalize() {
	c.Listen = strings.TrimSpace(c.Listen)
	c.PublicHost = strings.TrimSpace(c.PublicHost)
	c.Secret = strings.ToLower(strings.TrimSpace(c.Secret))
	c.MaskDomain = strings.TrimSpace(c.MaskDomain)
	c.FallbackAddr = strings.TrimSpace(c.FallbackAddr)
	if c.Listen == "" && c.PublicPort > 0 {
		c.Listen = net.JoinHostPort("0.0.0.0", strconv.Itoa(c.PublicPort))
	}
	if c.FallbackAddr == "" && c.MaskDomain != "" {
		c.FallbackAddr = net.JoinHostPort(c.MaskDomain, "443")
	}
}

func (c Config) Validate() error {
	if !c.Enabled {
		return nil
	}
	if c.Listen == "" {
		return errors.New("listen is required")
	}
	if c.PublicHost == "" {
		return errors.New("public_host is required")
	}
	if c.PublicPort < 1 || c.PublicPort > 65535 {
		return errors.New("public_port must be between 1 and 65535")
	}
	if len(c.Secret) != 32 {
		return errors.New("secret must be 32 hex characters")
	}
	if _, err := hex.DecodeString(c.Secret); err != nil {
		return fmt.Errorf("secret must be valid hex: %w", err)
	}
	if c.MaskDomain == "" {
		return errors.New("mask_domain is required")
	}
	if _, _, err := net.SplitHostPort(c.FallbackAddr); err != nil {
		return fmt.Errorf("fallback_addr must be host:port: %w", err)
	}
	return nil
}

func (c Config) SecretBytes() ([]byte, error) {
	return hex.DecodeString(c.Secret)
}
