# FraudGuard — AWS Production Deployment Guide

This guide details how to deploy FraudGuard to Amazon Web Services (AWS) using **ECS Fargate**, an **Application Load Balancer (ALB)**, and **DynamoDB**.

---

## 1. Architecture Overview

| Component | AWS Service | Purpose & Justification |
|---|---|---|
| **Console Backend** | **ECS Fargate (1 Task)** | Hosts `/stream` (Server-Sent Events) and `/api/*`. Long-lived SSE streams require a persistent HTTP process. |
| **Load Balancing** | **Application Load Balancer (ALB)** | Routes incoming traffic to the Fargate container. Configured with a **120-second idle timeout** to prevent SSE connection drops. |
| **Persistence** | **Amazon DynamoDB** | Stores `fraud-transactions`, `fraud-quarantine`, and `fraud-analyst-audit`. On-demand mode (`PAY_PER_REQUEST`) keeps idle cost at \$0.00. |
| **Secrets & Keys** | **AWS Systems Manager (SSM) / Secrets Manager** | Securely supplies `QUARANTINE_RELEASE_API_KEY`, `MAXMIND_LICENSE_KEY`, and vendor API credentials. |
| **Observability** | **Amazon CloudWatch Logs** | Streams container logs with a 7-day retention period. PII is masked before logging. |

---

## 2. Cost & Free Credits Strategy

To maximize AWS Free Tier and promotional credit efficiency:
- **ECS Fargate Size:** `cpu = "256"` (0.25 vCPU) and `memory = "512"` (512 MB RAM). Monthly cost is approximately \$9 to \$12.
- **ALB Cost:** Approximately \$16 to \$20 per month.
- **DynamoDB On-Demand:** Free Tier includes 25 GB of storage and 25 write/read capacity units, resulting in \$0.00 cost during evaluation.
- **Total Estimated Cost:** Roughly **\$30 – \$35 / month** when active.
- **Teardown Command:** Always run `terraform destroy` when not actively conducting a demo.

---

## 3. Step-by-Step Deployment Instructions

### Prerequisites
1. **AWS CLI v2** configured with administrator permissions:
   ```bash
   aws sts get-caller-identity
   ```
2. **Docker Desktop** installed and running.
3. **Terraform** (`>= 1.5.0`) installed.

---

### Step 1: Create Amazon ECR Repository and Push Docker Image

```bash
# 1. Set environment variables
export AWS_REGION="eu-north-1"
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export ECR_REPO="fraudguard"

# 2. Authenticate Docker with your AWS ECR registry
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

# 3. Create ECR repository (if not already created)
aws ecr create-repository \
    --repository-name $ECR_REPO \
    --region $AWS_REGION \
    --image-scanning-configuration scanOnPush=true

# 4. Build the production Docker image
docker build -t fraudguard:latest .

# 5. Tag and push image to ECR
docker tag fraudguard:latest $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO:latest
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO:latest
```

---

### Step 2: Configure Environment & Terraform Variables

Navigate to the `terraform/` directory:
```bash
cd terraform
```

Create a `terraform.tfvars` file:
```hcl
aws_region                     = "eu-north-1"
aws_environment                = "prod"
aws_container_image            = "<AWS_ACCOUNT_ID>.dkr.ecr.eu-north-1.amazonaws.com/fraudguard:latest"
aws_quarantine_release_api_key = "your-custom-production-analyst-secret-key"
```

---

### Step 3: Provision Infrastructure with Terraform

```bash
# Initialize Terraform providers
terraform init

# Plan infrastructure changes
terraform plan -target=aws_ecs_service.fg_aws_service

# Apply and provision ECS Fargate, ALB, and DynamoDB
terraform apply -auto-approve
```

Upon completion, Terraform will output the public ALB DNS name:
```
Outputs:
aws_alb_dns_name = "fraudguard-prod-alb-123456789.eu-north-1.elb.amazonaws.com"
```

---

### Step 4: Verify Deployment and Streaming

1. **Verify Health Endpoint:**
   ```bash
   curl -s http://<ALB_DNS_NAME>/api/health
   ```
   *Expected Response:*
   ```json
   {
     "status": "healthy",
     "service": "FraudGuard Operations Console",
     "version": "2.4.0"
   }
   ```

2. **Verify Server-Sent Events (SSE):**
   ```bash
   curl -N http://<ALB_DNS_NAME>/stream
   ```
   You should observe live ping heartbeats (`: keepalive`) every 15 seconds and transaction payload events whenever activity is scored.

3. **Open Operations Console:**
   Open `http://<ALB_DNS_NAME>/` in any modern web browser to access the interactive Leaflet threat map and transaction feed.

---

### Step 5: Post-Demo Teardown (Preserve Free Credits)

To prevent ongoing ALB and Fargate compute charges when not demoing:
```bash
cd terraform
terraform destroy -auto-approve
```
