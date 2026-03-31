# Deploy Presenter Script

## Goal
Create `scripts/deploy-presenter.sh` that deploys the presenter dashboard as a production service on a Linux EC2 instance with Node.js static server, PM2 process management, systemd auto-restart, and optional nginx reverse proxy.

## Success Criteria
1. Script installs Node.js dependencies (npm install in presenter/)
2. Configures .env with S3_BUCKET, AWS_REGION, PORT=3000
3. Starts presenter server with PM2 process manager
4. Sets up systemd service for auto-restart on reboot
5. Configures nginx reverse proxy (port 80 -> 3000) if nginx is installed
6. Supports CLI flags: --port and --domain
7. All API endpoints respond correctly after deployment
