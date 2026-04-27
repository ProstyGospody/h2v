package util

import (
	"bufio"
	"errors"
	"os"
	"runtime"
	"strconv"
	"strings"
	"time"
)

type CPUSample struct {
	Idle  uint64
	Total uint64
}

type NetworkSample struct {
	RxBytes uint64
	TxBytes uint64
	At      time.Time
}

func ReadCPUSample() (CPUSample, error) {
	file, err := os.Open("/proc/stat")
	if err != nil {
		return CPUSample{}, err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	if !scanner.Scan() {
		if err := scanner.Err(); err != nil {
			return CPUSample{}, err
		}
		return CPUSample{}, errors.New("empty /proc/stat")
	}

	fields := strings.Fields(scanner.Text())
	if len(fields) < 5 || fields[0] != "cpu" {
		return CPUSample{}, errors.New("invalid cpu line in /proc/stat")
	}

	values := make([]uint64, 0, len(fields)-1)
	for _, raw := range fields[1:] {
		v, parseErr := strconv.ParseUint(raw, 10, 64)
		if parseErr != nil {
			return CPUSample{}, parseErr
		}
		values = append(values, v)
	}

	var total uint64
	for _, v := range values {
		total += v
	}

	idle := values[3]
	if len(values) > 4 {
		idle += values[4]
	}

	return CPUSample{Idle: idle, Total: total}, nil
}

func ReadNetworkSample() (NetworkSample, error) {
	file, err := os.Open("/proc/net/dev")
	if err != nil {
		return NetworkSample{}, err
	}
	defer file.Close()

	var rxBytes uint64
	var txBytes uint64

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}
		iface := strings.TrimSpace(parts[0])
		if iface == "" || iface == "lo" {
			continue
		}
		fields := strings.Fields(parts[1])
		if len(fields) < 16 {
			continue
		}
		rx, rxErr := strconv.ParseUint(fields[0], 10, 64)
		tx, txErr := strconv.ParseUint(fields[8], 10, 64)
		if rxErr != nil || txErr != nil {
			continue
		}
		rxBytes += rx
		txBytes += tx
	}
	if err := scanner.Err(); err != nil {
		return NetworkSample{}, err
	}
	return NetworkSample{RxBytes: rxBytes, TxBytes: txBytes, At: time.Now()}, nil
}

func CPUUsagePercent(prev, curr CPUSample) float64 {
	if curr.Total <= prev.Total {
		return 0
	}
	totalDelta := curr.Total - prev.Total
	idleDelta := curr.Idle - prev.Idle
	if totalDelta == 0 {
		return 0
	}
	usage := (float64(totalDelta-idleDelta) / float64(totalDelta)) * 100
	if usage < 0 {
		return 0
	}
	if usage > 100 {
		return 100
	}
	return usage
}

func NetworkBytesPerSecond(prev, curr NetworkSample) (int64, int64) {
	seconds := curr.At.Sub(prev.At).Seconds()
	if seconds <= 0 {
		return 0, 0
	}

	rxDelta := uint64(0)
	if curr.RxBytes >= prev.RxBytes {
		rxDelta = curr.RxBytes - prev.RxBytes
	}
	txDelta := uint64(0)
	if curr.TxBytes >= prev.TxBytes {
		txDelta = curr.TxBytes - prev.TxBytes
	}

	return int64(float64(rxDelta) / seconds), int64(float64(txDelta) / seconds)
}

func MemoryUsagePercent() (float64, error) {
	file, err := os.Open("/proc/meminfo")
	if err == nil {
		defer file.Close()
		scanner := bufio.NewScanner(file)
		values := map[string]uint64{}
		for scanner.Scan() {
			parts := strings.Fields(scanner.Text())
			if len(parts) < 2 {
				continue
			}
			key := strings.TrimSuffix(parts[0], ":")
			v, parseErr := strconv.ParseUint(parts[1], 10, 64)
			if parseErr != nil {
				continue
			}
			values[key] = v
		}
		if scanErr := scanner.Err(); scanErr != nil {
			return 0, scanErr
		}
		total := values["MemTotal"]
		available := values["MemAvailable"]
		if total > 0 {
			used := total - available
			usage := (float64(used) / float64(total)) * 100
			if usage < 0 {
				return 0, nil
			}
			if usage > 100 {
				return 100, nil
			}
			return usage, nil
		}
	}

	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)
	if mem.Sys == 0 {
		return 0, nil
	}
	usage := (float64(mem.Alloc) / float64(mem.Sys)) * 100
	if usage < 0 {
		return 0, nil
	}
	if usage > 100 {
		return 100, nil
	}
	return usage, nil
}
