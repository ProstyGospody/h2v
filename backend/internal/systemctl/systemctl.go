package systemctl

import (
	"context"
	"fmt"
	"os/exec"
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
		return fmt.Errorf("systemctl restart %s: %s", service, string(out))
	}
	return nil
}

func (c *Controller) Reload(ctx context.Context, service string) error {
	if c.Disabled {
		return nil
	}
	cmd := exec.CommandContext(ctx, "sudo", "/bin/systemctl", "reload", service+".service")
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("systemctl reload %s: %s", service, string(out))
	}
	return nil
}
