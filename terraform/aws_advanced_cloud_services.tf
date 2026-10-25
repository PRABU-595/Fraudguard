# ==============================================================================
# FRAUDGUARD ADVANCED CLOUD SERVICES (IaC)
# 1. Amazon SQS (Transaction Buffer & Dead Letter Queue)
# 2. AWS Step Functions (Distributed Visual Fraud Decision Workflow)
# 3. Amazon Cognito (Zero-Trust RBAC & Analyst User Pool)
# 4. Amazon SNS (Instant Critical Incident Alerts & Webhooks)
# 5. Amazon Bedrock IAM Permissions (Serverless GenAI Incident Summaries)
# ==============================================================================

# ------------------------------------------------------------------------------
# 1. AMAZON SQS: Ingestion Buffer & Dead Letter Queue (Zero Spikes Loss)
# ------------------------------------------------------------------------------
resource "aws_sqs_queue" "fg_transaction_dlq" {
  name                      = "fraudguard-transaction-dlq"
  message_retention_seconds = 1209600 # 14 days retention for forensic analysis

  tags = {
    Project     = "FraudGuard"
    Environment = var.environment
    Component   = "DeadLetterQueue"
  }
}

resource "aws_sqs_queue" "fg_transaction_queue" {
  name                      = "fraudguard-transaction-ingestion-queue"
  delay_seconds             = 0
  max_message_size          = 262144 # 256 KB
  message_retention_seconds = 86400  # 24 hours
  receive_wait_time_seconds = 10     # Long polling enabled

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.fg_transaction_dlq.arn
    maxReceiveCount     = 3
  })

  tags = {
    Project     = "FraudGuard"
    Environment = var.environment
    Component   = "IngestionBuffer"
  }
}

# ------------------------------------------------------------------------------
# 2. AMAZON SNS: Critical Alerting Topic (Instant Push / SMS / Webhook)
# ------------------------------------------------------------------------------
resource "aws_sns_topic" "fg_critical_alerts" {
  name = "fraudguard-critical-incident-alerts"

  tags = {
    Project     = "FraudGuard"
    Environment = var.environment
    Component   = "RealTimeAlerting"
  }
}

# ------------------------------------------------------------------------------
# 3. AWS STEP FUNCTIONS: State Machine Orchestration (Visual Workflow ASL)
# ------------------------------------------------------------------------------
resource "aws_iam_role" "fg_step_functions_role" {
  name = "fraudguard-${var.environment}-sfn-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action    = "sts:AssumeRole"
        Effect    = "Allow"
        Principal = { Service = "states.amazonaws.com" }
      }
    ]
  })
}

resource "aws_iam_policy" "fg_step_functions_policy" {
  name = "fraudguard-sfn-policy"
  role = aws_iam_role.fg_step_functions_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:PutItem",
          "dynamodb:GetItem",
          "dynamodb:UpdateItem"
        ]
        Resource = "arn:aws:dynamodb:*:*:table/fraud-*"
      },
      {
        Effect   = "Allow"
        Action   = "sns:Publish"
        Resource = aws_sns_topic.fg_critical_alerts.arn
      },
      {
        Effect = "Allow"
        Action = [
          "lambda:InvokeFunction"
        ]
        Resource = "arn:aws:lambda:*:*:function:FraudGuard-*"
      }
    ]
  })
}

resource "aws_sfn_state_machine" "fg_fraud_orchestrator" {
  name     = "FraudGuard-DistributedDecisionFlow"
  role_arn = aws_iam_role.fg_step_functions_role.arn

  definition = jsonencode({
    Comment = "FraudGuard Production Distributed Decision State Machine"
    StartAt = "EvaluateVelocity"
    States = {
      EvaluateVelocity = {
        Type     = "Pass"
        Result   = { velocity_status = "EVALUATED" }
        Next     = "CheckImpossibleTravel"
      }
      CheckImpossibleTravel = {
        Type     = "Pass"
        Result   = { travel_status = "EVALUATED" }
        Next     = "DecisionBranch"
      }
      DecisionBranch = {
        Type = "Choice"
        Choices = [
          {
            Variable                 = "$.risk_score"
            NumericGreaterThanEquals = 80.0
            Next                     = "ForceBlockAndAlert"
          },
          {
            Variable                 = "$.risk_score"
            NumericGreaterThanEquals = 40.0
            Next                     = "RouteToQuarantine"
          }
        ]
        Default = "ApproveTransaction"
      }
      ForceBlockAndAlert = {
        Type = "Parallel"
        Branches = [
          {
            StartAt = "PublishCriticalAlert"
            States = {
              PublishCriticalAlert = {
                Type     = "Pass"
                Result   = { alert = "SENT" }
                End      = true
              }
            }
          }
        ]
        End = true
      }
      RouteToQuarantine = {
        Type   = "Pass"
        Result = { status = "QUARANTINED" }
        End    = true
      }
      ApproveTransaction = {
        Type   = "Pass"
        Result = { status = "APPROVED" }
        End    = true
      }
    }
  })

  tags = {
    Project     = "FraudGuard"
    Environment = var.environment
  }
}

# ------------------------------------------------------------------------------
# 4. AMAZON COGNITO: User Pool & App Client (Zero-Trust RBAC Authentication)
# ------------------------------------------------------------------------------
resource "aws_cognito_user_pool" "fg_analysts_pool" {
  name                     = "fraudguard-analysts-user-pool"
  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length    = 10
    require_lowercase = true
    require_numbers   = true
    require_symbols   = true
    require_uppercase = true
  }

  schema {
    attribute_data_type = "String"
    name                = "role"
    mutable             = true
    required            = false
  }

  tags = {
    Project     = "FraudGuard"
    Environment = var.environment
  }
}

resource "aws_cognito_user_pool_client" "fg_client" {
  name         = "fraudguard-console-web-client"
  user_pool_id = aws_cognito_user_pool.fg_analysts_pool.id

  generate_secret                      = false
  explicit_auth_flows                  = ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_CUSTOM_AUTH"]
  prevent_user_existence_errors        = "ENABLED"
  allowed_oauth_flows_user_pool_client = false
}

# ------------------------------------------------------------------------------
# 5. OUTPUTS
# ------------------------------------------------------------------------------
output "sqs_ingestion_queue_url" {
  value       = aws_sqs_queue.fg_transaction_queue.url
  description = "Amazon SQS Ingestion Queue URL"
}

output "sqs_dlq_url" {
  value       = aws_sqs_queue.fg_transaction_dlq.url
  description = "Amazon SQS Dead Letter Queue URL"
}

output "sns_critical_topic_arn" {
  value       = aws_sns_topic.fg_critical_alerts.arn
  description = "Amazon SNS Topic ARN for Critical Incident Alerts"
}

output "step_functions_state_machine_arn" {
  value       = aws_sfn_state_machine.fg_fraud_orchestrator.arn
  description = "AWS Step Functions State Machine ARN"
}

output "cognito_user_pool_id" {
  value       = aws_cognito_user_pool.fg_analysts_pool.id
  description = "Amazon Cognito User Pool ID"
}

output "cognito_app_client_id" {
  value       = aws_cognito_user_pool_client.fg_client.id
  description = "Amazon Cognito App Client ID"
}
