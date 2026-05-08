package util

import (
	"bufio"
	"errors"
	"os"
	"runtime"
	"strconv"
	"strings"
)

type CPUSample struct {
	Idle  uint64
	Total uint64
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
