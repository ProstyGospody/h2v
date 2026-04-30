package services

import (
	"net"
	"os"
	"strconv"
	"strings"
)

type PortProbeResult struct {
	Available bool   `json:"available"`
	Port      int    `json:"port"`
	Protocol  string `json:"protocol"`
	Reason    string `json:"reason,omitempty"`
}

func ProbePort(protocol string, port int) PortProbeResult {
	result := PortProbeResult{
		Available: false,
		Port:      port,
		Protocol:  protocol,
	}
	if !validRuntimePort(port) {
		result.Reason = "invalid port"
		return result
	}
	if inUse, checked := procPortInUse(protocol, port); checked {
		if inUse {
			result.Reason = "port already in use"
			return result
		}
		if port < 1024 {
			result.Available = true
			return result
		}
	}

	address := ":" + strconv.Itoa(port)
	switch protocol {
	case "tcp":
		listener, err := net.Listen("tcp", address)
		if err != nil {
			result.Reason = err.Error()
			return result
		}
		_ = listener.Close()
	case "udp":
		conn, err := net.ListenPacket("udp", address)
		if err != nil {
			result.Reason = err.Error()
			return result
		}
		_ = conn.Close()
	default:
		result.Reason = "unsupported protocol"
		return result
	}

	result.Available = true
	return result
}

func procPortInUse(protocol string, port int) (bool, bool) {
	var paths []string
	switch protocol {
	case "tcp":
		paths = []string{"/proc/net/tcp", "/proc/net/tcp6"}
	case "udp":
		paths = []string{"/proc/net/udp", "/proc/net/udp6"}
	default:
		return false, false
	}

	checked := false
	for _, path := range paths {
		content, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		checked = true
		for _, line := range strings.Split(string(content), "\n") {
			fields := strings.Fields(line)
			if len(fields) < 4 || fields[0] == "sl" {
				continue
			}
			if protocol == "tcp" && fields[3] != "0A" {
				continue
			}
			parts := strings.Split(fields[1], ":")
			if len(parts) < 2 {
				continue
			}
			value, err := strconv.ParseInt(parts[len(parts)-1], 16, 32)
			if err == nil && int(value) == port {
				return true, true
			}
		}
	}
	return false, checked
}
