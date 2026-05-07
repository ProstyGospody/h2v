package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/coreos/go-systemd/v22/daemon"

	"github.com/prost/h2v/backend/internal/telegramd"
)

func main() {
	configPath := flag.String("config", "/opt/mypanel/configs/telegram/config.json", "path to telegram proxy config")
	flag.Parse()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg, err := telegramd.LoadConfig(*configPath)
	if err != nil {
		logger.Error("failed to load config", "err", err)
		os.Exit(1)
	}
	server, err := telegramd.New(cfg, logger)
	if err != nil {
		logger.Error("failed to create server", "err", err)
		os.Exit(1)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	errCh := make(chan error, 1)
	go func() {
		errCh <- server.Serve(ctx)
	}()

	_, _ = daemon.SdNotify(false, daemon.SdNotifyReady)

	select {
	case <-ctx.Done():
	case err := <-errCh:
		if err != nil && !errors.Is(err, context.Canceled) {
			logger.Error("server failed", "err", err)
			os.Exit(1)
		}
	}
}
