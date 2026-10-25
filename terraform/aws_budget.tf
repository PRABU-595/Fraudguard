# ==============================================================================
# AWS BUDGETS GUARDRAIL: $10.00 HARD CREDIT LIMIT
# Guarantees that free credits are never accidentally exhausted by notifying
# immediately at 50% ($5.00) and 80% ($8.00) spend thresholds.
# ==============================================================================

variable "notification_email" {
  type        = string
  default     = "student@example.com"
  description = "Email address for AWS Budget cost threshold alerts"
}

variable "monthly_budget_amount" {
  type        = string
  default     = "10.0"
  description = "Maximum monthly spend limit in USD (hard credit ceiling)"
}

resource "aws_budgets_budget" "credit_guardrail" {
  name              = "FraudGuard-Credit-Guardrail-10USD"
  budget_type       = "COST"
  limit_amount      = var.monthly_budget_amount
  limit_unit        = "USD"
  time_period_start = "2026-01-01_00:00"
  time_unit         = "MONTHLY"

  cost_types {
    include_credit             = false
    include_discount           = true
    include_other_subscription = true
    include_recurring          = true
    include_refund             = false
    include_subscription       = true
    include_support            = true
    include_tax                = true
    include_upfront            = true
    use_blended                = false
  }

  # Alert 1: 50% of budget reached ($5.00) - Warning
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 50
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.notification_email]
  }

  # Alert 2: 80% of budget reached ($8.00) - Critical Warning
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.notification_email]
  }

  # Alert 3: 100% of budget FORECASTED ($10.00 projected) - Early Intervention
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.notification_email]
  }
}
