package services

import "testing"

func TestBuildTelegramProxyLinkUsesFakeTLSSecret(t *testing.T) {
	link := buildTelegramProxyLink(RuntimeSettings{
		TelegramHost:       "tg.example.com",
		TelegramPort:       9443,
		TelegramSecret:     "00112233445566778899aabbccddeeff",
		TelegramMaskDomain: "www.cloudflare.com",
	})

	want := "https://t.me/proxy?port=9443&secret=ee00112233445566778899aabbccddeeff7777772e636c6f7564666c6172652e636f6d&server=tg.example.com"
	if link != want {
		t.Fatalf("link = %q, want %q", link, want)
	}
}
