package telegramd

import (
	"bytes"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"sync"
	"time"
)

const (
	tlsRecordChangeCipherSpec byte = 0x14
	tlsRecordHandshake        byte = 0x16
	tlsRecordApplication      byte = 0x17
	maxTLSRecordDataLength         = 16384 + 24
)

var tlsVersion12 = [2]byte{0x03, 0x03}

type fakeTLSConn struct {
	net.Conn
	readBuf     bytes.Buffer
	readBufLock sync.Mutex
	firstWrite  bool
}

type fakeTLSAcceptResult struct {
	conn     *fakeTLSConn
	captured []byte
}

func acceptFakeTLS(conn net.Conn, secret []byte) (*fakeTLSAcceptResult, error) {
	record, captured, err := readTLSRecord(conn)
	if err != nil {
		return &fakeTLSAcceptResult{captured: captured}, err
	}
	if record.recordType != tlsRecordHandshake {
		return &fakeTLSAcceptResult{captured: captured}, errors.New("first record is not a TLS handshake")
	}
	clientRandom, err := validateClientHello(secret, captured, record.data)
	if err != nil {
		return &fakeTLSAcceptResult{captured: captured}, err
	}
	serverHello, err := buildServerHello(secret, clientRandom)
	if err != nil {
		return &fakeTLSAcceptResult{captured: captured}, err
	}
	if _, err := conn.Write(serverHello); err != nil {
		return &fakeTLSAcceptResult{captured: captured}, err
	}
	return &fakeTLSAcceptResult{conn: &fakeTLSConn{Conn: conn}}, nil
}

func (c *fakeTLSConn) Read(p []byte) (int, error) {
	c.readBufLock.Lock()
	defer c.readBufLock.Unlock()

	for c.readBuf.Len() == 0 {
		record, _, err := readTLSRecord(c.Conn)
		if err != nil {
			return 0, err
		}
		switch record.recordType {
		case tlsRecordChangeCipherSpec:
			continue
		case tlsRecordApplication:
			_, _ = c.readBuf.Write(record.data)
		default:
			return 0, errors.New("unexpected TLS record type")
		}
	}
	return c.readBuf.Read(p)
}

func (c *fakeTLSConn) Write(p []byte) (int, error) {
	if !c.firstWrite {
		if err := writeTLSRecord(c.Conn, tlsRecordChangeCipherSpec, []byte{0x01}); err != nil {
			return 0, err
		}
		c.firstWrite = true
	}
	if err := writeTLSRecord(c.Conn, tlsRecordApplication, p); err != nil {
		return 0, err
	}
	return len(p), nil
}

type tlsRecord struct {
	recordType byte
	version    [2]byte
	data       []byte
}

func readTLSRecord(r io.Reader) (tlsRecord, []byte, error) {
	header := make([]byte, 5)
	if _, err := io.ReadFull(r, header); err != nil {
		return tlsRecord{}, header[:0], err
	}
	length := binary.BigEndian.Uint16(header[3:5])
	if length > maxTLSRecordDataLength {
		return tlsRecord{}, header, errors.New("TLS record is too large")
	}
	data := make([]byte, int(length))
	if _, err := io.ReadFull(r, data); err != nil {
		return tlsRecord{}, append(header, data...), err
	}
	return tlsRecord{
		recordType: header[0],
		version:    [2]byte{header[1], header[2]},
		data:       data,
	}, append(header, data...), nil
}

func writeTLSRecord(w io.Writer, recordType byte, payload []byte) error {
	for len(payload) > 0 || payload == nil {
		chunk := payload
		if len(chunk) > 16384 {
			chunk = payload[:16384]
		}
		header := []byte{recordType, tlsVersion12[0], tlsVersion12[1], 0, 0}
		binary.BigEndian.PutUint16(header[3:5], uint16(len(chunk)))
		if _, err := w.Write(header); err != nil {
			return err
		}
		if len(chunk) > 0 {
			if _, err := w.Write(chunk); err != nil {
				return err
			}
		}
		if len(payload) <= len(chunk) {
			return nil
		}
		payload = payload[len(chunk):]
	}
	return nil
}

func validateClientHello(secret, packet, payload []byte) ([32]byte, error) {
	var clientRandom [32]byte
	if len(packet) < 43 || len(payload) < 38 {
		return clientRandom, errors.New("ClientHello is too short")
	}
	copy(clientRandom[:], payload[6:38])

	normalized := append([]byte(nil), packet...)
	for i := 11; i < 43; i++ {
		normalized[i] = 0
	}
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write(normalized)
	expected := mac.Sum(nil)
	if !hmac.Equal(clientRandom[:28], expected[:28]) {
		return clientRandom, errors.New("ClientHello digest mismatch")
	}
	receivedTime := binary.LittleEndian.Uint32(clientRandom[28:32])
	expectedTime := binary.LittleEndian.Uint32(expected[28:32])
	timestamp := int64(receivedTime ^ expectedTime)
	if delta := time.Since(time.Unix(timestamp, 0)); delta > 24*time.Hour || delta < -24*time.Hour {
		return clientRandom, errors.New("ClientHello timestamp is out of range")
	}
	return clientRandom, nil
}

func buildServerHello(secret []byte, clientRandom [32]byte) ([]byte, error) {
	body := make([]byte, 0, 40)
	body = append(body, 0x03, 0x03)
	body = append(body, make([]byte, 32)...)
	body = append(body, 0x00)
	body = append(body, 0x13, 0x01)
	body = append(body, 0x00)
	body = append(body, 0x00, 0x00)

	handshake := []byte{0x02, 0x00, 0x00, byte(len(body))}
	handshake = append(handshake, body...)

	packet := appendTLSRecord(nil, tlsRecordHandshake, handshake)
	packet = appendTLSRecord(packet, tlsRecordChangeCipherSpec, []byte{0x01})
	ignored := make([]byte, 32)
	if _, err := rand.Read(ignored); err != nil {
		return nil, err
	}
	packet = appendTLSRecord(packet, tlsRecordApplication, ignored)

	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write(clientRandom[:])
	_, _ = mac.Write(packet)
	digest := mac.Sum(nil)
	copy(packet[11:43], digest)
	return packet, nil
}

func appendTLSRecord(dst []byte, recordType byte, payload []byte) []byte {
	dst = append(dst, recordType, tlsVersion12[0], tlsVersion12[1], 0, 0)
	binary.BigEndian.PutUint16(dst[len(dst)-2:], uint16(len(payload)))
	return append(dst, payload...)
}
