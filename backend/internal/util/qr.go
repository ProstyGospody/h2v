package util

import (
	"encoding/base64"

	qrcode "github.com/skip2/go-qrcode"
)

func QRDataURI(content string, size int) (string, error) {
	png, err := qrcode.Encode(content, qrcode.Medium, size)
	if err != nil {
		return "", err
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(png), nil
}

