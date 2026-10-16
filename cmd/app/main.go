package main

import (
	"context"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	assets "thuchithue"
	"thuchithue/internal/access"
	"thuchithue/internal/drive"
	"thuchithue/internal/server"
	"thuchithue/internal/store"
	"time"
	_ "time/tzdata"
)

func main() {
	if e := run(); e != nil {
		log.Print(e)
		os.Exit(1)
	}
}
func run() error {
	listen := flag.String("listen", "", "Listen address override")
	configPath := flag.String("config", "config.local.json", "Access configuration file")
	headless := flag.Bool("headless", true, "Do not open a browser")
	quiet := flag.Bool("quiet", true, "Suppress startup messages")
	port := flag.Int("port", 3210, "Port (1 to 65535)")
	config, e := os.UserConfigDir()
	if e != nil {
		return e
	}
	dir := flag.String("data-dir", filepath.Join(config, "ThuChiThue"), "Data directory")
	flag.Parse()
	portSet, listenSet := false, false
	flag.Visit(func(f *flag.Flag) {
		portSet = portSet || f.Name == "port"
		listenSet = listenSet || f.Name == "listen"
	})
	if portSet && listenSet {
		return fmt.Errorf("choose either --port or --listen")
	}
	if *port < 1 || *port > 65535 {
		return fmt.Errorf("port must be between 1 and 65535")
	}
	cfg, e := access.LoadConfig(*configPath)
	if e != nil {
		return fmt.Errorf("access config: %w", e)
	}
	if !listenSet {
		*listen = cfg.Listen
	}
	if portSet {
		host, _, err := net.SplitHostPort(*listen)
		if err != nil {
			return err
		}
		*listen = net.JoinHostPort(host, fmt.Sprint(*port))
	}
	_, _, e = net.SplitHostPort(*listen)
	if e != nil {
		return fmt.Errorf("invalid listen address: %w", e)
	}
	s, e := store.Open(*dir)
	if e != nil {
		return fmt.Errorf("database: %w", e)
	}
	defer s.DB.Close()
	listener, e := net.Listen("tcp", *listen)
	if e != nil {
		return fmt.Errorf("cannot listen on %s; choose another port with --port or --listen: %w", *listen, e)
	}
	defer listener.Close()
	files, e := fs.Sub(assets.Assets, "web/dist")
	if e != nil {
		return e
	}
	app := server.New(s, http.FileServer(http.FS(files)))
	guard, e := access.New(cfg, filepath.Join(*dir, "passkeys.json"))
	if e != nil {
		return fmt.Errorf("access: %w", e)
	}
	cloud, e := drive.New(*dir, s, cfg.GoogleDrive)
	if e != nil {
		return fmt.Errorf("Google Drive: %w", e)
	}
	cloud.PublicOrigins = cfg.PasskeyOrigins
	router := http.NewServeMux()
	router.HandleFunc("GET /api/drive/callback", cloud.Callback)
	router.Handle("/api/drive/", guard.Wrap(cloud.Handler()))
	router.Handle("/", guard.Wrap(app.Handler))
	httpServer := &http.Server{Handler: router, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 60 * time.Second, WriteTimeout: 120 * time.Second, IdleTimeout: 60 * time.Second}
	url := "http://" + listener.Addr().String()
	if !*quiet {
		log.Printf("Listening at %s", url)
	}
	done := make(chan error, 1)
	go func() { done <- httpServer.Serve(listener) }()
	if !*headless && desktopSession() {
		if e = openBrowser(url); e != nil {
			log.Printf("Browser unavailable; open %s", url)
		}
	}
	interrupt := make(chan os.Signal, 1)
	signal.Notify(interrupt, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(interrupt)
	select {
	case e = <-done:
		if e != http.ErrServerClosed {
			return e
		}
	case <-interrupt:
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return httpServer.Shutdown(ctx)
	}
	return nil
}
func desktopSession() bool {
	if os.Getenv("CI") != "" || os.Getenv("SSH_CONNECTION") != "" {
		return false
	}
	if runtime.GOOS == "linux" {
		return os.Getenv("DISPLAY") != "" || os.Getenv("WAYLAND_DISPLAY") != ""
	}
	return true
}
func openBrowser(url string) error {
	var c *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		c = exec.Command("open", url)
	case "windows":
		c = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		c = exec.Command("xdg-open", url)
	}
	return c.Run()
}
