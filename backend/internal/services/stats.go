package services

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/prost/h2v/backend/internal/domain"
	"github.com/prost/h2v/backend/internal/repo"
	"github.com/prost/h2v/backend/internal/util"
)

type StatsService struct {
	repo      *repo.Repository
	xray      XrayAdapter
	hysteria  HysteriaAdapter
	cache     SubscriptionCache
	version   string
	startedAt time.Time
	metricsMu sync.Mutex
	prevCPU   *util.CPUSample
	prevNet   *util.NetworkSample
}

func NewStatsService(repository *repo.Repository, xray XrayAdapter, hysteria HysteriaAdapter, cache SubscriptionCache, version string, startedAt time.Time) *StatsService {
	service := &StatsService{
		repo:      repository,
		xray:      xray,
		hysteria:  hysteria,
		cache:     cache,
		version:   version,
		startedAt: startedAt,
	}
	if sample, err := util.ReadCPUSample(); err == nil {
		service.prevCPU = &sample
	}
	if sample, err := util.ReadNetworkSample(); err == nil {
		service.prevNet = &sample
	}
	return service
}

func (s *StatsService) Overview(ctx context.Context) (*domain.OverviewStats, error) {
	counts, todayTraffic, err := s.repo.GetOverviewCounts(ctx)
	if err != nil {
		return nil, err
	}
	online, err := s.repo.GetOnlineUsers(ctx)
	if err != nil {
		return nil, err
	}

	xrayStatus := "ok"
	if err := s.xray.Health(ctx); err != nil {
		xrayStatus = "fail: " + err.Error()
	}
	hyStatus := "ok"
	if err := s.hysteria.Health(ctx); err != nil {
		hyStatus = "fail: " + err.Error()
	}

	cpuUsage := 0.0
	if curr, err := util.ReadCPUSample(); err == nil {
		s.metricsMu.Lock()
		prev := s.prevCPU
		s.prevCPU = &curr
		s.metricsMu.Unlock()
		if prev != nil {
			cpuUsage = util.CPUUsagePercent(*prev, curr)
		}
	}

	memoryUsage := 0.0
	if value, err := util.MemoryUsagePercent(); err == nil {
		memoryUsage = value
	}

	networkRxBPS := int64(0)
	networkTxBPS := int64(0)
	if curr, err := util.ReadNetworkSample(); err == nil {
		s.metricsMu.Lock()
		prev := s.prevNet
		s.prevNet = &curr
		s.metricsMu.Unlock()
		if prev != nil {
			networkRxBPS, networkTxBPS = util.NetworkBytesPerSecond(*prev, curr)
		}
	}

	return &domain.OverviewStats{
		ExpiredUsers:            counts[string(domain.StatusExpired)],
		LimitedUsers:            counts[string(domain.StatusLimited)],
		DisabledUsers:           counts[string(domain.StatusDisabled)],
		TodayTraffic:            todayTraffic,
		CPUUsagePercent:         cpuUsage,
		MemoryUsagePercent:      memoryUsage,
		NetworkRxBytesPerSecond: networkRxBPS,
		NetworkTxBytesPerSecond: networkTxBPS,
		XrayStatus:              xrayStatus,
		HysteriaStatus:          hyStatus,
		UptimeSeconds:           int64(time.Since(s.startedAt).Seconds()),
		OnlineUsers:             online,
	}, nil
}

func (s *StatsService) Traffic(ctx context.Context, days int) ([]domain.TrafficPoint, error) {
	return s.repo.GetAggregateTraffic(ctx, days)
}

func (s *StatsService) Health(ctx context.Context) (*domain.HealthReport, error) {
	components := map[string]string{"db": "ok", "xray": "ok", "hysteria": "ok", "cache": "ok"}
	status := "ok"

	if err := s.repo.Ping(ctx); err != nil {
		components["db"] = "fail: " + err.Error()
		status = "degraded"
	}
	if err := s.xray.Health(ctx); err != nil {
		components["xray"] = "fail: " + err.Error()
		status = "degraded"
	}
	if err := s.hysteria.Health(ctx); err != nil {
		components["hysteria"] = "fail: " + err.Error()
		status = "degraded"
	}
	if s.cache.Size() <= 0 {
		components["cache"] = "warning: empty"
	}

	return &domain.HealthReport{
		Status:        status,
		Components:    components,
		Version:       s.version,
		UptimeSeconds: int64(time.Since(s.startedAt).Seconds()),
	}, nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
