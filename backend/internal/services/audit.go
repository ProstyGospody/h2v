package services

import (
	"context"

	"github.com/prost/h2v/backend/internal/domain"
	"github.com/prost/h2v/backend/internal/repo"
)

type AuditService struct {
	repo *repo.Repository
}

func NewAuditService(repository *repo.Repository) *AuditService {
	return &AuditService{repo: repository}
}

func (s *AuditService) List(ctx context.Context, limit int) ([]domain.AuditEntry, error) {
	return s.repo.ListAudit(ctx, limit)
}
