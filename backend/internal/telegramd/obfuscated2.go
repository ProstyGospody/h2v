package telegramd

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"io"
)

type obfuscatedMetadata struct {
	Protocol [4]byte
	DC       uint16
}

type obfuscatedConn struct {
	conn    io.ReadWriter
	encrypt cipher.Stream
	decrypt cipher.Stream
}

func acceptObfuscated2(conn io.ReadWriter, secret []byte) (*obfuscatedConn, obfuscatedMetadata, error) {
	var meta obfuscatedMetadata
	buf := make([]byte, 64)
	if _, err := io.ReadFull(conn, buf); err != nil {
		return nil, meta, err
	}
	keys, err := createObfuscatedStreams(buf, secret)
	if err != nil {
		return nil, meta, err
	}
	keys.encrypt, keys.decrypt = keys.decrypt, keys.encrypt

	var decrypted [64]byte
	keys.decrypt.XORKeyStream(decrypted[:], buf)
	copy(meta.Protocol[:], decrypted[56:60])
	meta.DC = binary.LittleEndian.Uint16(decrypted[60:62])

	return &obfuscatedConn{conn: conn, encrypt: keys.encrypt, decrypt: keys.decrypt}, meta, nil
}

func newTelegramObfuscatedConn(conn io.ReadWriter, protocol [4]byte) (*obfuscatedConn, error) {
	init, err := generateObfuscatedInit()
	if err != nil {
		return nil, err
	}
	keys, err := createObfuscatedStreams(init[:], nil)
	if err != nil {
		return nil, err
	}
	copy(init[56:60], protocol[:])
	binary.LittleEndian.PutUint16(init[60:62], 0)

	var encrypted [64]byte
	keys.encrypt.XORKeyStream(encrypted[:], init[:])
	header := make([]byte, 64)
	copy(header, init[:56])
	copy(header[56:], encrypted[56:64])
	if _, err := conn.Write(header); err != nil {
		return nil, err
	}
	return &obfuscatedConn{conn: conn, encrypt: keys.encrypt, decrypt: keys.decrypt}, nil
}

func (c *obfuscatedConn) Read(p []byte) (int, error) {
	n, err := c.conn.Read(p)
	if n > 0 {
		c.decrypt.XORKeyStream(p[:n], p[:n])
	}
	return n, err
}

func (c *obfuscatedConn) Write(p []byte) (int, error) {
	out := append([]byte(nil), p...)
	c.encrypt.XORKeyStream(out, p)
	return c.conn.Write(out)
}

type obfuscatedStreams struct {
	encrypt cipher.Stream
	decrypt cipher.Stream
}

func createObfuscatedStreams(init, secret []byte) (obfuscatedStreams, error) {
	if len(init) < 56 {
		return obfuscatedStreams{}, errors.New("obfuscated init is too short")
	}
	encryptKey := append([]byte(nil), init[8:40]...)
	encryptIV := append([]byte(nil), init[40:56]...)
	decryptInit := reverseCopy(init[8:56])
	decryptKey := append([]byte(nil), decryptInit[:32]...)
	decryptIV := append([]byte(nil), decryptInit[32:48]...)
	if len(secret) > 0 {
		if len(secret) < 16 {
			return obfuscatedStreams{}, errors.New("secret is too short")
		}
		encryptKey = sha256Concat(encryptKey, secret[:16])
		decryptKey = sha256Concat(decryptKey, secret[:16])
	}
	encrypt, err := aesCTR(encryptKey, encryptIV)
	if err != nil {
		return obfuscatedStreams{}, err
	}
	decrypt, err := aesCTR(decryptKey, decryptIV)
	if err != nil {
		return obfuscatedStreams{}, err
	}
	return obfuscatedStreams{encrypt: encrypt, decrypt: decrypt}, nil
}

func aesCTR(key, iv []byte) (cipher.Stream, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewCTR(block, iv), nil
}

func sha256Concat(parts ...[]byte) []byte {
	hash := sha256.New()
	for _, part := range parts {
		_, _ = hash.Write(part)
	}
	return hash.Sum(nil)
}

func reverseCopy(value []byte) [48]byte {
	var out [48]byte
	copy(out[:], value)
	for left, right := 0, len(out)-1; left < right; left, right = left+1, right-1 {
		out[left], out[right] = out[right], out[left]
	}
	return out
}

func generateObfuscatedInit() ([64]byte, error) {
	var init [64]byte
	for {
		if _, err := io.ReadFull(rand.Reader, init[:]); err != nil {
			return [64]byte{}, err
		}
		if init[0] == 0xef {
			continue
		}
		first := binary.LittleEndian.Uint32(init[0:4])
		if first == 0x44414548 ||
			first == 0x54534f50 ||
			first == 0x20544547 ||
			first == 0x4954504f ||
			first == 0x02010316 ||
			first == 0xdddddddd ||
			first == 0xeeeeeeee {
			continue
		}
		if binary.LittleEndian.Uint32(init[4:8]) == 0 {
			continue
		}
		return init, nil
	}
}
