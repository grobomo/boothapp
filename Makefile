.DEFAULT_GOAL := help

SHELL := /bin/bash

# Docker
IMAGE_NAME   := boothapp
IMAGE_TAG    := latest

# AWS / SAM
AWS_PROFILE  ?= hackathon
AWS_REGION   ?= us-east-1
S3_BUCKET    ?= boothapp-sessions-752266476357
SAM_STACK    ?= boothapp-presign

# PID files for background services
PID_DIR      := .pids
WATCHER_PID  := $(PID_DIR)/watcher.pid
PRESENTER_PID:= $(PID_DIR)/presenter.pid

.PHONY: help install start stop test test-e2e demo analyze clean \
        docker-build docker-run deploy preflight

##@ General

help: ## Show this help
	@printf '\nUsage: make <target> [VAR=value]\n\n'
	@awk 'BEGIN {FS = ":.*##"} \
		/^[a-zA-Z0-9_-]+:.*##/ { printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2 } \
		/^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) }' $(MAKEFILE_LIST)
	@printf '\n'

##@ Setup

install: ## Install dependencies in all packages
	npm install
	cd presenter && npm install

##@ Services

start: | $(PID_DIR) ## Start watcher and presenter in background
	@if [ -f $(WATCHER_PID) ] && kill -0 $$(cat $(WATCHER_PID)) 2>/dev/null; then \
		echo "Watcher already running (pid $$(cat $(WATCHER_PID)))"; \
	else \
		nohup node analysis/watcher.js > logs/watcher.log 2>&1 & echo $$! > $(WATCHER_PID); \
		echo "Watcher started (pid $$(cat $(WATCHER_PID)))"; \
	fi
	@if [ -f $(PRESENTER_PID) ] && kill -0 $$(cat $(PRESENTER_PID)) 2>/dev/null; then \
		echo "Presenter already running (pid $$(cat $(PRESENTER_PID)))"; \
	else \
		nohup node presenter/server.js > logs/presenter.log 2>&1 & echo $$! > $(PRESENTER_PID); \
		echo "Presenter started (pid $$(cat $(PRESENTER_PID)))"; \
	fi

stop: ## Stop watcher and presenter
	@for svc in watcher presenter; do \
		pidfile=$(PID_DIR)/$$svc.pid; \
		if [ -f $$pidfile ]; then \
			pid=$$(cat $$pidfile); \
			if kill -0 $$pid 2>/dev/null; then \
				kill $$pid && echo "Stopped $$svc (pid $$pid)"; \
			else \
				echo "$$svc not running (stale pid $$pid)"; \
			fi; \
			rm -f $$pidfile; \
		else \
			echo "$$svc not running (no pidfile)"; \
		fi; \
	done

$(PID_DIR):
	@mkdir -p $(PID_DIR) logs

##@ Testing

test: ## Run all unit/integration tests
	npm test

test-e2e: ## Run end-to-end pipeline test
	bash scripts/test/test-demo-pipeline.sh

preflight: ## Run preflight checks for demo day
	bash scripts/preflight.sh

##@ Demo & Analysis

demo: ## Generate and upload a sample session
	@echo "Generating sample session data..."
	@session_id="demo-$$(date +%Y%m%d-%H%M%S)"; \
	tmpdir=$$(mktemp -d); \
	echo '{"session_id":"'$$session_id'","timestamp":"'$$(date -u +%Y-%m-%dT%H:%M:%SZ)'","type":"demo"}' > $$tmpdir/metadata.json; \
	echo '[]' > $$tmpdir/events.json; \
	aws s3 cp $$tmpdir/metadata.json s3://$(S3_BUCKET)/sessions/$$session_id/metadata.json --profile $(AWS_PROFILE) --region $(AWS_REGION); \
	aws s3 cp $$tmpdir/events.json   s3://$(S3_BUCKET)/sessions/$$session_id/events.json   --profile $(AWS_PROFILE) --region $(AWS_REGION); \
	rm -rf $$tmpdir; \
	echo "Uploaded demo session: $$session_id"

analyze: ## Manually trigger analysis (SESSION=<id> required)
ifndef SESSION
	$(error SESSION is required. Usage: make analyze SESSION=<session-id>)
endif
	node analysis/pipeline-run.js $(SESSION)

##@ Build & Deploy

docker-build: ## Build Docker image
	docker build -t $(IMAGE_NAME):$(IMAGE_TAG) .

docker-run: ## Run Docker container
	docker run --rm -it \
		-p 3000:3000 \
		-p 8080:8080 \
		-e AWS_PROFILE=$(AWS_PROFILE) \
		-e S3_BUCKET=$(S3_BUCKET) \
		$(IMAGE_NAME):$(IMAGE_TAG)

deploy: ## Deploy Lambda via SAM to production
	cd infra/presign-lambda && \
	sam build && \
	sam deploy \
		--stack-name $(SAM_STACK) \
		--resolve-s3 \
		--capabilities CAPABILITY_IAM \
		--region $(AWS_REGION) \
		--profile $(AWS_PROFILE) \
		--no-confirm-changeset

##@ Cleanup

clean: ## Remove build artifacts, logs, and node_modules
	rm -rf node_modules presenter/node_modules
	rm -rf output/*.html output/*.txt
	rm -rf logs/*.log
	rm -rf $(PID_DIR)
	rm -rf .aws-sam
	@echo "Cleaned."
