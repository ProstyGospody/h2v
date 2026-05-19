package systemctl

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
)

type Controller struct {
	Disabled bool
}

func New(disabled bool) *Controller {
	return &Controller{Disabled: disabled}
}

func (c *Controller) Restart(ctx context.Context, service string) error {
	if c.Disabled {
		return nil
	}
	cmd := exec.CommandContext(ctx, "sudo", "/bin/systemctl", "restart", service+".service")
	if out, err := cmd.CombinedOutput(); err != nil {
		return commandError("restart", service, out, err)
	}
	return nil
}

func commandError(action string, service string, out []byte, err error) error {
	message := strings.TrimSpace(string(out))
	if message == "" {
		return fmt.Errorf("systemctl %s %s: %w", action, service, err)
	}
	return fmt.Errorf("systemctl %s %s: %s: %w", action, service, message, err)
}
