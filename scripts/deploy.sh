#!/bin/bash

# Logtrail Deployment Script
# Usage: ./deploy.sh [central|agent] [environment] [config-file]

set -e

DEPLOY_TYPE=$1
ENVIRONMENT=${2:-production}
CONFIG_FILE=$3

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Print functions
print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Validate input
if [[ "$DEPLOY_TYPE" != "central" && "$DEPLOY_TYPE" != "agent" ]]; then
    print_error "Usage: $0 [central|agent] [environment] [config-file]"
    print_error "Deploy type must be 'central' or 'agent'"
    exit 1
fi

print_info "Starting $DEPLOY_TYPE deployment for $ENVIRONMENT environment"

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    print_error "PM2 is not installed. Please install PM2 first:"
    print_error "npm install -g pm2"
    exit 1
fi

# Check if we're in the right directory
if [[ ! -f "package.json" ]]; then
    print_error "package.json not found. Please run this script from the logtrail directory."
    exit 1
fi

# Install dependencies
print_info "Installing dependencies..."
npm install --production

# Create logs directory
mkdir -p logs

# Setup environment file
ENV_FILE=".env"
TEMPLATE_FILE=".env.${DEPLOY_TYPE}.template"

if [[ -n "$CONFIG_FILE" && -f "$CONFIG_FILE" ]]; then
    print_info "Using provided config file: $CONFIG_FILE"
    cp "$CONFIG_FILE" "$ENV_FILE"
elif [[ -f "$TEMPLATE_FILE" ]]; then
    if [[ ! -f "$ENV_FILE" ]]; then
        print_warn "No .env file found. Creating from template: $TEMPLATE_FILE"
        print_warn "Please edit .env file with your actual configuration before starting!"
        cp "$TEMPLATE_FILE" "$ENV_FILE"
    else
        print_info "Using existing .env file"
    fi
else
    print_error "No template file found: $TEMPLATE_FILE"
    exit 1
fi

# Setup config directory
if [[ ! -d "config" ]]; then
    print_error "Config directory not found. Please ensure config files are present."
    exit 1
fi

# Validate config file exists
CONFIG_YAML="config/${DEPLOY_TYPE}.config.yaml"
if [[ ! -f "$CONFIG_YAML" ]]; then
    print_error "Configuration file not found: $CONFIG_YAML"
    exit 1
fi

# Stop existing PM2 processes
print_info "Stopping existing PM2 processes..."
pm2 stop logtrail-${DEPLOY_TYPE} 2>/dev/null || true
pm2 delete logtrail-${DEPLOY_TYPE} 2>/dev/null || true

# Start the application
print_info "Starting logtrail-${DEPLOY_TYPE} with PM2..."

if [[ "$DEPLOY_TYPE" == "central" ]]; then
    pm2 start ecosystem.config.js --only logtrail-central --env $ENVIRONMENT
else
    pm2 start ecosystem.config.js --only logtrail-agent --env $ENVIRONMENT
fi

# Save PM2 configuration
print_info "Saving PM2 configuration..."
pm2 save

# Setup PM2 startup script (only if not already setup)
if ! pm2 status | grep -q "PM2"; then
    print_info "Setting up PM2 startup script..."
    pm2 startup
    print_warn "Please run the command shown above to complete PM2 startup setup"
fi

# Show status
print_info "Deployment complete! Current PM2 status:"
pm2 list

print_info "Log files:"
print_info "  Error log: logs/${DEPLOY_TYPE}-error.log"
print_info "  Output log: logs/${DEPLOY_TYPE}-out.log"
print_info "  Combined log: logs/${DEPLOY_TYPE}-combined.log"

print_info "Useful PM2 commands:"
print_info "  View logs: pm2 logs logtrail-${DEPLOY_TYPE}"
print_info "  Monitor: pm2 monit"
print_info "  Restart: pm2 restart logtrail-${DEPLOY_TYPE}"
print_info "  Stop: pm2 stop logtrail-${DEPLOY_TYPE}"

# Validate deployment
print_info "Validating deployment..."
sleep 5

if pm2 list | grep -q "logtrail-${DEPLOY_TYPE}.*online"; then
    print_info "✅ Deployment successful! Service is running."
    
    # Show endpoint information
    if [[ "$DEPLOY_TYPE" == "central" ]]; then
        PORT=$(grep "PORT=" .env | cut -d'=' -f2 || echo "3000")
        print_info "🌐 Central server available at: http://localhost:${PORT}"
        print_info "🔌 WebSocket endpoint: ws://localhost:${PORT}/ws"
    else
        print_info "🤖 Agent connected to central server"
        CENTRAL_URL=$(grep "CENTRAL_SERVER_URL=" .env | cut -d'=' -f2 || echo "not configured")
        print_info "🔗 Central server: ${CENTRAL_URL}"
    fi
else
    print_error "❌ Deployment failed! Service is not running."
    print_error "Check logs with: pm2 logs logtrail-${DEPLOY_TYPE}"
    exit 1
fi
