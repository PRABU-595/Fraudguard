# ==============================================================================
# FraudGuard AWS 1-Click Free-Tier Deployment Script (PowerShell)
# Strict Budget Guardrail: Keeps costs at $0.00 / month on AWS Free Tier
# ==============================================================================

[CmdletBinding()]
param (
    [string]$Region = "eu-north-1",
    [string]$AlertEmail = "student@example.com",
    [switch]$SkipDockerBuild
)

$ErrorActionPreference = "Stop"

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host " 🛡️  FraudGuard AWS Cloud Deployment (Student Free Tier Mode)" -ForegroundColor Cyan
Write-Host " Target Cost: $0.00/mo (Free Tier) | Hard Guardrail Budget: $10.00" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan

# 1. Check AWS CLI Authentication
Write-Host "`n[1/5] Checking AWS CLI authentication..." -ForegroundColor Yellow
try {
    $identity = aws sts get-caller-identity --output json | ConvertFrom-Json
    Write-Host "  ✅ Authenticated as Account: $($identity.Account) (UserId: $($identity.UserId))" -ForegroundColor Green
} catch {
    Write-Error "AWS CLI is not configured. Please run 'aws configure' with your access key and secret."
    exit 1
}

# 2. Check & Build Frontend if necessary
if (-not $SkipDockerBuild) {
    Write-Host "`n[2/5] Compiling Production Frontend Assets (Vite)..." -ForegroundColor Yellow
    Push-Location "frontend"
    try {
        npm run build
        Write-Host "  ✅ Frontend build successful." -ForegroundColor Green
    } finally {
        Pop-Location
    }
}

# 3. Initialize & Validate Terraform
Write-Host "`n[3/5] Initializing Terraform Infrastructure-as-Code..." -ForegroundColor Yellow
Push-Location "terraform"
try {
    terraform init
    Write-Host "  ✅ Terraform initialized." -ForegroundColor Green

    Write-Host "`n[4/5] Planning AWS Resources (Budget Guardrails, DynamoDB, EC2/Lambda)..." -ForegroundColor Yellow
    terraform plan `
        -var="aws_region=$Region" `
        -var="notification_email=$AlertEmail" `
        -out="tfplan.binary"

    $confirmation = Read-Host "`nDo you want to deploy these resources to AWS? (yes/no)"
    if ($confirmation -eq 'yes' -or $confirmation -eq 'y') {
        Write-Host "`n[5/5] Applying Terraform configuration to AWS..." -ForegroundColor Yellow
        terraform apply "tfplan.binary"
        Write-Host "`n🎉 Deployment Complete!" -ForegroundColor Green
        
        Write-Host "`nDeployment Outputs:" -ForegroundColor Cyan
        terraform output
    } else {
        Write-Host "Deployment cancelled by user. State untouched." -ForegroundColor Yellow
    }
} finally {
    Pop-Location
}
