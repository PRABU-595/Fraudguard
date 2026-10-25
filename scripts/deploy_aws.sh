#!/usr/bin/env bash
# ==============================================================================
# FraudGuard AWS 1-Click Free-Tier Deployment Script (Bash)
# Strict Budget Guardrail: Keeps costs at $0.00 / month on AWS Free Tier
# ==============================================================================
set -euo pipefail

REGION="${1:-eu-north-1}"
ALERT_EMAIL="${2:-student@example.com}"

echo "======================================================================"
echo " 🛡️  FraudGuard AWS Cloud Deployment (Student Free Tier Mode)"
echo " Target Cost: $0.00/mo (Free Tier) | Hard Guardrail Budget: $10.00"
echo "======================================================================"

# 1. Check AWS CLI Authentication
echo ""
echo "[1/5] Checking AWS CLI authentication..."
ACCOUNT_ID=$(aws sts get-caller-identity --query "Account" --output text 2>/dev/null || true)
if [ -z "$ACCOUNT_ID" ]; then
    echo "❌ AWS CLI authentication failed. Please run 'aws configure'."
    exit 1
fi
echo "  ✅ Authenticated as Account: $ACCOUNT_ID in region: $REGION"

# 2. Build Frontend
echo ""
echo "[2/5] Compiling Production Frontend Assets (Vite)..."
(cd frontend && npm run build)
echo "  ✅ Frontend build successful."

# 3. Initialize Terraform
echo ""
echo "[3/5] Initializing Terraform Infrastructure-as-Code..."
(
    cd terraform
    terraform init

    echo ""
    echo "[4/5] Planning AWS Resources (Budget Guardrails, DynamoDB, EC2/Lambda)..."
    terraform plan \
        -var="aws_region=${REGION}" \
        -var="notification_email=${ALERT_EMAIL}" \
        -out="tfplan.binary"

    read -p "Do you want to deploy these resources to AWS? (yes/no): " CONFIRM
    if [[ "$CONFIRM" =~ ^[Yy](es)?$ ]]; then
        echo ""
        echo "[5/5] Applying Terraform configuration to AWS..."
        terraform apply "tfplan.binary"
        echo ""
        echo "🎉 Deployment Complete!"
        terraform output
    else
        echo "Deployment aborted by user. State untouched."
    fi
)
