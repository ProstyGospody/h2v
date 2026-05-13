package services

import (
	"strings"
	"testing"
)

func TestBuildTelegramProxyLinkUsesFakeTLSSecret(t *testing.T) {
	link := buildTelegramProxyLink(RuntimeSettings{
		TelegramEnabled:    true,
		TelegramHost:       "tg.example.com",
		TelegramPort:       9443,
		TelegramSecret:     "00112233445566778899aabbccddeeff",
		TelegramMaskDomain: "www.cloudflare.com",
	})

	want := "tg://proxy?port=9443&secret=ee00112233445566778899aabbccddeeff7777772e636c6f7564666c6172652e636f6d&server=tg.example.com"
	if link != want {
		t.Fatalf("link = %q, want %q", link, want)
	}
}

func TestBuildTelegramProxyLinkPrefersPublicServerIP(t *testing.T) {
	link := buildTelegramProxyLink(RuntimeSettings{
		PublicServerIP:     "213.155.12.13",
		TelegramEnabled:    true,
		TelegramHost:       "tg.example.com",
		TelegramPort:       9443,
		TelegramSecret:     "00112233445566778899aabbccddeeff",
		TelegramMaskDomain: "www.cloudflare.com",
	})

	want := "tg://proxy?port=9443&secret=ee00112233445566778899aabbccddeeff7777772e636c6f7564666c6172652e636f6d&server=213.155.12.13"
	if link != want {
		t.Fatalf("link = %q, want %q", link, want)
	}
}

func TestRenderTelemtConfigUsesConfiguredSecretAndMask(t *testing.T) {
	config := renderTelemtConfig(RuntimeSettings{
		TelegramHost:       "tg.example.com",
		TelegramPort:       9443,
		TelegramSecret:     "00112233445566778899aabbccddeeff",
		TelegramMaskDomain: "www.cloudflare.com",
		TelegramFallback:   "example.com:443",
	}, "/opt/mypanel")

	for _, want := range []string{
		"public_host = \"tg.example.com\"",
		"port = 9443",
		"tls_domain = \"www.cloudflare.com\"",
		"mask_host = \"example.com\"",
		"h2v = \"00112233445566778899aabbccddeeff\"",
	} {
		if !strings.Contains(config, want) {
			t.Fatalf("config does not contain %q:\n%s", want, config)
		}
	}
}

func TestRenderTelemtConfigPrefersPublicServerIPForLinks(t *testing.T) {
	config := renderTelemtConfig(RuntimeSettings{
		PublicServerIP:     "213.155.12.13",
		TelegramHost:       "tg.example.com",
		TelegramPort:       9443,
		TelegramSecret:     "00112233445566778899aabbccddeeff",
		TelegramMaskDomain: "www.cloudflare.com",
		TelegramFallback:   "example.com:443",
	}, "/opt/mypanel")

	if !strings.Contains(config, "public_host = \"213.155.12.13\"") {
		t.Fatalf("config does not contain public IP host:\n%s", config)
	}
}
