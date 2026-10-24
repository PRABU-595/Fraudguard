# ==============================================================================
# FRAUDGUARD AWS PRODUCTION DEPLOYMENT IAC (Free-Credit / Tier Optimized)
# Architecture:
#   - VPC & Public Subnets with Internet Gateway
#   - Application Load Balancer with 120s Idle Timeout (SSE Persistent Connection)
#   - ECS Fargate Task Definition (0.25 vCPU, 512MB RAM) & Single Task Service
#   - DynamoDB On-Demand Tables (Transactions, Quarantine, Analyst Audit)
#   - CloudWatch Log Group with 7-Day Retention
#   - Least-Privilege IAM Roles & Scoped DynamoDB Policies
# ==============================================================================

variable "aws_region" {
  type        = string
  default     = "eu-north-1"
  description = "Target AWS Region"
}

variable "aws_environment" {
  type        = string
  default     = "prod"
  description = "Environment identifier"
}

variable "aws_container_image" {
  type        = string
  default     = "123456789012.dkr.ecr.eu-north-1.amazonaws.com/fraudguard:latest"
  description = "ECR image URI for the FraudGuard console"
}

variable "aws_quarantine_release_api_key" {
  type        = string
  default     = "prod-secret-analyst-key-2026"
  sensitive   = true
  description = "Secret API key for analyst quarantine actions"
}

# ==============================================================================
# 1. NETWORKING (VPC, Subnets, Internet Gateway)
# ==============================================================================
resource "aws_vpc" "fg_aws_vpc" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name    = "fraudguard-${var.aws_environment}-vpc"
    Project = "FraudGuard"
  }
}

resource "aws_internet_gateway" "fg_aws_igw" {
  vpc_id = aws_vpc.fg_aws_vpc.id

  tags = {
    Name = "fraudguard-${var.aws_environment}-igw"
  }
}

data "aws_availability_zones" "aws_available" {
  state = "available"
}

resource "aws_subnet" "aws_public_a" {
  vpc_id                  = aws_vpc.fg_aws_vpc.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = data.aws_availability_zones.aws_available.names[0]
  map_public_ip_on_launch = true

  tags = {
    Name = "fraudguard-pub-subnet-a"
  }
}

resource "aws_subnet" "aws_public_b" {
  vpc_id                  = aws_vpc.fg_aws_vpc.id
  cidr_block              = "10.0.2.0/24"
  availability_zone       = data.aws_availability_zones.aws_available.names[1]
  map_public_ip_on_launch = true

  tags = {
    Name = "fraudguard-pub-subnet-b"
  }
}

resource "aws_route_table" "aws_public_rt" {
  vpc_id = aws_vpc.fg_aws_vpc.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.fg_aws_igw.id
  }

  tags = {
    Name = "fraudguard-public-rt"
  }
}

resource "aws_route_table_association" "aws_pub_a_assoc" {
  subnet_id      = aws_subnet.aws_public_a.id
  route_table_id = aws_route_table.aws_public_rt.id
}

resource "aws_route_table_association" "aws_pub_b_assoc" {
  subnet_id      = aws_subnet.aws_public_b.id
  route_table_id = aws_route_table.aws_public_rt.id
}

# ==============================================================================
# 2. SECURITY GROUPS
# ==============================================================================
resource "aws_security_group" "aws_alb_sg" {
  name        = "fraudguard-${var.aws_environment}-alb-sg"
  description = "Allows inbound HTTP to Application Load Balancer"
  vpc_id      = aws_vpc.fg_aws_vpc.id

  ingress {
    description = "HTTP Public Entry"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "aws_ecs_sg" {
  name        = "fraudguard-${var.aws_environment}-ecs-sg"
  description = "Allows inbound from ALB only"
  vpc_id      = aws_vpc.fg_aws_vpc.id

  ingress {
    description     = "Traffic from ALB"
    from_port       = 8081
    to_port         = 8081
    protocol        = "tcp"
    security_groups = [aws_security_group.aws_alb_sg.id]
  }

  egress {
    description = "All outbound for AWS API calls & Tor sync"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# ==============================================================================
# 3. DYNAMODB TABLES (On-Demand / Free-Credit Optimized)
# ==============================================================================
resource "aws_dynamodb_table" "aws_transactions" {
  name         = "fraud-transactions"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "transaction_id"

  attribute {
    name = "transaction_id"
    type = "S"
  }

  attribute {
    name = "account_id"
    type = "S"
  }

  global_secondary_index {
    name            = "AccountIndex"
    hash_key        = "account_id"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }
}

resource "aws_dynamodb_table" "aws_quarantine" {
  name         = "fraud-quarantine"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "transaction_id"

  attribute {
    name = "transaction_id"
    type = "S"
  }

  attribute {
    name = "status"
    type = "S"
  }

  global_secondary_index {
    name            = "StatusIndex"
    hash_key        = "status"
    projection_type = "ALL"
  }
}

resource "aws_dynamodb_table" "aws_analyst_audit" {
  name         = "fraud-analyst-audit"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "action_id"

  attribute {
    name = "action_id"
    type = "S"
  }
}

# ==============================================================================
# 4. APPLICATION LOAD BALANCER (Configured for SSE Long-Lived Connections)
# ==============================================================================
resource "aws_lb" "fg_aws_alb" {
  name               = "fraudguard-${var.aws_environment}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.aws_alb_sg.id]
  subnets            = [aws_subnet.aws_public_a.id, aws_subnet.aws_public_b.id]

  # CRITICAL: 120s idle timeout keeps Server-Sent Events (/stream) alive without premature disconnects
  idle_timeout = 120
}

resource "aws_lb_target_group" "fg_aws_tg" {
  name        = "fraudguard-${var.aws_environment}-tg"
  port        = 8081
  protocol    = "HTTP"
  vpc_id      = aws_vpc.fg_aws_vpc.id
  target_type = "ip"

  health_check {
    path                = "/api/health"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "aws_http_listener" {
  load_balancer_arn = aws_lb.fg_aws_alb.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.fg_aws_tg.arn
  }
}

# ==============================================================================
# 5. ECS FARGATE CLUSTER & SERVICE (Single Task for Zero-Cost Scale)
# ==============================================================================
resource "aws_ecs_cluster" "fg_aws_cluster" {
  name = "fraudguard-${var.aws_environment}-cluster"
}

resource "aws_cloudwatch_log_group" "aws_ecs_logs" {
  name              = "/ecs/fraudguard-console-${var.aws_environment}"
  retention_in_days = 7
}

resource "aws_iam_role" "aws_ecs_execution_role" {
  name = "fraudguard-${var.aws_environment}-ecs-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "aws_ecs_execution_role_policy" {
  role       = aws_iam_role.aws_ecs_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "aws_ecs_task_role" {
  name = "fraudguard-${var.aws_environment}-ecs-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_policy" "aws_ecs_dynamo_policy" {
  name = "fraudguard-${var.aws_environment}-dynamo-policy"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:Scan",
          "dynamodb:Query",
          "dynamodb:BatchWriteItem"
        ]
        Resource = [
          aws_dynamodb_table.aws_transactions.arn,
          "${aws_dynamodb_table.aws_transactions.arn}/*",
          aws_dynamodb_table.aws_quarantine.arn,
          "${aws_dynamodb_table.aws_quarantine.arn}/*",
          aws_dynamodb_table.aws_analyst_audit.arn,
          "${aws_dynamodb_table.aws_analyst_audit.arn}/*"
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "aws_ecs_task_dynamo_attach" {
  role       = aws_iam_role.aws_ecs_task_role.name
  policy_arn = aws_iam_policy.aws_ecs_dynamo_policy.arn
}

resource "aws_ecs_task_definition" "fg_aws_task" {
  family                   = "fraudguard-${var.aws_environment}-task"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256" # 0.25 vCPU
  memory                   = "512" # 512 MB RAM
  execution_role_arn       = aws_iam_role.aws_ecs_execution_role.arn
  task_role_arn            = aws_iam_role.aws_ecs_task_role.arn

  container_definitions = jsonencode([
    {
      name      = "fraudguard-console"
      image     = var.aws_container_image
      essential = true
      portMappings = [
        {
          containerPort = 8081
          hostPort      = 8081
        }
      ]
      environment = [
        { name = "PORT", value = "8081" },
        { name = "STORAGE_BACKEND", value = "dynamodb" },
        { name = "USE_AWS_DYNAMODB", value = "true" },
        { name = "AWS_REGION", value = var.aws_region },
        { name = "DYNAMODB_TABLE", value = aws_dynamodb_table.aws_transactions.name },
        { name = "QUARANTINE_TABLE", value = aws_dynamodb_table.aws_quarantine.name },
        { name = "ENABLE_DEMO_SIMULATOR", value = "false" },
        { name = "QUARANTINE_RELEASE_API_KEY", value = var.aws_quarantine_release_api_key }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.aws_ecs_logs.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "console"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "fg_aws_service" {
  name            = "fraudguard-${var.aws_environment}-service"
  cluster         = aws_ecs_cluster.fg_aws_cluster.id
  task_definition = aws_ecs_task_definition.fg_aws_task.arn
  desired_count   = 1 # 1 task ensures seamless SSE without shared pub/sub cache
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = [aws_subnet.aws_public_a.id, aws_subnet.aws_public_b.id]
    security_groups  = [aws_security_group.aws_ecs_sg.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.fg_aws_tg.arn
    container_name   = "fraudguard-console"
    container_port   = 8081
  }

  depends_on = [aws_lb_listener.aws_http_listener]
}

# ==============================================================================
# 6. OUTPUTS
# ==============================================================================
output "aws_alb_dns_name" {
  value       = aws_lb.fg_aws_alb.dns_name
  description = "Public ALB DNS endpoint for FraudGuard Console"
}

output "aws_dynamodb_tables" {
  value = {
    transactions = aws_dynamodb_table.aws_transactions.name
    quarantine   = aws_dynamodb_table.aws_quarantine.name
    audit        = aws_dynamodb_table.aws_analyst_audit.name
  }
}
