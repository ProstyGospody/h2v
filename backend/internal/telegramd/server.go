package telegramd

import (
	"bufio"
	"context"
	"io"
	"log/slog"
	"math"
	"net"
	"sync/atomic"
	"time"
)

type Server struct {
	cfg    Config
	secret []byte
	logger *slog.Logger
	stats  Stats
}

type Stats struct {
	Accepted uint64
	Rejected uint64
	Active   int64
	Uplink   uint64
	Downlink uint64
}

func New(cfg Config, logger *slog.Logger) (*Server, error) {
	var secret []byte
	if cfg.Secret != "" {
		var err error
		secret, err = cfg.SecretBytes()
		if err != nil {
			return nil, err
		}
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &Server{cfg: cfg, secret: secret, logger: logger}, nil
}

func (s *Server) Serve(ctx context.Context) error {
	if !s.cfg.Enabled {
		s.logger.Info("telegram proxy disabled")
		<-ctx.Done()
		return nil
	}
	listener, err := net.Listen("tcp", s.cfg.Listen)
	if err != nil {
		return err
	}
	defer listener.Close()
	go func() {
		<-ctx.Done()
		_ = listener.Close()
	}()
	s.logger.Info("telegram proxy listening", "addr", s.cfg.Listen)
	for {
		conn, err := listener.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			if ne, ok := err.(net.Error); ok && ne.Temporary() {
				s.logger.Warn("temporary accept error", "err", err)
				continue
			}
			return err
		}
		go s.handle(conn)
	}
}

func (s *Server) handle(conn net.Conn) {
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(20 * time.Second))
	buffered := newBufferedConn(conn)
	first, err := buffered.Peek(1)
	if err != nil {
		atomic.AddUint64(&s.stats.Rejected, 1)
		return
	}

	var client io.ReadWriter
	var meta obfuscatedMetadata
	if first[0] == tlsRecordHandshake {
		result, err := acceptFakeTLS(buffered, s.secret)
		if err != nil {
			if len(result.captured) > 0 {
				s.fallback(buffered, result.captured)
			}
			atomic.AddUint64(&s.stats.Rejected, 1)
			return
		}
		client, meta, err = acceptObfuscated2(result.conn, s.secret)
		if err != nil {
			atomic.AddUint64(&s.stats.Rejected, 1)
			return
		}
	} else {
		var err error
		client, meta, err = acceptObfuscated2(buffered, s.secret)
		if err != nil {
			atomic.AddUint64(&s.stats.Rejected, 1)
			return
		}
	}

	upstreamAddr := telegramDCAddr(meta.DC)
	upstream, err := net.DialTimeout("tcp", upstreamAddr, 10*time.Second)
	if err != nil {
		atomic.AddUint64(&s.stats.Rejected, 1)
		s.logger.Warn("telegram dc dial failed", "dc", meta.DC, "addr", upstreamAddr, "err", err)
		return
	}
	defer upstream.Close()
	upstreamRW, err := newTelegramObfuscatedConn(upstream, meta.Protocol)
	if err != nil {
		atomic.AddUint64(&s.stats.Rejected, 1)
		return
	}

	_ = conn.SetDeadline(time.Time{})
	_ = upstream.SetDeadline(time.Time{})
	atomic.AddUint64(&s.stats.Accepted, 1)
	atomic.AddInt64(&s.stats.Active, 1)
	defer atomic.AddInt64(&s.stats.Active, -1)

	done := make(chan struct{}, 2)
	go s.copyAndClose(done, upstreamRW, client, &s.stats.Uplink, upstream)
	go s.copyAndClose(done, client, upstreamRW, &s.stats.Downlink, conn)
	<-done
}

func (s *Server) fallback(conn net.Conn, firstPacket []byte) {
	if s.cfg.FallbackAddr == "" {
		return
	}
	upstream, err := net.DialTimeout("tcp", s.cfg.FallbackAddr, 10*time.Second)
	if err != nil {
		return
	}
	defer upstream.Close()
	if len(firstPacket) > 0 {
		if _, err := upstream.Write(firstPacket); err != nil {
			return
		}
	}
	_ = conn.SetDeadline(time.Time{})
	_ = upstream.SetDeadline(time.Time{})
	done := make(chan struct{}, 2)
	go s.copyPlain(done, upstream, conn)
	go s.copyPlain(done, conn, upstream)
	<-done
}

func (s *Server) copyAndClose(done chan<- struct{}, dst io.Writer, src io.Reader, counter *uint64, closer net.Conn) {
	n, _ := io.Copy(dst, src)
	if n > 0 {
		atomic.AddUint64(counter, uint64(n))
	}
	_ = closer.Close()
	done <- struct{}{}
}

func (s *Server) copyPlain(done chan<- struct{}, dst net.Conn, src net.Conn) {
	_, _ = io.Copy(dst, src)
	_ = dst.Close()
	done <- struct{}{}
}

func telegramDCAddr(raw uint16) string {
	dc := int(int16(raw))
	if dc < 0 {
		dc = int(math.Abs(float64(dc)))
	}
	if dc > 10000 {
		dc -= 10000
	}
	if dc < 1 || dc > 5 {
		dc = 2
	}
	switch dc {
	case 1:
		return "149.154.175.50:443"
	case 2:
		return "149.154.167.51:443"
	case 3:
		return "149.154.175.100:443"
	case 4:
		return "149.154.167.91:443"
	case 5:
		return "91.108.56.130:443"
	default:
		return "149.154.167.51:443"
	}
}

type bufferedConn struct {
	net.Conn
	reader *bufio.Reader
}

func newBufferedConn(conn net.Conn) *bufferedConn {
	return &bufferedConn{Conn: conn, reader: bufio.NewReader(conn)}
}

func (c *bufferedConn) Read(p []byte) (int, error) {
	return c.reader.Read(p)
}

func (c *bufferedConn) Peek(n int) ([]byte, error) {
	return c.reader.Peek(n)
}
