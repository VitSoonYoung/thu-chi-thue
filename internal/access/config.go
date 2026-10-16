package access

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"thuchithue/internal/drive"
)

type Config struct {
	GoogleDrive    *drive.Config `json:"google_drive,omitempty"`
	Listen         string        `json:"listen"`
	AccessPassword string        `json:"access_password"`
	SessionHours   int           `json:"session_hours"`
	PasskeyRPID    string        `json:"passkey_rp_id"`
	PasskeyOrigins []string      `json:"passkey_origins"`
}

func token() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func LoadConfig(path string) (Config, error) {
	var c Config
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		c = Config{Listen: "0.0.0.0:3210", AccessPassword: token(), SessionHours: 720, PasskeyRPID: "localhost", PasskeyOrigins: []string{"http://localhost:3210"}}
		if err = writeJSON(path, c); err != nil {
			return c, err
		}
	} else if err != nil {
		return c, err
	} else {
		if err = json.Unmarshal(b, &c); err != nil {
			return c, fmt.Errorf("invalid access config: %w", err)
		}
	}
	if strings.TrimSpace(c.AccessPassword) == "" {
		return c, errors.New("access_password must not be empty")
	}
	if c.Listen == "" {
		c.Listen = "0.0.0.0:3210"
	}
	if _, _, err = net.SplitHostPort(c.Listen); err != nil {
		return c, fmt.Errorf("invalid listen address: %w", err)
	}
	if c.SessionHours == 0 {
		c.SessionHours = 720
	}
	if c.SessionHours < 1 || c.SessionHours > 8760 {
		return c, errors.New("session_hours must be between 1 and 8760")
	}
	if len(c.PasskeyOrigins) > 0 && net.ParseIP(c.PasskeyRPID) != nil {
		return c, errors.New("passkey_rp_id must be a domain name or localhost")
	}
	for _, origin := range c.PasskeyOrigins {
		u, err := url.Parse(origin)
		if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" || (u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" || u.Hostname() == "::1"))) {
			return c, errors.New("passkey_origins must contain HTTPS origins or local HTTP origins")
		}
		if c.PasskeyRPID == "" || (u.Hostname() != c.PasskeyRPID && !strings.HasSuffix(u.Hostname(), "."+c.PasskeyRPID)) {
			return c, errors.New("passkey origin must belong to passkey_rp_id")
		}
	}
	return c, nil
}

func writeJSON(path string, value any) error {
	b, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".access.*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(append(b, '\n')); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), path)
}
