package services

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/prost/h2v/backend/internal/domain"
	"github.com/prost/h2v/backend/internal/repo"
	"github.com/prost/h2v/backend/internal/util"
)

type SubscriptionService struct {
	repo     *repo.Repository
	settings *SettingsService
	cache    SubscriptionCache
}

func NewSubscriptionService(repository *repo.Repository, settings *SettingsService, cache SubscriptionCache) *SubscriptionService {
	return &SubscriptionService{repo: repository, settings: settings, cache: cache}
}

func (s *SubscriptionService) LinksForUser(ctx context.Context, user *domain.User) (*domain.SubscriptionLinks, error) {
	runtime, err := s.settings.Runtime(ctx)
	if err != nil {
		return nil, err
	}

	vless := buildVLESS(runtime, user)
	hy2 := buildHysteria2(runtime, user)
	subURL := strings.TrimSuffix(runtime.SubURLPrefix, "/") + "/sub/" + user.SubToken

	return &domain.SubscriptionLinks{
		Subscription: subURL,
		VLESS:        vless,
		Hysteria2:    hy2,
		Usage: domain.UsageSnapshot{
			TrafficLimit: user.TrafficLimit,
			TrafficUsed:  user.TrafficUsed,
			ExpiresAt:    user.ExpiresAt,
			Status:       user.Status,
		},
		Username: user.Username,
	}, nil
}

func (s *SubscriptionService) RotateByToken(ctx context.Context, token string) (*domain.SubscriptionLinks, error) {
	user, err := s.repo.GetUserByToken(ctx, token)
	if err != nil {
		return nil, err
	}
	next, err := util.RandomToken(32)
	if err != nil {
		return nil, err
	}
	user.SubToken = next
	user.UpdatedAt = time.Now().UTC()
	if err := s.repo.UpdateUser(ctx, user); err != nil {
		return nil, err
	}
	s.cache.Set(user)
	return s.LinksForUser(ctx, user)
}

func (s *SubscriptionService) CheckPassword(ctx context.Context, password string) (*domain.User, bool) {
	if strings.TrimSpace(password) == "" {
		return nil, false
	}
	if user, ok := s.cache.GetByPassword(password); ok {
		return user, true
	}
	user, err := s.repo.GetUserByHY2Password(ctx, password)
	if err != nil {
		return nil, false
	}
	if user.CanConnect() {
		s.cache.Set(user)
	} else {
		s.cache.Delete(user)
	}
	return user, true
}

func (s *SubscriptionService) ResolveByToken(ctx context.Context, token string) (*domain.User, *domain.SubscriptionLinks, error) {
	user, err := s.repo.GetUserByToken(ctx, token)
	if err != nil {
		return nil, nil, err
	}
	links, err := s.LinksForUser(ctx, user)
	if err != nil {
		return nil, nil, err
	}
	return user, links, nil
}

func EncodedLinks(links *domain.SubscriptionLinks) string {
	return base64.StdEncoding.EncodeToString([]byte(links.VLESS + "\n" + links.Hysteria2))
}

func (s *SubscriptionService) BuildClashYAML(links *domain.SubscriptionLinks) (string, error) {
	nodes, err := parseSubscriptionNodes(links)
	if err != nil {
		return "", domain.NewError(500, "invalid_subscription_links", "Generated subscription links are invalid", err)
	}

	var out strings.Builder
	out.WriteString("proxies:\n")
	writeClashVLESS(&out, nodes.VLESS)
	writeClashHysteria2(&out, nodes.Hysteria2)
	out.WriteString("proxy-groups:\n")
	out.WriteString("  - name: \"PROXY\"\n")
	out.WriteString("    type: select\n")
	out.WriteString("    proxies:\n")
	out.WriteString("      - " + yamlString(nodes.VLESS.Name) + "\n")
	out.WriteString("      - " + yamlString(nodes.Hysteria2.Name) + "\n")
	out.WriteString("rules:\n")
	out.WriteString("  - MATCH,PROXY\n")
	return out.String(), nil
}

func (s *SubscriptionService) BuildSingBoxJSON(links *domain.SubscriptionLinks) ([]byte, error) {
	nodes, err := parseSubscriptionNodes(links)
	if err != nil {
		return nil, domain.NewError(500, "invalid_subscription_links", "Generated subscription links are invalid", err)
	}
	payload := map[string]any{
		"log": map[string]any{"level": "warn"},
		"inbounds": []map[string]any{
			{
				"type":        "mixed",
				"tag":         "mixed-in",
				"listen":      "127.0.0.1",
				"listen_port": 2080,
			},
		},
		"outbounds": []map[string]any{
			singBoxSelectorOutbound(nodes),
			singBoxVLESSOutbound(nodes.VLESS),
			singBoxHysteria2Outbound(nodes.Hysteria2),
			{"type": "direct", "tag": "direct"},
			{"type": "block", "tag": "block"},
		},
		"route": map[string]any{
			"auto_detect_interface": true,
			"final":                 "PROXY",
		},
	}
	return json.Marshal(payload)
}

func (s *SubscriptionService) BuildUserInfoHeader(user *domain.User) string {
	return util.FormatSubscriptionUserInfo(user.TrafficUsed, user.TrafficLimit, user.ExpiresAt)
}

type ClientEntry struct {
	UUID  string
	Email string
}

type RuntimeSettings struct {
	PanelDomain        string
	PanelPort          int
	SubURLPrefix       string
	RealitySNI         string
	RealityDest        string
	RealityPublicKey   string
	RealityPrivateKey  string
	RealityServerNames []string
	RealityShortIDs    []string
	XrayAPIHost         string
	XrayAPIPort         int
	VlessPort          int
	Hy2Domain          string
	Hy2Port            int
	Hy2ObfsEnabled     bool
	Hy2ObfsPassword    string
	Hy2BandwidthUp     string
	Hy2BandwidthDown   string
	Hy2MasqueradeURL   string
	Hy2TrafficListen   string
	Hy2TrafficSecret   string
	Hy2CertPath        string
	Hy2KeyPath         string
	Clients            []ClientEntry
}

// buildVLESS emits a VLESS + Reality URI per Xray's share-link convention:
//
//	vless://UUID@HOST:PORT?encryption=none&flow=xtls-rprx-vision&security=reality
//	    &sni=SNI&fp=chrome&pbk=PUBLIC_KEY&sid=SHORT_ID&spx=%2F&type=tcp#NAME
//
// sid is optional: when the server allows an empty shortId, clients must pass
// no sid or an explicit empty one. We pick the first non-empty shortId so the
// client has a concrete value that matches the server list.
func buildVLESS(runtime RuntimeSettings, user *domain.User) string {
	shortID := firstInSlice(runtime.RealityShortIDs)
	sni := hostOnly(firstNonEmpty(runtime.RealitySNI, firstInSlice(runtime.RealityServerNames)))
	host := hostOnly(runtime.PanelDomain)

	query := url.Values{}
	query.Set("encryption", "none")
	query.Set("flow", "xtls-rprx-vision")
	query.Set("security", "reality")
	query.Set("sni", sni)
	query.Set("fp", "chrome")
	query.Set("pbk", runtime.RealityPublicKey)
	if shortID != "" {
		query.Set("sid", shortID)
	}
	query.Set("spx", "/")
	query.Set("type", "tcp")

	return (&url.URL{
		Scheme:   "vless",
		User:     url.User(user.VlessUUID.String()),
		Host:     net.JoinHostPort(host, strconv.Itoa(runtime.VlessPort)),
		RawQuery: query.Encode(),
		Fragment: user.Username + "-VLESS",
	}).String()
}

// buildHysteria2 emits a Hysteria 2 URI per the official scheme:
//
//	hysteria2://AUTH@HOST:PORT/?sni=SNI&insecure=0&obfs=salamander&obfs-password=PWD#NAME
//
// The password is percent-encoded by net/url. Path is "/" to keep parsers that
// expect an explicit host/path boundary happy; clients ignore it.
func buildHysteria2(runtime RuntimeSettings, user *domain.User) string {
	host := hostOnly(runtime.Hy2Domain)
	sni := host

	query := url.Values{}
	query.Set("sni", sni)
	query.Set("insecure", "0")
	if runtime.Hy2ObfsEnabled && runtime.Hy2ObfsPassword != "" {
		query.Set("obfs", "salamander")
		query.Set("obfs-password", runtime.Hy2ObfsPassword)
	}

	return (&url.URL{
		Scheme:   "hysteria2",
		User:     url.User(user.Hy2Password),
		Host:     net.JoinHostPort(host, strconv.Itoa(runtime.Hy2Port)),
		Path:     "/",
		RawQuery: query.Encode(),
		Fragment: user.Username + "-HY2",
	}).String()
}

type subscriptionNodes struct {
	VLESS     vlessNode
	Hysteria2 hysteria2Node
}

type vlessNode struct {
	Name        string
	UUID        string
	Server      string
	Port        int
	Flow        string
	RealityPBK  string
	RealitySID  string
	SNI         string
	Fingerprint string
}

type hysteria2Node struct {
	Name         string
	Password     string
	Server       string
	Port         int
	SNI          string
	Insecure     bool
	Obfs         string
	ObfsPassword string
}

func parseSubscriptionNodes(links *domain.SubscriptionLinks) (subscriptionNodes, error) {
	vless, err := parseVLESSLink(links.VLESS)
	if err != nil {
		return subscriptionNodes{}, err
	}
	hy2, err := parseHysteria2Link(links.Hysteria2)
	if err != nil {
		return subscriptionNodes{}, err
	}
	return subscriptionNodes{VLESS: vless, Hysteria2: hy2}, nil
}

func parseVLESSLink(raw string) (vlessNode, error) {
	parsed, err := url.Parse(raw)
	if err != nil {
		return vlessNode{}, err
	}
	if parsed.Scheme != "vless" {
		return vlessNode{}, fmt.Errorf("expected vless URI, got %q", parsed.Scheme)
	}
	if parsed.User == nil || parsed.User.Username() == "" {
		return vlessNode{}, fmt.Errorf("vless URI is missing uuid")
	}
	if parsed.Hostname() == "" {
		return vlessNode{}, fmt.Errorf("vless URI is missing server")
	}
	port, err := strconv.Atoi(parsed.Port())
	if err != nil {
		return vlessNode{}, err
	}
	q := parsed.Query()
	return vlessNode{
		Name:        firstNonEmpty(parsed.Fragment, "VLESS"),
		UUID:        parsed.User.Username(),
		Server:      parsed.Hostname(),
		Port:        port,
		Flow:        firstNonEmpty(q.Get("flow"), "xtls-rprx-vision"),
		RealityPBK:  q.Get("pbk"),
		RealitySID:  q.Get("sid"),
		SNI:         q.Get("sni"),
		Fingerprint: firstNonEmpty(q.Get("fp"), "chrome"),
	}, nil
}

func parseHysteria2Link(raw string) (hysteria2Node, error) {
	parsed, err := url.Parse(raw)
	if err != nil {
		return hysteria2Node{}, err
	}
	if parsed.Scheme != "hysteria2" && parsed.Scheme != "hy2" {
		return hysteria2Node{}, fmt.Errorf("expected hysteria2 URI, got %q", parsed.Scheme)
	}
	if parsed.User == nil || parsed.User.Username() == "" {
		return hysteria2Node{}, fmt.Errorf("hysteria2 URI is missing auth")
	}
	if parsed.Hostname() == "" {
		return hysteria2Node{}, fmt.Errorf("hysteria2 URI is missing server")
	}
	port, err := strconv.Atoi(parsed.Port())
	if err != nil {
		return hysteria2Node{}, err
	}
	q := parsed.Query()
	return hysteria2Node{
		Name:         firstNonEmpty(parsed.Fragment, "Hysteria 2"),
		Password:     parsed.User.Username(),
		Server:       parsed.Hostname(),
		Port:         port,
		SNI:          firstNonEmpty(q.Get("sni"), parsed.Hostname()),
		Insecure:     q.Get("insecure") == "1" || strings.EqualFold(q.Get("insecure"), "true"),
		Obfs:         q.Get("obfs"),
		ObfsPassword: q.Get("obfs-password"),
	}, nil
}

func writeClashVLESS(out *strings.Builder, node vlessNode) {
	out.WriteString("  - name: " + yamlString(node.Name) + "\n")
	out.WriteString("    type: vless\n")
	out.WriteString("    server: " + yamlString(node.Server) + "\n")
	out.WriteString(fmt.Sprintf("    port: %d\n", node.Port))
	out.WriteString("    udp: true\n")
	out.WriteString("    uuid: " + yamlString(node.UUID) + "\n")
	out.WriteString("    flow: " + yamlString(node.Flow) + "\n")
	out.WriteString("    packet-encoding: xudp\n")
	out.WriteString("    tls: true\n")
	out.WriteString("    servername: " + yamlString(node.SNI) + "\n")
	out.WriteString("    client-fingerprint: " + yamlString(node.Fingerprint) + "\n")
	out.WriteString("    skip-cert-verify: false\n")
	out.WriteString("    reality-opts:\n")
	out.WriteString("      public-key: " + yamlString(node.RealityPBK) + "\n")
	out.WriteString("      short-id: " + yamlString(node.RealitySID) + "\n")
	out.WriteString("    encryption: \"\"\n")
	out.WriteString("    network: tcp\n")
}

func writeClashHysteria2(out *strings.Builder, node hysteria2Node) {
	out.WriteString("  - name: " + yamlString(node.Name) + "\n")
	out.WriteString("    type: hysteria2\n")
	out.WriteString("    server: " + yamlString(node.Server) + "\n")
	out.WriteString(fmt.Sprintf("    port: %d\n", node.Port))
	out.WriteString("    password: " + yamlString(node.Password) + "\n")
	out.WriteString("    sni: " + yamlString(node.SNI) + "\n")
	out.WriteString(fmt.Sprintf("    skip-cert-verify: %t\n", node.Insecure))
	out.WriteString("    alpn:\n")
	out.WriteString("      - h3\n")
	if node.Obfs != "" {
		out.WriteString("    obfs: " + yamlString(node.Obfs) + "\n")
		out.WriteString("    obfs-password: " + yamlString(node.ObfsPassword) + "\n")
	}
}

func singBoxSelectorOutbound(nodes subscriptionNodes) map[string]any {
	return map[string]any{
		"type":      "selector",
		"tag":       "PROXY",
		"outbounds": []string{nodes.VLESS.Name, nodes.Hysteria2.Name},
		"default":   nodes.Hysteria2.Name,
	}
}

func singBoxVLESSOutbound(node vlessNode) map[string]any {
	return map[string]any{
		"type":            "vless",
		"tag":             node.Name,
		"server":          node.Server,
		"server_port":     node.Port,
		"uuid":            node.UUID,
		"flow":            node.Flow,
		"network":         "tcp",
		"packet_encoding": "xudp",
		"tls": map[string]any{
			"enabled":     true,
			"server_name": node.SNI,
			"utls": map[string]any{
				"enabled":     true,
				"fingerprint": node.Fingerprint,
			},
			"reality": map[string]any{
				"enabled":    true,
				"public_key": node.RealityPBK,
				"short_id":   node.RealitySID,
			},
		},
	}
}

func singBoxHysteria2Outbound(node hysteria2Node) map[string]any {
	outbound := map[string]any{
		"type":        "hysteria2",
		"tag":         node.Name,
		"server":      node.Server,
		"server_port": node.Port,
		"password":    node.Password,
		"tls": map[string]any{
			"enabled":     true,
			"server_name": node.SNI,
			"insecure":    node.Insecure,
			"alpn":        []string{"h3"},
		},
	}
	if node.Obfs != "" {
		outbound["obfs"] = map[string]any{
			"type":     node.Obfs,
			"password": node.ObfsPassword,
		}
	}
	return outbound
}

func yamlString(value string) string {
	b, _ := json.Marshal(value)
	return string(b)
}

func hostOnly(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return value
	}
	if parsed, err := url.Parse(value); err == nil && parsed.Host != "" {
		return parsed.Hostname()
	}
	host, _, err := net.SplitHostPort(value)
	if err == nil {
		return host
	}
	return strings.Trim(value, "[]")
}

func firstInSlice(values []string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
