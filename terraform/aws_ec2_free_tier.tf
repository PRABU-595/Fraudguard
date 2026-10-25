# ==============================================================================
# FRAUDGUARD 100% FREE TIER EC2 ARCHITECTURE ($0.00 / MONTH)
# Eliminates Application Load Balancer ($16.20/mo) and NAT Gateway ($32.40/mo)
# Runs the containerized FraudGuard SOC console on a t3.micro/t2.micro instance.
# ==============================================================================

variable "ec2_instance_type" {
  type        = string
  default     = "t3.micro"
  description = "Free Tier eligible compute instance (t3.micro in Stockholm/eu-north-1, Frankfurt/eu-central-1, Mumbai/ap-south-1, etc.)"
}

variable "ssh_public_key" {
  type        = string
  default     = ""
  description = "Optional SSH public key string for remote administrative debugging"
}

# Fetch latest Amazon Linux 2023 AMI
data "aws_ami" "amazon_linux_2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# ------------------------------------------------------------------------------
# 1. SECURITY GROUP: Direct Ingress (Ports 80, 443, 8081, 22)
# ------------------------------------------------------------------------------
resource "aws_security_group" "fg_ec2_sg" {
  name        = "fraudguard-${var.environment}-ec2-sg"
  description = "Security group for standalone FraudGuard Free Tier compute"
  vpc_id      = try(aws_vpc.fg_aws_vpc.id, null)

  ingress {
    description = "HTTP web traffic"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS encrypted web traffic"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "FraudGuard SOC Direct Port"
    from_port   = 8081
    to_port     = 8081
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "SSH secure administration"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "Allow all outbound internet access"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name    = "fraudguard-ec2-sg"
    Project = "FraudGuard"
  }
}

# ------------------------------------------------------------------------------
# 2. IAM INSTANCE PROFILE: Least-Privilege DynamoDB & CloudWatch
# ------------------------------------------------------------------------------
resource "aws_iam_role" "fg_ec2_role" {
  name = "fraudguard-${var.environment}-ec2-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "fg_ec2_dynamo_cw_policy" {
  name = "fraudguard-ec2-least-privilege"
  role = aws_iam_role.fg_ec2_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Scan",
          "dynamodb:Query",
          "dynamodb:BatchWriteItem"
        ]
        Resource = [
          "arn:aws:dynamodb:*:*:table/fraud-detection-transactions*",
          "arn:aws:dynamodb:*:*:table/fraud-quarantine*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogStreams"
        ]
        Resource = "arn:aws:logs:*:*:log-group:/aws/fraudguard/*"
      }
    ]
  })
}

resource "aws_iam_instance_profile" "fg_ec2_instance_profile" {
  name = "fraudguard-${var.environment}-instance-profile"
  role = aws_iam_role.fg_ec2_role.name
}

# Optional Key Pair for SSH
resource "aws_key_pair" "fg_key" {
  count      = var.ssh_public_key != "" ? 1 : 0
  key_name   = "fraudguard-admin-key"
  public_key = var.ssh_public_key
}

# ------------------------------------------------------------------------------
# 3. EC2 INSTANCE: Dockerized FraudGuard with Automated User-Data Bootstrapping
# ------------------------------------------------------------------------------
resource "aws_instance" "fg_server" {
  ami                         = data.aws_ami.amazon_linux_2023.id
  instance_type               = var.ec2_instance_type
  iam_instance_profile        = aws_iam_instance_profile.fg_ec2_instance_profile.name
  vpc_security_group_ids      = [aws_security_group.fg_ec2_sg.id]
  associate_public_ip_address = true
  key_name                    = var.ssh_public_key != "" ? aws_key_pair.fg_key[0].key_name : null

  root_block_device {
    volume_size           = 20
    volume_type           = "gp3"
    delete_on_termination = true
    encrypted             = true
  }

  user_data = <<-EOF
              #!/bin/bash
              set -ex

              # 1. Update OS and install Docker & Git
              dnf update -y
              dnf install -y docker git iptables

              # 2. Start and enable Docker
              systemctl enable --now docker
              usermod -aG docker ec2-user

              # 3. Port-forward Port 80 to 8081 for clean zero-port URL access
              iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-port 8081

              # 4. Create FraudGuard systemd service
              cat << 'SERVICE' > /etc/systemd/system/fraudguard.service
              [Unit]
              Description=FraudGuard Real-Time Ingestion & Threat Map Service
              After=docker.service
              Requires=docker.service

              [Service]
              TimeoutStartSec=0
              Restart=always
              ExecStartPre=-/usr/bin/docker stop fraudguard-app
              ExecStartPre=-/usr/bin/docker rm fraudguard-app
              ExecStart=/usr/bin/docker run --name fraudguard-app \
                -p 8081:8081 \
                -e PORT=8081 \
                -e STORAGE_BACKEND=sqlite \
                -e AWS_REGION=${var.aws_region} \
                -e DYNAMODB_TABLE_NAME=${var.dynamodb_table_name} \
                -e QUARANTINE_TABLE_NAME=${var.quarantine_table_name} \
                ghcr.io/fraudguard/console:latest

              [Install]
              WantedBy=multi-user.target
              SERVICE

              systemctl daemon-reload
              EOF

  tags = {
    Name        = "FraudGuard-FreeTier-Host"
    Environment = var.environment
    ManagedBy   = "Terraform"
    CostCenter  = "Academic-ZeroCost"
  }
}

# ------------------------------------------------------------------------------
# 4. OUTPUTS
# ------------------------------------------------------------------------------
output "ec2_public_ip" {
  value       = aws_instance.fg_server.public_ip
  description = "Public IPv4 address of the FraudGuard Free Tier instance"
}

output "ec2_public_dns" {
  value       = aws_instance.fg_server.public_dns
  description = "Public DNS hostname of the FraudGuard Free Tier instance"
}

output "console_live_url" {
  value       = "http://${aws_instance.fg_server.public_ip}:8081"
  description = "Direct browser access link to the FraudGuard SOC console & Threat Map"
}
